import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves the app under /<repo>/, so the deploy workflow sets VITE_BASE.
// Local dev and `vite preview` fall back to '/'.
//
// `||`, not `??`, for both of these. GitHub Actions sets an env var from `${{ vars.X }}` to the
// EMPTY STRING when the repository variable does not exist, and an empty string is not nullish —
// `??` would have kept it. That put `og:url="/"` and `og:image="/og.png"` in the deployed page
// (verified by building with VITE_SITE_URL=""), which crawlers do not resolve, silently undoing
// the share card these variables exist for.
const SITE_URL = (process.env.VITE_SITE_URL || 'https://yujia-cha.github.io/mirror-dungeon/').replace(/\/?$/, '/');

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    {
      // `%SITE_URL%` in index.html. Vite's own `%VITE_*%` replacement only covers variables that
      // reach the client bundle, and this one must not.
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    /*
     * The support floor, stated rather than inherited. Vite's default (`baseline-widely-available`)
     * happens to mean Safari 16 today, but a Vite upgrade can move it — and the app's real floor is
     * set by what it uses: `@container` and `overscroll-behavior` (Safari 16), `dvh` (15.4),
     * `inert` (15.5), `AbortSignal.timeout` (16). Pinning it keeps a dependency bump from quietly
     * dropping or gaining browsers. Update this line and README together.
     */
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    /*
     * No sourcemap in the deployed artifact: it was 2.4 MB of the 4.1 MB uploaded to a public CDN
     * on every deploy, for a repository whose sources are public anyway. `npm run build` locally
     * with `--sourcemap` when a production stack trace needs reading.
     */
    sourcemap: false,
    rollupOptions: {
      output: {
        /*
         * One 555 kB chunk sat over Vite's warning threshold, so a future warning that mattered
         * would have been lost in this one. Zod is the clean seam: it changes far less often than
         * the app, so an app change no longer re-downloads it.
         *
         * Zod cannot be dropped from production, though it is only used to validate: `index.json`
         * decides which season to open and is always parsed (`loadSeasonIndex`), because getting
         * the season wrong invalidates everything after it. Hand-writing that one check would
         * duplicate a schema this project deliberately keeps in a single file.
         *
         * The other two are the remaining stable vendors, and together they bring the app chunk
         * back under the threshold so the warning means something again.
         */
        manualChunks: {
          react: ['react', 'react-dom'],
          zod: ['zod'],
          icons: ['lucide-react'],
        },
      },
    },
  },
});

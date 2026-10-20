import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataFingerprint, injectPrecache, precacheList } from './scripts/lib/precache.ts';
import { dataPreloadPaths, preloadTags } from './scripts/lib/preload.ts';
import { ocrAssets } from './scripts/lib/ocr-assets.ts';

// GitHub Pages serves the app under /<repo>/, so the deploy workflow sets VITE_BASE.
// Local dev and `vite preview` fall back to '/'.
//
// `||`, not `??`, for both of these. GitHub Actions sets an env var from `${{ vars.X }}` to the
// EMPTY STRING when the repository variable does not exist, and an empty string is not nullish —
// `??` would have kept it. That put `og:url="/"` and `og:image="/og.png"` in the deployed page
// (verified by building with VITE_SITE_URL=""), which crawlers do not resolve, silently undoing
// the share card these variables exist for.
const SITE_URL = (process.env.VITE_SITE_URL || 'https://yujia-cha.github.io/mirror-dungeon/').replace(
  /\/?$/,
  '/',
);

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    react(),
    tailwindcss(),
    // M103: the screen reader's OCR worker, cores and models from our own origin, not jsDelivr.
    ocrAssets(),
    {
      // `%SITE_URL%` in index.html. Vite's own `%VITE_*%` replacement only covers variables that
      // reach the client bundle, and this one must not.
      name: 'site-url',
      transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', SITE_URL),
    },
    {
      // M58: start the data downloads with the HTML instead of after the bundle has run.
      name: 'data-preload',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace(
          '</head>',
          `  ${preloadTags(dataPreloadPaths(fileURLToPath(new URL('./public/data', import.meta.url))))}\n  </head>`,
        ),
    },
    (() => {
      // M55: write the shell into the copied `sw.js`, so one online visit is enough to open the
      // app offline. After the bundle *and* the public copy, which is why it is `closeBundle`.
      // The output folder is the resolved config's, not a path repeated here (M160): a build with
      // `--outDir` would otherwise patch a worker in a folder it did not write.
      let outDir = '';
      return {
        name: 'precache',
        apply: 'build' as const,
        configResolved(config: { root: string; build: { outDir: string } }) {
          outDir = resolve(config.root, config.build.outDir);
        },
        closeBundle() {
          if (!outDir) throw new Error('precache: configResolved did not run');
          const sw = join(outDir, 'sw.js');
          writeFileSync(
            sw,
            injectPrecache(readFileSync(sw, 'utf8'), precacheList(outDir), dataFingerprint(outDir)),
          );
        },
      };
    })(),
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
    rolldownOptions: {
      output: {
        /*
         * One 555 kB chunk sat over Vite's warning threshold, so a future warning that mattered
         * would have been lost in this one. These three are the stable vendors: they change far
         * less often than the app, so an app change no longer re-downloads them, and splitting
         * them keeps the app chunk under the threshold so the warning means something again.
         *
         * Zod cannot be dropped from production, though it is only used to validate: `index.json`
         * decides which season to open and is always parsed (`loadSeasonIndex`), because getting
         * the season wrong invalidates everything after it. Hand-writing that one check would
         * duplicate a schema this project deliberately keeps in a single file.
         *
         * Vite 8 replaced Rollup with Rolldown, which dropped the object form of `manualChunks`
         * for `codeSplitting.groups`. Two things the translation has to get right, both of which
         * fail *silently* — the build stays green and the chunks quietly get worse:
         *
         * 1. `scheduler` is named explicitly. Rollup's object form pulled each listed module's
         *    transitive dependencies in with it, so `react-dom`'s dependency on `scheduler` rode
         *    along unnoticed. A regex takes only what it matches.
         * 2. The `react` pattern is anchored with a trailing separator. `node_modules/react`
         *    without it also matches `lucide-react`, which would swallow the icons chunk.
         *
         * `npm run build` output is the check: three vendor chunks, app chunk under 500 kB.
         */
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'zod', test: /node_modules[\\/]zod[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
});

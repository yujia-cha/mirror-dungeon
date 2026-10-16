/**
 * The OCR engine's files, served from our own origin (M103).
 *
 * Tesseract.js loads three things at run time — its worker script, a WebAssembly core and the
 * language models — and fetches them from jsDelivr unless told otherwise. The site makes no
 * third-party requests (the same rule as the self-hosted font), so the files are copied out of
 * node_modules into `ocr/` at build time and served from there in dev. Nothing is committed: the
 * packages pin them.
 *
 * Only the LSTM cores are shipped (the engine runs LSTM only); the worker picks among them by what
 * the browser supports (relaxed SIMD → SIMD → plain), so all three must be there. The models are
 * `4.0.0_best_int`, the ones the spike measured (M91–M96).
 *
 * Not precached: ~5 MB a visitor downloads only on turning the screen reader on.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const pkg = (name: string): string => dirname(require.resolve(`${name}/package.json`));

/** Published path under the site base → file on disk. */
export function ocrAssetFiles(): Record<string, string> {
  const core = pkg('tesseract.js-core');
  const files: Record<string, string> = {
    'ocr/worker.min.js': join(pkg('tesseract.js'), 'dist/worker.min.js'),
  };
  for (const variant of [
    'tesseract-core-lstm',
    'tesseract-core-simd-lstm',
    'tesseract-core-relaxedsimd-lstm',
  ])
    files[`ocr/core/${variant}.wasm.js`] = join(core, `${variant}.wasm.js`);
  for (const code of ['kor', 'eng'])
    files[`ocr/lang/${code}.traineddata.gz`] = join(
      pkg(`@tesseract.js-data/${code}`),
      '4.0.0_best_int',
      `${code}.traineddata.gz`,
    );
  return files;
}

/** Emit the files into the build, and serve them in dev. */
export function ocrAssets(): Plugin {
  const files = ocrAssetFiles();
  return {
    name: 'ocr-assets',
    generateBundle() {
      for (const [fileName, source] of Object.entries(files))
        this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const base = server.config.base;
        const path = (req.url ?? '').split('?')[0]!;
        const key = path.startsWith(base) ? path.slice(base.length) : null;
        const source = key ? files[key] : undefined;
        if (!source) return next();
        res.setHeader('Content-Type', key!.endsWith('.js') ? 'text/javascript' : 'application/gzip');
        res.end(readFileSync(source));
      });
    },
  };
}

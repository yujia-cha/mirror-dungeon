/**
 * The browser's OCR: Tesseract.js on our own copies of its files (M103, `scripts/lib/ocr-assets.ts`).
 *
 * Loaded on demand — `import('tesseract.js')` and the ~5 MB of core and models arrive only when the
 * player turns the screen reader on. Tesseract.js runs the recognition in a Web Worker of its own,
 * so the page's thread only crops the frame and matches text.
 */
import type { Lang } from '../i18n.ts';

/** Tesseract's codes for the two client languages. */
const TESS_LANG = { ko: 'kor', en: 'eng' } as const;

export interface OcrEngine {
  /** The lines OCR reads in a canvas. */
  recognize(image: HTMLCanvasElement | OffscreenCanvas): Promise<string[]>;
  terminate(): Promise<void>;
}

function base(): string {
  const b = import.meta.env.BASE_URL || '/';
  return b.endsWith('/') ? b : `${b}/`;
}

/** Start an engine for the game's language. Rejects when the files or the worker cannot load. */
export async function createOcrEngine(lang: Lang): Promise<OcrEngine> {
  const { createWorker, OEM } = await import('tesseract.js');
  const root = new URL(`${base()}ocr/`, location.href).href;
  const worker = await createWorker(TESS_LANG[lang], OEM.LSTM_ONLY, {
    workerPath: `${root}worker.min.js`,
    corePath: `${root}core`,
    langPath: `${root}lang`,
    gzip: true,
  });
  return {
    async recognize(image) {
      const { data } = await worker.recognize(image as HTMLCanvasElement);
      return data.text.split('\n').filter((line) => line.trim() !== '');
    },
    terminate: async () => {
      await worker.terminate();
    },
  };
}

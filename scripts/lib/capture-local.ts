/**
 * What the local capture tools share (`capture:spike`, `capture:bench`, `capture:feedback`):
 * decoding screenshots, finding a window title bar in them, Node-side OCR on the vendored models,
 * and the gift icon references.
 *
 * Local only — the shots are Project Moon's images and live in the gitignored `local-fixtures/`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import decodeJpeg, { init as initJpeg } from '@jsquash/jpeg/decode.js';
import decodeWebp, { init as initWebp } from '@jsquash/webp/decode.js';
import { PNG } from 'pngjs';
import { createWorker, type Worker } from 'tesseract.js';
import { prepareReference, type IconRef } from '../../src/app/capture/match-icon.ts';
import { cropRgba, isolateLightText, type Region } from '../../src/app/capture/preprocess.ts';
import { regionInFrame, titleBarHeight, titleBarRows } from '../../src/app/capture/window-frame.ts';
import type { Gift } from '../../src/core/schema.ts';

export interface Rgba {
  data: Uint8Array;
  width: number;
  height: number;
}

let jpegCodec: Promise<void> | null = null;

/**
 * Decoded RGBA pixels of a PNG or JPEG file (Steam and the diagnostics frames save JPEG). JPEG goes
 * through libjpeg (`@jsquash/jpeg`, MozJPEG), pixel for pixel what PIL's libjpeg decodes; `jpeg-js`
 * differed by up to 72 per channel on a 4:2:0 diagnostics frame and a title OCR'd worse on it.
 */
export async function decodeImage(bytes: Buffer): Promise<Rgba> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return PNG.sync.read(bytes);
  jpegCodec ??= (async () =>
    initJpeg(
      await WebAssembly.compile(readFileSync(require.resolve('@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm'))),
    ))();
  await jpegCodec;
  const image = await decodeJpeg(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return {
    data: new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    width: image.width,
    height: image.height,
  };
}

/**
 * The window title bar over the game in a stored frame, px — 0 for a client-only shot. The same
 * detection the browser session runs (M134), so a frame shared with its title bar reads the same.
 */
export function titleBarOf(image: Rgba): number {
  return titleBarHeight(image.data, image.width, titleBarRows(image.height), image.height);
}

/**
 * A region of the game's client area (the layout's, a label's) as a region of `image`, below its
 * title bar. `top` is `titleBarOf(image)`, found once per image.
 */
export function clientRegion(image: Rgba, top: number, region: Region): Region {
  return regionInFrame(region, top, image.height);
}

/** Tesseract's own 3-letter codes for the two client languages we read. */
export const TESS_LANG = { ko: 'kor', en: 'eng' } as const;
export type OcrLang = keyof typeof TESS_LANG;
export type OcrModel = 'best' | 'fast';

const require = createRequire(import.meta.url);

/** The vendored traineddata folder for a language, from the @tesseract.js-data packages. */
function langPath(lang: OcrLang, model: OcrModel): string {
  const pkg = dirname(require.resolve(`@tesseract.js-data/${TESS_LANG[lang]}/package.json`));
  return resolve(pkg, model === 'best' ? '4.0.0_best_int' : '4.0.0');
}

/** One Tesseract worker per language, made on first use. */
export class LocalOcr {
  private workers = new Map<OcrLang, Promise<Worker>>();

  constructor(private readonly model: OcrModel = 'best') {}

  private workerFor(lang: OcrLang): Promise<Worker> {
    let worker = this.workers.get(lang);
    if (!worker) {
      worker = createWorker(TESS_LANG[lang], 1, {
        langPath: langPath(lang, this.model),
        gzip: true,
        // The models are already on disk; the default cache writes a copy into the working directory.
        cacheMethod: 'none',
      });
      this.workers.set(lang, worker);
    }
    return worker;
  }

  /** OCR one region of an image (light-text pass unless `raw`), lines in order, and the time it took. */
  async region(
    image: Rgba,
    region: Region,
    lang: OcrLang,
    raw: boolean,
  ): Promise<{ lines: string[]; ms: number }> {
    const worker = await this.workerFor(lang);
    const crop = cropRgba(image.data, image.width, image.height, region);
    const png = new PNG({ width: crop.width, height: crop.height });
    png.data = Buffer.from(raw ? crop.data : isolateLightText(crop.data));
    const started = performance.now();
    const { data } = await worker.recognize(PNG.sync.write(png));
    const ms = performance.now() - started;
    return { lines: data.text.split('\n').filter((line) => line.trim() !== ''), ms };
  }

  async terminate(): Promise<void> {
    for (const worker of this.workers.values()) await (await worker).terminate();
    this.workers.clear();
  }
}

/** Every gift's shipped icon (public/icons/gifts), reduced for matching. */
export async function loadIconRefs(gifts: readonly Pick<Gift, 'id' | 'icon'>[]): Promise<IconRef[]> {
  await initWebp(
    await WebAssembly.compile(readFileSync(require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm'))),
  );
  const refs: IconRef[] = [];
  for (const gift of gifts) {
    const path = resolve('public/icons/gifts', `${gift.icon}.webp`);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    const image = await decodeWebp(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
    refs.push(prepareReference(gift.id, image.data, image.width, image.height));
  }
  return refs;
}

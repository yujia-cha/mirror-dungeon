/** The screen tracker's shipped pieces (M103): the built layout and the OCR files the build copies. */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ocrAssetFiles } from '../scripts/lib/ocr-assets.ts';
import { CAPTURE_SCREENS, captureLayoutSchema } from '../src/core/schema.ts';

describe('capture layout', () => {
  const layout = captureLayoutSchema.parse(
    JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/capture-layout.json'), 'utf8')),
  );

  it('gives every screen a title region', () => {
    const covered = new Set(layout.titles.flatMap((t) => t.screens));
    expect(CAPTURE_SCREENS.filter((s) => !covered.has(s))).toEqual([]);
  });

  it('is the curated file without its notes', () => {
    const curated = JSON.parse(
      readFileSync(resolve(process.cwd(), 'data/curated/capture-layout.json'), 'utf8'),
    );
    expect(layout.titles.map((t) => t.region)).toEqual(
      curated.titles.map((t: { region: number[] }) => t.region),
    );
    expect(JSON.stringify(layout)).not.toContain('_note');
  });
});

describe('OCR assets', () => {
  it('names a file on disk for each published path: worker, three LSTM cores, two models', () => {
    const files = ocrAssetFiles();
    expect(Object.keys(files).sort()).toEqual([
      'ocr/core/tesseract-core-lstm.wasm.js',
      'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js',
      'ocr/core/tesseract-core-simd-lstm.wasm.js',
      'ocr/lang/eng.traineddata.gz',
      'ocr/lang/kor.traineddata.gz',
      'ocr/worker.min.js',
    ]);
    expect(Object.values(files).filter((path) => !existsSync(path))).toEqual([]);
  });
});

/**
 * Pictures for the owner's diagnostics (M116, M134), split out of `session.ts` in M167: a read's
 * snapshot or a tick's preview as a `FrameSource`, and the canvas helpers the session draws with.
 */

/** JPEG quality of a kept read (re-read with OCR) and of a filmstrip preview (only looked at). */
export const FULL_QUALITY = 0.85;
export const PREVIEW_QUALITY = 0.7;

/**
 * A read's picture for the owner's diagnostics (M116). Taking it is a cheap copy of the snapshot;
 * the full-size JPEG encode happens only for a frame the recorder keeps, once (`encode` is
 * memoised). `close` frees the copy; a frame being encoded is freed when the encode is done.
 */
export interface FrameSource {
  encode(): Promise<Blob | null>;
  close(): void;
}

/** The video's current frame at a size, as RGBA, drawn on `canvas`. */
export function drawScaled(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/** A canvas as JPEG at full size — the diagnostics re-read it with OCR, so no downscale. */
function toJpeg(canvas: HTMLCanvasElement, quality = FULL_QUALITY): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    } catch {
      resolve(null);
    }
  });
}

/** Where kept pictures are drawn to be encoded; one for the page, made on first use. */
let encodeCanvas: HTMLCanvasElement | null = null;

/** A picture as JPEG. Draw and `toBlob` run together, so one canvas serves every encode. */
function bitmapToJpeg(bitmap: ImageBitmap, quality: number): Promise<Blob | null> {
  try {
    encodeCanvas ??= document.createElement('canvas');
    encodeCanvas.width = bitmap.width;
    encodeCanvas.height = bitmap.height;
    encodeCanvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    return toJpeg(encodeCanvas, quality);
  } catch {
    // A picture already freed, or no 2D context.
    return Promise.resolve(null);
  }
}

/**
 * The snapshot of one read — or a tick's preview, at a lower quality (M134) — for the diagnostics
 * (`FrameSource`). `take` copies the canvas into an
 * `ImageBitmap` — before the next read draws over it; the session calls it right after the events.
 * Without `createImageBitmap` the copy is the JPEG itself, encoded at once.
 */
export class SnapshotFrame implements FrameSource {
  private copy: Promise<ImageBitmap | Blob | null> | null = null;
  private jpeg: Promise<Blob | null> | null = null;
  private closed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly quality = FULL_QUALITY,
  ) {}

  take(): void {
    // A frame the diagnostics closed at once (their store is full, M160) has nothing to copy: a
    // bitmap made now would have no one to close it, 8 MB per read.
    if (this.copy || this.closed) return;
    this.copy =
      typeof createImageBitmap === 'function'
        ? createImageBitmap(this.canvas).catch(() => null)
        : toJpeg(this.canvas, this.quality);
  }

  encode(): Promise<Blob | null> {
    if (this.jpeg) return this.jpeg;
    if (this.closed) return Promise.resolve(null);
    this.take();
    this.jpeg = this.copy!.then((copy) =>
      copy === null || copy instanceof Blob ? copy : bitmapToJpeg(copy, this.quality),
    );
    return this.jpeg;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const copy = this.copy;
    if (!copy) return;
    void (this.jpeg ?? Promise.resolve(null))
      .then(() => copy)
      .then((bitmap) => {
        if (bitmap && !(bitmap instanceof Blob)) bitmap.close();
      });
  }
}

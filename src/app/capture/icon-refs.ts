/**
 * The gift icons a session matches popups and fusion slots against (M136, M154), split out of
 * `session.ts` in M167: each reduced for matching and decoded once per session.
 */
import { prepareReference, type IconRef } from './match-icon.ts';

/** A gift icon that failed to load is tried again after this long (M154), not on every read. */
export const REF_RETRY_MS = 10_000;

/**
 * Icon references by gift, loaded once each. One that did not load (no picture, a fetch that
 * failed) is not kept for the session (M154): it is tried again `REF_RETRY_MS` later.
 */
export class IconRefs {
  private refs = new Map<number, Promise<IconRef | null>>();
  /** When a gift's icon last failed to load (M154). */
  private refFailedAt = new Map<number, number>();

  /** A gift's reference, loading it on first ask; null while it has none. */
  get(id: number, iconUrl: (giftId: number) => string | null): Promise<IconRef | null> {
    const cached = this.refs.get(id);
    if (cached) return cached;
    const failedAt = this.refFailedAt.get(id);
    if (failedAt !== undefined && performance.now() - failedAt < REF_RETRY_MS) return Promise.resolve(null);
    const loading = loadRef(id, iconUrl(id)).then((ref) => {
      if (ref === null) {
        this.refs.delete(id);
        this.refFailedAt.set(id, performance.now());
      } else this.refFailedAt.delete(id);
      return ref;
    });
    this.refs.set(id, loading);
    return loading;
  }
}

async function loadRef(id: number, url: string | null): Promise<IconRef | null> {
  if (!url) return null;
  try {
    const bitmap = await createImageBitmap(await (await fetch(url)).blob());
    let image: ImageData;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally {
      // The decoded picture is not needed past its pixels (M154).
      bitmap.close();
    }
    return prepareReference(id, image.data, image.width, image.height);
  } catch {
    return null;
  }
}

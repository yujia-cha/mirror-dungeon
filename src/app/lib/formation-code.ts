import { ungzip } from 'pako';
import type { GameIndexes } from '../../core/types.ts';

/**
 * Decode a game formation code into known identity ids.
 *
 * The code is base64(gzip(inner)), and `inner` is itself base64 of a bit string: bit 0 is skipped,
 * then each of the 12 slots carries a 7-bit identity offset, a 4-bit deploy order (0 = reserve)
 * and five 7-bit E.G.O offsets, most significant bit first. An identity id is
 * `offset + 10000 + slot * 100`.
 *
 * This used to call `limbus-formation-deck`, which decodes base64 with Node's `Buffer`. Vite does
 * not polyfill `Buffer`, so in the browser every code failed while the tests (run under Node)
 * passed. Only browser APIs and pako here; a test decodes with `Buffer` stubbed away to keep it so.
 * The library stays as a dev dependency so the tests can encode fixtures independently.
 */
export function identitiesFromFormationCode(
  code: string,
  indexes: GameIndexes,
): { ids: number[]; deployed: number[]; skipped: number } | null {
  const slots = decodeSlots(code);
  if (!slots) return null;
  const all = slots.map((slot) => slot.id);
  const ids = all.filter((id) => indexes.identityById.has(id));
  if (ids.length === 0) return null;
  const deployed = slots
    .filter((slot) => slot.order > 0 && indexes.identityById.has(slot.id))
    .sort((a, b) => a.order - b.order || a.slot - b.slot)
    .map((slot) => slot.id);
  return { ids, deployed, skipped: all.length - ids.length };
}

const SLOTS = 12;
const ID_BITS = 7;
const ORDER_BITS = 4;
const EGO_BITS = 7;
const EGOS = 5;

function decodeSlots(code: string): { slot: number; id: number; order: number }[] | null {
  try {
    const inner = new TextDecoder().decode(ungzip(base64Bytes(code)));
    const bytes = base64Bytes(inner);
    let cursor = 1;
    const read = (width: number): number => {
      let value = 0;
      for (let i = 0; i < width; i++, cursor++) {
        // A short bit string reads as zeros past its end, as the game's own decoder does.
        const byte = bytes[cursor >> 3] ?? 0;
        value = value * 2 + ((byte >> (7 - (cursor & 7))) & 1);
      }
      return value;
    };
    const out: { slot: number; id: number; order: number }[] = [];
    for (let slot = 1; slot <= SLOTS; slot++) {
      const offset = read(ID_BITS);
      const order = read(ORDER_BITS);
      read(EGO_BITS * EGOS);
      if (offset > 0) out.push({ slot, id: offset + 10000 + slot * 100, order });
    }
    return out;
  } catch {
    return null;
  }
}

/** Base64 to bytes, tolerating whitespace and line breaks a pasted code picks up, and the URL-safe alphabet. */
function base64Bytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

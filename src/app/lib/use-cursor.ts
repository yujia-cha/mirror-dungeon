import { useState } from 'react';

/**
 * A highlighted index that resets itself when the list it points into changes.
 *
 * The obvious spelling — `useEffect(() => setActiveIndex(0), [needle])` — writes state from an
 * effect, which costs a second render pass and, with the React Compiler lint set on, is an error.
 * Storing the key *with* the index removes the effect: a cursor for a different key simply reads as
 * 0, which is what the effect was there to arrange.
 *
 * React's own guidance calls this "adjusting state when a prop changes" and prefers it to an
 * effect for exactly this reason.
 */
export function useCursor(key: string): [number, (index: number) => void] {
  const [cursor, setCursor] = useState({ key, index: 0 });
  const index = cursor.key === key ? cursor.index : 0;
  return [index, (next: number) => setCursor({ key, index: next })];
}

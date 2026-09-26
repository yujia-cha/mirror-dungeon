/**
 * How far to move a popover left so it stays inside `bounds` (both in viewport pixels).
 *
 * Returns 0 when it already fits, a negative shift when its right edge runs past `bounds.right - pad`,
 * and never moves its left edge past `bounds.left + pad`: a popover wider than the bounds keeps its
 * left edge and lets the width clamp (CSS) do the rest.
 */
export function fitShift(
  popover: { left: number; right: number },
  bounds: { left: number; right: number },
  pad = 0,
): number {
  const overflow = popover.right - (bounds.right - pad);
  if (overflow <= 0) return 0;
  const room = popover.left - (bounds.left + pad);
  return -Math.max(0, Math.min(overflow, room));
}

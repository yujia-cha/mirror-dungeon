/**
 * Moving one pin of `data/sources.lock.json` to a branch tip (`npm run data:fetch -- --update`).
 * `fetchedAt` says when the vendored copy last changed: it moves only when the sha does, so a
 * weekly check that finds nothing new leaves the lock as it was.
 */

/**
 * Point `pin` at `tip`; when that is a different commit, stamp `entry.fetchedAt` with `today`
 * (`YYYY-MM-DD`). Returns whether the pin moved.
 */
export function advancePin(
  pin: { sha: string },
  entry: { fetchedAt: string },
  tip: string,
  today: string,
): boolean {
  if (tip === pin.sha) return false;
  pin.sha = tip;
  entry.fetchedAt = today;
  return true;
}

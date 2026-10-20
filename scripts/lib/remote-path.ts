/**
 * What an upstream file name may look like before it goes into a download URL (M160, B3).
 *
 * The icon and pack planners build `raw.githubusercontent.com/<repo>/<sha>/<path>` from names the
 * derived source ships (`srcPath`, `image`). `encodeURIComponent` leaves `.` alone, so a name of
 * `../../other/branch/file` would stay a dot path and `fetch` would resolve it — a download from a
 * repository or a commit other than the pinned one. The names are data from someone else's file,
 * so each segment is checked against a whitelist and anything else is reported as unmapped, never
 * fetched.
 *
 * The whitelist is what the source actually uses: letters and digits of any script (the Chinese
 * virtue names, `Virtue - Zhi (智)`), the curly apostrophes of `Hellterfly’s Dream` and `Hot ‘n
 * Juicy Drumstick`, and `_ .,'()&+-`. A segment of dots alone (`.`, `..`) is refused even though
 * every character is allowed.
 */

/** One path segment the planners accept. */
export const SAFE_SEGMENT = /^(?!\.+$)[\p{L}\p{N}_ .,'‘’()&+-]+$/u;

/** True when every `/`-separated segment of `path` is a `SAFE_SEGMENT`. */
export function isSafeRemotePath(path: string): boolean {
  return path.length > 0 && path.split('/').every((segment) => SAFE_SEGMENT.test(segment));
}

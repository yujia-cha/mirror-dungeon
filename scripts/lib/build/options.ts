import { flagValue, hasFlag } from '../io.ts';

/**
 * The build's flags (M168), read once by the entry script. `season` is kept as the flag's text:
 * `loadSources` validates it after the static-data check, in the order the script always had.
 */
export interface BuildOptions {
  /** `--lenient`: tolerate missing static data (names only, tiers null). */
  lenient: boolean;
  /** `--season <n>`: build that season instead of the newest on disk. */
  season: string | undefined;
  /** `--force-frozen`: build a season older than the snapshot anyway. */
  forceFrozen: boolean;
}

export function buildOptionsFromArgv(): BuildOptions {
  return {
    lenient: hasFlag('--lenient'),
    season: flagValue('--season'),
    forceFrozen: hasFlag('--force-frozen'),
  };
}

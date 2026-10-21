/**
 * data/raw + data/curated  ->  public/data
 *
 *   npm run data:build
 *   npm run data:build -- --season 7  build that season instead of the newest on disk — refused
 *                                     when it is older than the snapshot (`--force-frozen` overrides)
 *   npm run data:build -- --lenient   tolerate missing static data (names only, tiers null)
 *
 * The output is split by what a Mirror Dungeon season owns. `gifts`, `packs`, `rules` and `meta`
 * go to `public/data/md{n}/`, because a season replaces the gift pool rather than adding to it.
 * `identities` and `enums` stay at the root: neither looks at the dungeon, so every season shares
 * them and they keep getting new identities without rebuilding a frozen season.
 *
 * Only the season the vendored raw data describes is rebuilt. Older seasons stay on disk exactly
 * as committed — OpenLethe's capture moves on and cannot produce them again — and `index.json`
 * lists whatever is there.
 *
 * Output is deterministic: object keys are sorted on write and every array is sorted explicitly,
 * so regenerating without an input change produces no diff. CI enforces that.
 *
 * The work is in `scripts/lib/build/` (M168), as phases: load → derive → validate → write → report.
 * Nothing is written until every output has passed its schema, so a failure anywhere leaves
 * `public/data` as it was; this file only turns a `BuildError` into an exit code.
 */
import { OUT } from './lib/out.ts';
import { BuildError } from './lib/build/errors.ts';
import { buildOptionsFromArgv } from './lib/build/options.ts';
import { buildData } from './lib/build/index.ts';
import { validateAndWrite } from './lib/build/output.ts';
import { reportBuild } from './lib/build/report.ts';

try {
  const built = buildData(buildOptionsFromArgv());
  validateAndWrite(built.output, OUT);
  reportBuild(built);
} catch (error) {
  if (error instanceof BuildError) {
    console.error(`build-data: ${error.message}`);
    process.exit(1);
  }
  throw error;
}

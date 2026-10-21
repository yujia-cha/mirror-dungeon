/**
 * The build, as phases (M168): load → derive → (validate → write, in `output.ts`) → report.
 *
 * `buildData` is the first two: it reads every source and derives every output in memory, and
 * touches nothing on disk. The entry script hands its result to `validateAndWrite`, which parses
 * every file through its schema before writing any of them, and then to `reportBuild`.
 *
 * The derivation itself is unchanged from the single-file script this replaced: each module under
 * `scripts/lib/build/` is a section of it, given the sources it used to read as free variables.
 */
import { loadSources, type Sources } from './load.ts';
import { deriveFactions, type Factions } from './factions.ts';
import { derivePacks, type PackSet } from './packs.ts';
import { deriveGifts, type GiftSet } from './gifts.ts';
import { deriveIdentities, type IdentitySet } from './identities.ts';
import { deriveEnums, deriveRules } from './rules.ts';
import { dataVersionFor, deriveMeta } from './meta.ts';
import { attachEffects, localizeGiftText } from './effects.ts';
import type { BuildOptions } from './options.ts';
import type { BuildOutput } from './output.ts';

export interface BuildResult {
  sources: Sources;
  factions: Factions;
  packSet: PackSet;
  giftSet: GiftSet;
  identitySet: IdentitySet;
  /** Buff ids the text still carries because the game names them nowhere we can read. */
  unnamedBuffIds: Set<string>;
  output: BuildOutput;
}

export function buildData(options: BuildOptions): BuildResult {
  const sources = loadSources(options);

  const factions = deriveFactions(sources);
  const packSet = derivePacks(sources);
  const giftSet = deriveGifts(sources, packSet, factions);
  const identitySet = deriveIdentities(sources);
  const enums = deriveEnums(sources, factions, identitySet);
  const rules = deriveRules(sources, giftSet);
  const meta = deriveMeta(sources, packSet, giftSet, identitySet);
  // Effects are read from the raw Korean text; the buff-id pass that follows is the last one over
  // the gift text, so the gifts the fingerprint sees are the gifts the write phase puts on disk.
  const skillGiftsText = attachEffects(sources, giftSet, identitySet, factions);
  const unnamedBuffIds = localizeGiftText(sources, giftSet.gifts);

  const output: BuildOutput = {
    dungeonId: sources.dungeonId,
    meta,
    rules,
    gifts: giftSet.gifts,
    packs: packSet.packs,
    skillGiftsText,
    enums,
    identities: identitySet.identities,
    captureLayout: sources.captureLayout,
  };
  meta.dataVersion = dataVersionFor(output);

  return { sources, factions, packSet, giftSet, identitySet, unnamedBuffIds, output };
}

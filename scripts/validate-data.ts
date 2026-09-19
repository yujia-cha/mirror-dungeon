/**
 * Check public/data: schema, referential integrity, then domain invariants.
 *
 *   npm run data:validate
 *   npm run data:validate -- --season 7  check that season instead of the one index.json opens
 *   npm run data:validate -- --lenient   downgrade static-data-dependent checks to warnings
 *
 * The domain checks compare the generated data against the raw snapshot in `data/raw`, which
 * describes exactly one season, so they run against that season. Every other season on disk is a
 * frozen build that nothing can change but a hand edit, so it gets the schema and index checks.
 *
 * Messages are prefixed [schema] / [ref] / [invariant] / [stale] / [art]; the validate-data skill
 * explains what each class usually means and how to fix it.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { z } from 'zod';
import { hasFlag, flagValue, readJson, readJsonIfExists, repoPath } from './lib/io.ts';
import { readCommonData, readPersonalities, readThemePacks, staticDataPresent } from './lib/raw.ts';
import { OUT, SEASON_FILES, outPath, outRelPath } from './lib/out.ts';
import { derivedKeywords, derivedStatuses, readDerivedFetchedAt, readDerivedIdentities } from './lib/derived-source.ts';
import {
  derivedFixedRecipes,
  derivedMdPresent,
  derivedTier,
  readDerivedAvailability,
  readDerivedGifts,
  readDerivedPacks,
  readDerivedStartPools,
} from './lib/derived-md.ts';
import {
  CONSUMED_KEYWORDS,
  IDENTITY_KEYWORDS,
  STATUS_KEYWORDS,
  type ArtManifest,
  enumsSchema,
  giftsFileSchema,
  identitiesFileSchema,
  EFFECT_BUCKETS,
  metaSchema,
  packsFileSchema,
  rulesSchema,
  seasonIndexSchema,
  type Enums,
  type Gift,
  type Identity,
  type Meta,
  type Rules,
  type SeasonIndex,
  type ThemePack,
} from '../src/core/schema.ts';
import { PADDED_BRACKET, RICH_TEXT_TAG, RUNTIME_PLACEHOLDER } from '../src/core/text.ts';
import { unknownLabels } from './lib/gift-effects.ts';

/** The twelve sinners the game has had since launch; every one must be deckable. */
const SINNER_COUNT = 12;
/**
 * How many identities may read differently in the derived source before it is worth a look.
 * Measured at 11 of 179; the budget leaves room for a patch without hiding a broken derivation.
 */
const KEYWORD_DISAGREEMENT_BUDGET = 15;
/**
 * Packs and gifts the derived source lists that we deliberately leave out, so the roster checks
 * below only speak up about genuinely new content.
 *
 * 3001 is the hidden pack 「뽕.황」, which cannot be chosen or observed, and 9242 is its gift.
 * 9831-9839 belong to pack 1122 「선의의 순례」, a story-dungeon pack the game does not offer in
 * Mirror Dungeon at all.
 */
const DERIVED_ONLY_PACKS = [3001] as const;
const DERIVED_ONLY_GIFTS = [9242, 9831, 9832, 9833, 9834, 9835, 9836, 9837, 9838, 9839] as const;
/** The formation holds one seat per sinner; 9761 names 편성 8번, so the range really is 1..12. */
const FORMATION_SIZE = SINNER_COUNT;
/**
 * A loose read of the same sentences `parseSkillTriggers` models — a sin or attack type with 스킬
 * close behind. It over-matches on purpose: its job is to be louder than the real parser, so a
 * wording change upstream shows up as a gift the loose scan sees and the parser does not.
 */
const LOOSE_SKILL_SUBJECT =
  /(분노|색욕|나태|탐식|우울|오만|질투|참격|관통|타격)[^\n가-힣]{0,4}(?:속성|유형)?[^\n가-힣]{0,4}(?:기본\s*)?(?:공격\s*)?스킬/;

function ascendingUnique(values: readonly number[]): boolean {
  return values.every((value, i) => i === 0 || value > values[i - 1]!);
}

const lenient = hasFlag('--lenient');

const errors: string[] = [];
const warnings: string[] = [];

function err(kind: string, message: string): void {
  errors.push(`[${kind}] ${message}`);
}
function warn(kind: string, message: string): void {
  warnings.push(`[${kind}] ${message}`);
}
/** Static-data-dependent problems are warnings in lenient mode, errors otherwise. */
function strict(kind: string, message: string): void {
  if (lenient) warn(kind, message);
  else err(kind, message);
}

function parseAt<S extends z.ZodTypeAny>(path: string, label: string, schema: S): z.infer<S> | null {
  if (!existsSync(path)) {
    err('schema', `${label} is missing. Run: npm run data:build`);
    return null;
  }
  const result = schema.safeParse(readJson(path));
  if (!result.success) {
    for (const issue of result.error.issues.slice(0, 25)) {
      err('schema', `${label} ${issue.path.join('.')}: ${issue.message}`);
    }
    if (result.error.issues.length > 25) {
      err('schema', `${label}: ${result.error.issues.length - 25} more schema issue(s)`);
    }
    return null;
  }
  return result.data;
}

const index: SeasonIndex | null = parseAt(join(OUT, 'index.json'), 'public/data/index.json', seasonIndexSchema);
const requestedSeason = flagValue('--season') ? Number(flagValue('--season')) : undefined;
/**
 * The season the raw snapshot describes, and so the one the domain checks below can speak about.
 * Not `index.default`: the newest published season may be a frozen build whose raw data is gone.
 */
const season = requestedSeason ?? readCommonData()?.data.currentDungeonId ?? index?.default ?? 7;

function parseFile<S extends z.ZodTypeAny>(name: string, schema: S): z.infer<S> | null {
  const file = name.replace(/\.json$/, '') as Parameters<typeof outPath>[0];
  return parseAt(outPath(file, season), outRelPath(file, season), schema);
}

const meta: Meta | null = parseFile('meta.json', metaSchema);
const enums: Enums | null = parseFile('enums.json', enumsSchema);
const rules: Rules | null = parseFile('rules.json', rulesSchema);
const gifts: Gift[] | null = parseFile('gifts.json', giftsFileSchema);
const packs: ThemePack[] | null = parseFile('packs.json', packsFileSchema);
const identities: Identity[] | null = parseFile('identities.json', identitiesFileSchema);

if (meta && enums && rules && gifts && packs && identities) {
  checkReferences(gifts, packs, identities, enums);
  checkInvariants(meta, rules, gifts, packs, identities, enums);
  checkCuratedOverrides(gifts, packs, identities);
  checkCuratedIdentities(identities);
  checkDerivedMirrorDungeon(gifts, packs, rules);
  checkFreshness();
  checkArt(gifts, packs);
}

/**
 * The hand-drawn artwork under `public/art/` against the manifest and the season's keys.
 *
 * Missing drawings are a **warning**, never an error: the site has to build and ship with zero
 * images (every tile draws its name fallback instead), and the 558 slots fill in one at a time.
 * What is an error is an inconsistency that would make the app request a file that is not there,
 * or a file nothing will ever read — both mean the manifest and the directory have drifted apart.
 */
function checkArt(gifts: Gift[], packs: ThemePack[]): void {
  const root = repoPath('public/art');
  const manifestPath = join(root, 'manifest.json');
  const listed = (kind: 'gifts' | 'packs'): string[] => {
    const dir = join(root, kind);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.png'))
      .map((f) => f.slice(0, -4))
      .sort();
  };
  const onDisk = { gifts: listed('gifts'), packs: listed('packs') };
  const manifest = readJsonIfExists<ArtManifest>(manifestPath);

  if (!manifest) {
    if (onDisk.gifts.length + onDisk.packs.length > 0) {
      err('art', `public/art has ${onDisk.gifts.length + onDisk.packs.length} file(s) but no manifest.json, so the app will not request any of them. Run: npm run art -- --write`);
    }
    return;
  }

  const icons = new Set(gifts.map((g) => String(g.icon)));
  const sprites = new Set(packs.map((p) => p.sprite));
  for (const [kind, keys] of [
    ['gifts', icons],
    ['packs', sprites],
  ] as const) {
    const files = new Set(onDisk[kind]);
    const claimed = new Set((kind === 'gifts' ? manifest.gifts.map(String) : manifest.packs) as string[]);
    for (const key of claimed) {
      if (!files.has(key)) err('art', `manifest lists ${kind}/${key} but public/art/${kind}/${key}.png is missing. Run: npm run art -- --write`);
    }
    for (const key of files) {
      if (!claimed.has(key)) err('art', `public/art/${kind}/${key}.png is not in the manifest, so nothing will load it. Run: npm run art -- --write`);
      if (!keys.has(key)) err('art', `public/art/${kind}/${key}.png is not a ${kind === 'gifts' ? 'gift icon' : 'pack sprite'} of this season, so nothing will ever read it.`);
    }
    // Only a *partly* drawn set is worth a line. Nothing drawn at all is the shipped design, not a
    // gap — every tile falls back to its name — and saying so on every `npm run check` would just
    // train the eye to skip warnings. `npm run art` is where the running count belongs.
    const drawn = [...keys].filter((k) => files.has(k)).length;
    if (drawn > 0 && drawn < keys.size) warn('art', `${keys.size - drawn} of ${keys.size} ${kind} have no artwork yet; those tiles draw their name instead.`);
  }
}

function checkReferences(gifts: Gift[], packs: ThemePack[], identities: Identity[], enums: Enums): void {
  const giftIds = new Set(gifts.map((g) => g.id));
  const giftById = new Map(gifts.map((g) => [g.id, g]));
  const packIds = new Set(packs.map((p) => p.id));
  const factionIds = new Set(enums.factions.map((f) => f.id));

  for (const id of giftIds) {
    if (gifts.filter((g) => g.id === id).length > 1) err('ref', `gift id ${id} appears more than once`);
  }

  for (const pack of packs) {
    for (const giftId of pack.giftPool) {
      if (!giftIds.has(giftId)) err('ref', `pack ${pack.id} giftPool references unknown gift ${giftId}`);
    }
    for (const giftId of pack.exclusiveGifts) {
      if (!pack.giftPool.includes(giftId)) {
        err('ref', `pack ${pack.id} exclusive gift ${giftId} is not in its giftPool`);
      }
    }
  }

  for (const gift of gifts) {
    for (const packId of [...gift.acquisition.packs, ...gift.acquisition.exclusiveTo]) {
      if (!packIds.has(packId)) err('ref', `gift ${gift.id} references unknown pack ${packId}`);
    }
    for (const recipe of gift.fusion?.recipes ?? []) {
      for (const ingredient of recipe.ingredients) {
        if (!giftIds.has(ingredient)) {
          err('ref', `gift ${gift.id} recipe references unknown ingredient ${ingredient}`);
        }
        if (ingredient === gift.id)
          err('invariant', `recipe for gift ${gift.id} lists itself as an ingredient`);
      }
    }
    for (const id of [...(gift.fusion?.mixed?.aPool ?? []), ...(gift.fusion?.mixed?.bPool ?? [])]) {
      if (!giftIds.has(id)) err('ref', `gift ${gift.id} mixed recipe references unknown gift ${id}`);
    }
    if (gift.upgradeOf !== null) {
      const parent = giftById.get(gift.upgradeOf);
      if (!parent) err('ref', `gift ${gift.id} upgradeOf references unknown gift ${gift.upgradeOf}`);
      else {
        if (parent.id === gift.id) err('invariant', `gift ${gift.id} upgradeOf points at itself`);
        if (!(parent.fusion?.recipes ?? []).some((r) => r.ingredients.includes(gift.id)))
          err('invariant', `gift ${gift.id} upgradeOf ${parent.id} but no recipe of ${parent.id} uses it`);
        if (parent.keyword !== gift.keyword || gift.keyword === 'None')
          err('invariant', `gift ${gift.id} upgradeOf ${parent.id} crosses keywords (${gift.keyword} → ${parent.keyword})`);
        const rank = (t: Gift['tier']): number => (t === null ? -1 : t === 'EX' ? 6 : t);
        if (rank(gift.tier) >= rank(parent.tier))
          err('invariant', `gift ${gift.id} (T${gift.tier}) upgradeOf ${parent.id} (T${parent.tier}) is not a lower tier`);
      }
    }
    for (const condition of gift.conditions) {
      if (condition.type === 'factionCount') {
        for (const faction of condition.factions) {
          if (!factionIds.has(faction)) {
            err('ref', `gift ${gift.id} condition references unknown faction "${faction}"`);
          }
        }
      }
    }
  }

  for (const identity of identities) {
    for (const faction of identity.factions) {
      if (!factionIds.has(faction)) {
        err('ref', `identity ${identity.id} references unknown faction "${faction}"`);
      }
    }
    if (Math.floor(identity.id / 100) % 100 !== identity.sinnerId) {
      err('ref', `identity ${identity.id} sinnerId ${identity.sinnerId} does not match its id`);
    }
  }
}

function checkInvariants(
  meta: Meta,
  rules: Rules,
  gifts: Gift[],
  packs: ThemePack[],
  identities: Identity[],
  enums: Enums,
): void {
  const selectable = packs.filter((p) => p.selectable);

  // Expected scale for Mirror Dungeon 7. A real season change moves these; bump them deliberately
  // and say why in the commit message (see the update-game-data skill).
  if (packs.length < 110) strict('invariant', `only ${packs.length} theme packs (expected 110+)`);
  if (selectable.length < 100)
    strict('invariant', `only ${selectable.length} selectable packs (expected 100+)`);
  if (gifts.length < 400) strict('invariant', `only ${gifts.length} gifts (expected 400+)`);
  if (identities.length < 175) strict('invariant', `only ${identities.length} identities (expected 175+)`);
  // 조합 계승 pairs: 76 in MD7. A drift far outside that means the derivation or the recipes changed.
  const upgradePairs = gifts.filter((g) => g.upgradeOf !== null).length;
  if (upgradePairs < 60 || upgradePairs > 100)
    strict('invariant', `${upgradePairs} upgradeOf pairs (expected roughly 76)`);
  if (rules.deployment.max < rules.deployment.default || rules.deployment.max > 12)
    err('invariant', `deployment.max ${rules.deployment.max} must be within default..12`);

  // Every floor a player can reach must have enough packs to fill the selection screen.
  for (const mode of ['normal', 'hard', 'parallel', 'extreme'] as const) {
    for (const floor of rules.floors[mode]) {
      const count = selectable.filter((p) => p.availability[mode].includes(floor)).length;
      if (count < rules.themePacksOfferedPerFloor) {
        strict(
          'invariant',
          `${mode} floor ${floor} has only ${count} selectable pack(s), below themePacksOfferedPerFloor ` +
            `${rules.themePacksOfferedPerFloor}`,
        );
      }
    }
  }

  // Floors 11-15 are EXTREME-only; nothing else may claim them, and EXTREME packs may not claim
  // the 1-10 range.
  for (const pack of selectable) {
    const extremeElsewhere = [
      ...pack.availability.normal,
      ...pack.availability.hard,
      ...pack.availability.parallel,
    ];
    if (extremeElsewhere.some((f) => f > 10)) {
      err('invariant', `pack ${pack.id} claims a floor above 10 outside EXTREME mode`);
    }
    if (pack.availability.extreme.some((f) => f < 11)) {
      err('invariant', `pack ${pack.id} claims an EXTREME floor below 11`);
    }
    if (pack.group === 'longBattle' && extremeElsewhere.length > 0) {
      warn('invariant', `long-battle pack ${pack.id} is also available outside EXTREME`);
    }
  }

  // Keyword packs are Hard-and-above only — a routing rule the planner depends on.
  for (const pack of selectable.filter((p) => p.group === 'keyword')) {
    if (pack.availability.normal.length > 0) {
      strict(
        'invariant',
        `keyword pack ${pack.id} (${pack.name.ko}) is available on Normal, which breaks the Hard-only rule`,
      );
    }
    if (!pack.keywordAffinity) {
      strict('invariant', `keyword pack ${pack.id} (${pack.devName}) has no keywordAffinity`);
    }
  }

  // A fixed-recipe result is shop-only: it must never sit in a pack's drop pool.
  const inAnyPool = new Set(selectable.flatMap((p) => p.giftPool));
  for (const gift of gifts) {
    if (gift.acquisition.kind === 'fusionOnly' && inAnyPool.has(gift.id)) {
      err('invariant', `fusion-only gift ${gift.id} (${gift.name.ko}) appears in a pack pool`);
    }
    if (gift.acquisition.kind === 'packLimited' && gift.acquisition.packs.length === 0) {
      err('invariant', `pack-limited gift ${gift.id} has no pack`);
    }
    if (gift.acquisition.exclusiveTo.some((p) => !gift.acquisition.packs.includes(p))) {
      err('invariant', `gift ${gift.id} is exclusive to a pack that does not list it in giftPool`);
    }
  }

  // 클리어 보상 gifts hang off exactly one EXTREME pack; hidden-battle gifts off none. Together with
  // the choice-event gifts they are precisely the season's globalExcludeEgoGifts.
  const packById = new Map(packs.map((p) => [p.id, p]));
  for (const gift of gifts) {
    const { kind, clearRewardOf, packs: giftPacks } = gift.acquisition;
    if (kind === 'clearReward') {
      const pack = clearRewardOf !== null ? packById.get(clearRewardOf) : undefined;
      if (!pack) err('invariant', `clear-reward gift ${gift.id} (${gift.name.ko}) names no pack`);
      else {
        if (pack.availability.extreme.length === 0) err('invariant', `clear-reward gift ${gift.id} pack ${pack.id} is not an EXTREME pack`);
        if (giftPacks.length !== 1 || giftPacks[0] !== pack.id) err('invariant', `clear-reward gift ${gift.id} must list only pack ${pack.id}`);
      }
    } else if (clearRewardOf !== null) {
      err('invariant', `gift ${gift.id} has clearRewardOf but kind ${kind}`);
    }
    if (kind === 'hiddenBattle' && giftPacks.length > 0) err('invariant', `hidden-battle gift ${gift.id} must not list packs`);
    if ((kind === 'clearReward' || kind === 'hiddenBattle') && gift.observable) {
      err('invariant', `gift ${gift.id} (${kind}) is in the observation pool, which the planner does not expect`);
    }
  }
  const dropPoolFile = readJsonIfExists<{ list?: { dungeonId: number; globalExcludeEgoGifts?: number[] }[] }>(
    repoPath(`data/raw/static/mirrordungeon-egogift-droppool/mirrordungeon-egogift-droppool-${rules.dungeonId}.json`),
  );
  const globalExclude = dropPoolFile?.list?.find((p) => p.dungeonId === rules.dungeonId)?.globalExcludeEgoGifts;
  if (globalExclude) {
    const offPath = gifts
      .filter((g) => ['event', 'clearReward', 'hiddenBattle'].includes(g.acquisition.kind))
      .map((g) => g.id)
      .sort((a, b) => a - b)
      .join(',');
    const expected = [...globalExclude].sort((a, b) => a - b).join(',');
    if (offPath !== expected) {
      strict('invariant', `event ∪ clearReward ∪ hiddenBattle (${offPath}) differs from globalExcludeEgoGifts (${expected})`);
    }
  }
  if (rules.hiddenBattle) {
    for (const id of rules.hiddenBattle.gifts) {
      if (gifts.find((g) => g.id === id)?.acquisition.kind !== 'hiddenBattle') err('invariant', `rules.hiddenBattle lists ${id}, which is not a hidden-battle gift`);
    }
  }

  // EXTREME packs carry no exclusives, so their pool is exactly the general gift set. This is the
  // cross-check that the general/exclusive split is still being derived correctly.
  const generalGifts = new Set(gifts.filter((g) => g.acquisition.kind === 'general').map((g) => g.id));
  const extremePack = selectable.find((p) => p.group === 'longBattle' && p.exclusiveGifts.length === 0);
  if (extremePack) {
    const pool = new Set(extremePack.giftPool);
    const onlyInGeneral = [...generalGifts].filter((id) => !pool.has(id));
    const onlyInPool = [...pool].filter((id) => !generalGifts.has(id));
    if (onlyInGeneral.length > 0 || onlyInPool.length > 0) {
      strict(
        'invariant',
        `general gift set (${generalGifts.size}) does not match EXTREME pack ${extremePack.id} pool (${pool.size}): ` +
          `${onlyInGeneral.length} general-only, ${onlyInPool.length} pool-only`,
      );
    }
  } else {
    warn('invariant', 'no EXTREME pack without exclusives found; skipped the general-gift cross-check');
  }

  // Hard-only gifts must not be reachable on a Normal-only route.
  for (const gift of gifts.filter((g) => g.hardOnly && g.acquisition.kind === 'packLimited')) {
    const normalOnly = gift.acquisition.packs
      .map((id) => selectable.find((p) => p.id === id))
      .filter((p): p is ThemePack => Boolean(p))
      .some((p) => p.availability.normal.length > 0 && p.availability.hard.length === 0);
    if (normalOnly) {
      warn('invariant', `hard-only gift ${gift.id} (${gift.name.ko}) is exclusive to a Normal-only pack`);
    }
  }

  if (rules.dungeonId !== meta.dungeon.id) {
    err('invariant', `rules.dungeonId ${rules.dungeonId} != meta.dungeon.id ${meta.dungeon.id}`);
  }
  if (!meta.dungeon.name.ko) warn('invariant', 'meta.dungeon.name.ko is empty');
  if (meta.counts.gifts !== gifts.length) err('invariant', 'meta.counts.gifts is stale');
  if (meta.counts.packs !== packs.length) err('invariant', 'meta.counts.packs is stale');
  if (meta.counts.identities !== identities.length) err('invariant', 'meta.counts.identities is stale');

  if (!rules.giftObservation.verified) {
    warn(
      'invariant',
      'rules.giftObservation is unverified (costTable taken from an older season). Confirm in-game, ' +
        'then update data/curated/rules.json.',
    );
  }

  // Conditions the planner can evaluate, versus ones the user has to read.
  const unparsed = gifts.filter((g) => g.conditions.some((c) => c.type === 'unparsed'));
  if (unparsed.length > 3) {
    warn(
      'invariant',
      `${unparsed.length} gift(s) have unparsed conditions: ${unparsed
        .slice(0, 6)
        .map((g) => g.id)
        .join(', ')}` + ' — consider extending the parser or adding data/curated/conditions.json entries',
    );
  }

  // Skill triggers: which skills a gift's effect lands on, read out of the Korean text. The parser
  // is the only source, so losing it is silent — nothing else in the data says 「참격 스킬」.
  const triggered = gifts.filter((g) => g.skillTriggers.length > 0);
  if (triggered.length === 0) {
    strict(
      'invariant',
      "no gift has a skill trigger; check parseSkillTriggers() against the season's effect text",
    );
  }
  // The loose scan is the regression guard: a gift whose text plainly names a skill subject but
  // whose triggers came out empty means the wording moved and the parser did not follow.
  const missed = gifts.filter((g) => g.skillTriggers.length === 0 && LOOSE_SKILL_SUBJECT.test(g.desc.ko));
  if (missed.length > 0) {
    err(
      'invariant',
      `${missed.length} gift(s) name a skill's sin or attack type but parsed no trigger: ${missed
        .slice(0, 6)
        .map((g) => g.id)
        .join(', ')}` + ' — extend parseSkillTriggers() or add a data/curated/conditions.json entry',
    );
  }
  for (const gift of gifts) {
    for (const trigger of gift.skillTriggers) {
      if (trigger.sin === null && trigger.attackType === null) {
        err('invariant', `gift ${gift.id} has a skill trigger naming neither a sin nor an attack type`);
      }
      if (!ascendingUnique(trigger.slots)) {
        err('invariant', `gift ${gift.id} has skill trigger slots out of order or repeated`);
      }
    }
    if (!ascendingUnique(gift.formationSlots)) {
      err('invariant', `gift ${gift.id} has formationSlots out of order or repeated`);
    }
    if (gift.formationSlots.some((slot) => slot > FORMATION_SIZE)) {
      err('invariant', `gift ${gift.id} limits itself to a formation position past ${FORMATION_SIZE}`);
    }
  }

  // Effect buckets: the only machine-readable answer to 「이 기프트는 어떤 도움인가」 comes from the
  // community mirror's curated labels, so a label it adds upstream that our table does not name
  // would silently drop gifts out of every bucket and off the 「스킬」 탭.
  const shippedLabels = [...readDerivedGifts().values()].flatMap((gift) => gift.effects ?? []);
  const unnamed = unknownLabels(shippedLabels);
  if (unnamed.length > 0) {
    err(
      'invariant',
      `${unnamed.length} effect label(s) are not in the bucket table: ${unnamed.join(', ')}` +
        ' — name them in scripts/lib/gift-effects.ts',
    );
  }
  const unbucketed = triggered.filter((g) => g.effectBuckets.length === 0);
  if (unbucketed.length > 0) {
    err(
      'invariant',
      `${unbucketed.length} gift(s) with a skill trigger have no effect bucket: ${unbucketed
        .slice(0, 6)
        .map((g) => g.id)
        .join(', ')}` + ' — check classifyGiftEffects()',
    );
  }
  for (const gift of gifts) {
    const order = gift.effectBuckets.map((bucket) => EFFECT_BUCKETS.indexOf(bucket));
    if (!ascendingUnique(order)) {
      err('invariant', `gift ${gift.id} has effect buckets out of order or repeated`);
    }
  }
  if (!gifts.some((g) => g.effectBuckets.includes('egoResource'))) {
    warn('invariant', 'no gift is classed as an E.G.O resource gift; check the bucket table');
  }

  // Every identity must answer 「몇 번 스킬이 무슨 속성인가」: the static records cover 183 and the
  // derived mirror the remaining 4, so a gap means a source stopped rather than that one is empty.
  const noSkills = identities.filter((i) => i.skills.length === 0);
  if (noSkills.length > 0) {
    err(
      'invariant',
      `${noSkills.length} identity/identities ship no skill table: ${noSkills
        .slice(0, 6)
        .map((i) => i.id)
        .join(', ')}` + ' — check deriveIdentitySkills() and derivedSkills()',
    );
  }
  for (const identity of identities) {
    // The flat sets and the per-slot table are two readings of the same skills, so neither may
    // claim something the other does not have.
    const sins = new Set(identity.skills.map((s) => s.sin).filter(Boolean));
    const types = new Set(identity.skills.map((s) => s.attackType).filter(Boolean));
    for (const sin of identity.sins) {
      if (!sins.has(sin)) err('invariant', `identity ${identity.id} lists sin ${sin} that no skill row has`);
    }
    for (const type of identity.attackTypes) {
      if (!types.has(type)) {
        err('invariant', `identity ${identity.id} lists attack type ${type} that no skill row has`);
      }
    }
    const slots = new Set(identity.skills.map((s) => s.slot));
    if (identity.skills.length > 0 && (!slots.has(1) || !slots.has(2) || !slots.has(3))) {
      err('invariant', `identity ${identity.id} is missing a base attack skill slot`);
    }
  }

  // Shipped gift text carries no leftovers a reader would notice as a defect: a bracketed buff
  // name padded with whitespace (`AttackDown` arrives from the game as 「공격 레벨 감소 」), Unity
  // rich-text tags, or the runtime `{0}` counter. Each has a fix in the build; a hit here means a
  // new shape arrived that the build does not clean.
  const messyText = gifts.filter((g) =>
    [g.desc.ko, g.desc.en, ...g.conditions.flatMap((c) => (c.text ? [c.text.ko, c.text.en] : []))].some(
      (text) => PADDED_BRACKET.test(text) || new RegExp(RICH_TEXT_TAG.source).test(text) || RUNTIME_PLACEHOLDER.test(text),
    ),
  );
  if (messyText.length > 0) {
    warn(
      'invariant',
      `${messyText.length} gift(s) ship text with stray markup or padding: ${messyText
        .slice(0, 6)
        .map((g) => g.id)
        .join(', ')}` + ' — check readBattleKeywordNames() and stripRichText() in the build',
    );
  }

  // The 특수 variants (특수 충전 …) are read off BattleKeywords.json; losing them all means the
  // description format changed, not that the game dropped the mechanic.
  if (!identities.some((i) => Object.values(i.keywords).some((k) => k.specialSkills > 0))) {
    strict('invariant', 'no identity inflicts a 특수 keyword variant; check readSpecialVariants() against BattleKeywords.json');
  }

  // 탄환 is read off the `[necessary:Bullet:n]` requirement tokens in skill scripts. None at all
  // means that syntax changed, not that the game dropped ammo.
  if (!identities.some((i) => i.keywords.Bullet)) {
    strict('invariant', 'no identity uses 탄환; check the skill requirement tokens in scripts/lib/derive.ts');
  }

  // 혈찬 is read off the Korean 「…을 소모하는」 sentence — the game declares nothing else for it.
  if (!identities.some((i) => i.keywords.BloodDinner)) {
    strict('invariant', 'no identity consumes 혈찬; check deriveConsumedKeywordsFromText() against Skills_personality-*.json');
  }

  // The consumed keywords, against the one source that knows them independently. KR skill text
  // covers 125 of 187 identities, so a new 혈귀 could arrive without one; the mirror would still
  // list it and this would say so instead of the app quietly counting one identity short.
  for (const keyword of CONSUMED_KEYWORDS) {
    const ours = new Set(identities.filter((i) => i.keywords[keyword]).map((i) => i.id));
    const theirs = new Set(
      [...readDerivedIdentities()].filter(([, e]) => derivedStatuses(e).has(keyword)).map(([id]) => id),
    );
    for (const id of theirs) {
      if (!ours.has(id)) {
        strict('invariant', `${id} uses ${keyword} per the derived source but we ship none; add data/curated/identity-keywords.json`);
      }
    }
    for (const id of ours) {
      if (!theirs.has(id) && readDerivedIdentities().has(id)) {
        warn('invariant', `${id} is shipped with ${keyword} but the derived source does not list it`);
      }
    }
  }

  for (const entry of enums.identityOnlyKeywords) {
    if (entry.name.ko === entry.id || entry.name.en === entry.id) {
      err('invariant', `identity-only keyword ${entry.id} has no localized name; check BattleKeywords.json`);
    }
  }

  // `dominantKeyword` only ever offers a status keyword as an automatic start, because these are
  // the pools that exist. A missing pool would silently hand the player no starting gift.
  for (const keyword of STATUS_KEYWORDS) {
    if ((rules.startGift.poolsByKeyword[keyword] ?? []).length === 0) {
      strict('invariant', `status keyword ${keyword} has no starting gift pool`);
    }
  }

  const noKeyword = identities.filter((i) => i.keywordSource === 'none');
  if (noKeyword.length > 20) {
    strict(
      'invariant',
      `${noKeyword.length} identities have no keywords derived; skill data may be incomplete`,
    );
  }

  // An identity we derive no keyword for shows no keyword at all on screen — no 「?」, no caveat —
  // because the five that do so genuinely inflict none. That is only honest while it stays true, so
  // it is checked against the one source that answers independently: the mirror lists every buff an
  // identity's skills touch, and for these it lists none of ours. A hit here means the derivation
  // regressed and the empty chip has started lying.
  const derivedById = readDerivedIdentities();
  const countable = new Set<string>(IDENTITY_KEYWORDS);
  for (const identity of noKeyword) {
    const entry = derivedById.get(identity.id);
    if (!entry) continue;
    const claimed = [...derivedStatuses(entry)].filter((s) => countable.has(s));
    if (claimed.length > 0) {
      strict(
        'invariant',
        `${identity.id} ${identity.title.ko} derives no keyword, but the mirror says its skills touch ${claimed.join(', ')}`,
      );
    }
  }

  // The roster is the union of every source, not any one of them.
  //
  // The check this replaces only compared against the localization, so an identity that was late in
  // BOTH the static data and the localization was invisible — which is exactly how 10616 동부 섕크
  // 협회 3과 sat missing without a word. Any source knowing an identity we do not ship is an error,
  // whichever source it is.
  const shipped = new Set(identities.map((i) => i.id));
  // Identity ids are 1SSNN for sinners 01-12; anything else is a story or NPC row.
  const playable = (id: number): boolean => id >= 10101 && id <= 11299;
  const roster = new Map<number, string[]>();
  const noteRoster = (id: number, source: string): void => {
    if (!playable(id) || shipped.has(id)) return;
    roster.set(id, [...(roster.get(id) ?? []), source]);
  };

  const localizedIdentities = readJsonIfExists<{ dataList?: { id: number }[] }>(
    repoPath('data/raw/localize/KR/Personalities.json'),
  );
  for (const entry of localizedIdentities?.dataList ?? []) noteRoster(Number(entry.id), '현지화');
  for (const id of readDerivedIdentities().keys()) noteRoster(id, '파생 미러');

  if (roster.size > 0) {
    const named = [...roster].map(([id, sources]) => `${id} (${sources.join(', ')})`);
    strict(
      'invariant',
      `${roster.size} identity/identities are known upstream but not shipped: ${named.join('; ')}. ` +
        `Run \`npm run data:fetch -- --update\`; if they are still absent everywhere, ` +
        `write them into data/curated/identities.json`,
    );
  }

  // The vendored copy going stale is the failure mode behind every missing identity so far, and it
  // is silent by nature: nothing in the data says it is old. The derived source stamps its own
  // refresh time, so compare it against when we last fetched.
  const derivedAt = readDerivedFetchedAt();
  const fetchedAt = meta.sources['eldritchtools']?.fetchedAt;
  if (derivedAt && fetchedAt) {
    const days = (Date.parse(derivedAt) - Date.parse(fetchedAt)) / 86_400_000;
    if (days > 14) {
      warn(
        'invariant',
        `the derived source upstream is ${Math.floor(days)} days newer than our fetch ` +
          `(${derivedAt.slice(0, 10)} vs ${fetchedAt}); run \`npm run data:fetch -- --update\``,
      );
    }
  }

  // What the derived source says the keywords are, against what we derived ourselves. It is the
  // weaker reading — it misses a keyword our static derivation finds on 10 of 179 identities — so a
  // disagreement is a prompt to look, not a failure.
  const STATUS_SET = new Set<string>(STATUS_KEYWORDS);
  const derivedIdentitiesByid = readDerivedIdentities();
  const keywordDisagreements: number[] = [];
  for (const identity of identities) {
    const entry = derivedIdentitiesByid.get(identity.id);
    if (!entry?.skillKeywordList) continue;
    const theirs = derivedKeywords(entry);
    // 탄환·혈찬 are resources the derived list does not track at all — `skillKeywordList` holds
    // inflicted statuses only — so the compare is over the seven. Their own cross-checks are above.
    const ours = new Set(Object.keys(identity.keywords).filter((k) => STATUS_SET.has(k)));
    const same = ours.size === theirs.size && [...ours].every((k) => theirs.has(k as never));
    if (!same) keywordDisagreements.push(identity.id);
  }
  if (keywordDisagreements.length > KEYWORD_DISAGREEMENT_BUDGET) {
    warn(
      'invariant',
      `${keywordDisagreements.length} identities disagree with the derived source on keywords ` +
        `(${keywordDisagreements.slice(0, 12).join(', ')}…); expected at most ` +
        `${KEYWORD_DISAGREEMENT_BUDGET}. A jump here usually means a derivation broke`,
    );
  }

  // Every sinner must be represented: a whole file dropping out of the fetch would otherwise pass
  // the total-count floor while leaving one of the twelve deck slots with nothing to put in it.
  const bySinner = new Map<number, number>();
  for (const identity of identities) bySinner.set(identity.sinnerId, (bySinner.get(identity.sinnerId) ?? 0) + 1);
  for (let sinner = 1; sinner <= SINNER_COUNT; sinner += 1) {
    const count = bySinner.get(sinner) ?? 0;
    // The thinnest sinner has 14 today, so a floor of 10 catches a lost file without tripping on a
    // season rollover.
    if (count < 10) strict('invariant', `sinner ${sinner} has only ${count} identity/identities`);
  }
  const sinnerIds = new Set(enums.sinners.map((s) => s.id));
  for (let sinner = 1; sinner <= SINNER_COUNT; sinner += 1) {
    if (!sinnerIds.has(sinner)) err('invariant', `enums.sinners is missing sinner ${sinner}`);
  }
  for (const sinner of enums.sinners) {
    if (!sinner.name.ko || !sinner.name.en) err('invariant', `sinner ${sinner.id} has no display name`);
  }
}

/**
 * The Mirror Dungeon data, checked against the only living source for it.
 *
 * OpenLethe's capture is frozen, so nothing in our own files can tell us the game moved on. These
 * comparisons can: the moment a new season lands in the derived mirror, the rosters stop matching.
 * They are warnings rather than errors because that source is a supplement — it knows less than the
 * static data on several axes — so a disagreement is a prompt to look, not a broken build.
 */
function checkDerivedMirrorDungeon(gifts: Gift[], packs: ThemePack[], rules: Rules): void {
  if (!derivedMdPresent()) return;
  const theirPacks = readDerivedPacks();
  const theirGifts = readDerivedGifts();
  const theirFloors = readDerivedAvailability();
  const theirStart = readDerivedStartPools();

  const report = (label: string, found: number[], expected: readonly number[], hint: string): void => {
    const sorted = [...found].sort((a, b) => a - b);
    if (JSON.stringify(sorted) === JSON.stringify([...expected])) return;
    const added = sorted.filter((id) => !expected.includes(id));
    warn(
      'invariant',
      `${label}: ${sorted.length} (expected ${expected.length})` +
        `${added.length > 0 ? `, new: ${added.join(', ')}` : ''}. ${hint}`,
    );
  };

  // A pack the static data never shipped has no general gift pool, because this source carries
  // none. That is not a small gap: it is the difference between "this pack can drop 187 general
  // gifts" and "this pack drops nothing but its exclusives", and the planner would believe the
  // latter. Say so as an error — a route built on it would be quietly wrong.
  if (staticDataPresent()) {
    const staticPackIds = new Set(readThemePacks().map((pack) => pack.id));
    const poolless = packs
      .filter((pack) => pack.selectable && !staticPackIds.has(pack.id))
      .map((pack) => `${pack.id} ${pack.name.ko || pack.name.en}`);
    if (poolless.length > 0) {
      err(
        'invariant',
        `${poolless.length} pack(s) are backfilled from the derived source and have no general gift ` +
          `pool: ${poolless.join(', ')}. General gifts cannot be planned through them — get the ` +
          `season's static data (npm run data:import; see docs/research/data-sources.md)`,
      );
    }
  }

  // Rosters. A new season shows up here first, as packs and gifts we have never heard of.
  const ourPackIds = new Set(packs.map((p) => p.id));
  report(
    'packs the derived source knows and we do not ship',
    [...theirPacks.keys()].filter((id) => !ourPackIds.has(id)),
    DERIVED_ONLY_PACKS,
    'A new Mirror Dungeon season has probably started; see docs/research/data-sources.md.',
  );
  const ourGiftIds = new Set(gifts.map((g) => g.id));
  report(
    'gifts the derived source knows and we do not ship',
    [...theirGifts.keys()].filter((id) => !ourGiftIds.has(id)),
    DERIVED_ONLY_GIFTS,
    'A new Mirror Dungeon season has probably started; see docs/research/data-sources.md.',
  );

  // Floors, fusion and start pools all agreed exactly when measured, so any drift is real news.
  const sameFloors = (a: number[], b: number[]): boolean => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));
  const floorDrift = packs
    .filter((pack) => pack.selectable && theirFloors.has(pack.id))
    .filter((pack) => {
      const theirs = theirFloors.get(pack.id)!;
      return (['normal', 'hard', 'parallel', 'extreme'] as const).some(
        (bucket) => !sameFloors(pack.availability[bucket], theirs[bucket]),
      );
    })
    .map((pack) => pack.id);
  if (floorDrift.length > 0) {
    warn('invariant', `${floorDrift.length} pack(s) disagree with the derived source on floors: ${floorDrift.join(', ')}`);
  }

  const recipeDrift = gifts
    .filter((gift) => (gift.fusion?.recipes?.length ?? 0) > 0 && theirGifts.has(gift.id))
    .filter((gift) => {
      const ours = gift.fusion!.recipes.map((r) => [...r.ingredients].sort((a, b) => a - b).join(',')).sort();
      const theirs = derivedFixedRecipes(theirGifts.get(gift.id)!).map((r) => r.join(',')).sort();
      return JSON.stringify(ours) !== JSON.stringify(theirs);
    })
    .map((gift) => gift.id);
  if (recipeDrift.length > 0) {
    warn('invariant', `${recipeDrift.length} fusion recipe(s) disagree with the derived source: ${recipeDrift.join(', ')}`);
  }

  const startDrift = [...theirStart].filter(([keyword, ids]) => {
    const ours = rules.startGift.poolsByKeyword[keyword as keyof typeof rules.startGift.poolsByKeyword];
    return !ours || JSON.stringify([...ours].sort((a, b) => a - b)) !== JSON.stringify(ids);
  });
  if (startDrift.length > 0) {
    warn('invariant', `${startDrift.length} start gift pool(s) disagree with the derived source: ${startDrift.map(([k]) => k).join(', ')}`);
  }

  const tierDrift = gifts
    .filter((gift) => theirGifts.has(gift.id))
    .filter((gift) => {
      const theirs = derivedTier(theirGifts.get(gift.id)!);
      return theirs !== null && theirs !== gift.tier;
    })
    .map((gift) => gift.id);
  if (tierDrift.length > 0) {
    warn('invariant', `${tierDrift.length} gift tier(s) disagree with the derived source: ${tierDrift.slice(0, 12).join(', ')}`);
  }
}

/**
 * A curated identity is a backfill, so it has to stay one: it must name an identity the game
 * actually has, it must not shadow a static record, and it must reach the output.
 */
function checkCuratedIdentities(identities: Identity[]): void {
  const curated = readJsonIfExists<Record<string, unknown>>(repoPath('data/curated/identities.json'));
  if (!curated) return;
  const localized = readJsonIfExists<{ dataList?: { id: number }[] }>(
    repoPath('data/raw/localize/KR/Personalities.json'),
  );
  const localizedIds = new Set((localized?.dataList ?? []).map((e) => Number(e.id)));
  const staticIds = staticDataPresent() ? new Set(readPersonalities().map((p) => p.id)) : null;
  const shipped = new Set(identities.map((i) => i.id));

  for (const key of Object.keys(curated)) {
    if (key.startsWith('_')) continue;
    const id = Number(key);
    if (!Number.isFinite(id)) {
      err('invariant', `curated identity key "${key}" is not an id`);
      continue;
    }
    if (localizedIds.size > 0 && !localizedIds.has(id)) {
      err('invariant', `curated identity ${id} is in no localization row; the game has no such identity`);
    }
    if (staticIds?.has(id)) {
      err(
        'invariant',
        `curated identity ${id} now has static data; delete it from data/curated/identities.json`,
      );
    }
    if (!shipped.has(id)) err('invariant', `curated identity ${id} did not reach public/data/identities.json`);
  }
}

function checkCuratedOverrides(gifts: Gift[], packs: ThemePack[], identities: Identity[]): void {
  const giftIds = new Set(gifts.map((g) => g.id));
  const packIds = new Set(packs.map((p) => p.id));
  const identityIds = new Set(identities.map((i) => i.id));

  const check = (file: string, ids: Iterable<string>, known: Set<number>, label: string): void => {
    for (const raw of ids) {
      if (raw.startsWith('_')) continue;
      const id = Number(raw);
      if (!Number.isFinite(id) || !known.has(id)) {
        err('invariant', `curated override ${file} references unknown ${label} id "${raw}"`);
      }
    }
  };

  const conditions = readJsonIfExists<Record<string, unknown>>(repoPath('data/curated/conditions.json'));
  if (conditions) check('conditions.json', Object.keys(conditions), giftIds, 'gift');

  const identityKeywords = readJsonIfExists<Record<string, unknown>>(
    repoPath('data/curated/identity-keywords.json'),
  );
  if (identityKeywords)
    check('identity-keywords.json', Object.keys(identityKeywords), identityIds, 'identity');

  const names = readJsonIfExists<{
    gifts?: Record<string, unknown>;
    packs?: Record<string, unknown>;
    identities?: Record<string, unknown>;
  }>(repoPath('data/curated/names-override.json'));
  if (names) {
    check('names-override.json gifts', Object.keys(names.gifts ?? {}), giftIds, 'gift');
    check('names-override.json packs', Object.keys(names.packs ?? {}), packIds, 'pack');
    check('names-override.json identities', Object.keys(names.identities ?? {}), identityIds, 'identity');
  }

  const notes = readJsonIfExists<{ gifts?: Record<string, unknown>; packs?: Record<string, unknown> }>(
    repoPath('data/curated/notes.json'),
  );
  if (notes) {
    check('notes.json gifts', Object.keys(notes.gifts ?? {}), giftIds, 'gift');
    check('notes.json packs', Object.keys(notes.packs ?? {}), packIds, 'pack');
  }
}

/**
 * `index.json` against the season directories on disk.
 *
 * The app reads the index and nothing else to decide which seasons exist, so a directory that is
 * not listed is invisible and an entry with no directory is a 404 at boot. Frozen seasons get
 * their schema checked here — nothing but a hand edit can change them, and that is exactly what
 * this catches.
 */
function checkSeasonIndex(): void {
  if (!index) return;
  const onDisk = existsSync(OUT)
    ? readdirSync(OUT)
        .filter((entry) => /^md\d+$/.test(entry) && statSync(join(OUT, entry)).isDirectory())
        .map((entry) => Number(entry.slice(2)))
        .sort((a, b) => a - b)
    : [];
  const listed = index.seasons.map((entry) => entry.id).sort((a, b) => a - b);
  for (const id of onDisk) {
    if (!listed.includes(id)) err('invariant', `public/data/md${id} exists but index.json does not list it`);
  }
  for (const id of listed) {
    if (!onDisk.includes(id)) {
      err('invariant', `index.json lists season ${id} but public/data/md${id} is missing`);
      continue;
    }
    for (const name of SEASON_FILES) {
      if (!existsSync(outPath(name, id))) err('schema', `${outRelPath(name, id)} is missing`);
    }
  }
  if (!listed.includes(index.default)) {
    err('invariant', `index.json opens season ${index.default}, which it does not list`);
  }

  // Each entry must still describe its season: the index is a copy, and a copy can go stale.
  for (const entry of index.seasons) {
    if (entry.id === season) {
      if (meta && entry.dataVersion !== meta.dataVersion) {
        err(
          'invariant',
          `index.json says season ${entry.id} is ${entry.dataVersion}, ${outRelPath('meta', entry.id)} says ` +
            `${meta.dataVersion}. Run: npm run data:build`,
        );
      }
      if (rules) {
        const lastFloor = Math.max(...Object.values(rules.floors).flat());
        if (entry.lastFloor !== lastFloor) {
          err('invariant', `index.json says season ${entry.id} ends at floor ${entry.lastFloor}, rules.json says ${lastFloor}`);
        }
      }
      if (meta && entry.provisional !== meta.provisional) {
        err('invariant', `index.json and ${outRelPath('meta', entry.id)} disagree on whether season ${entry.id} is provisional`);
      }
    } else {
      const frozenMeta = parseAt(outPath('meta', entry.id), outRelPath('meta', entry.id), metaSchema);
      parseAt(outPath('rules', entry.id), outRelPath('rules', entry.id), rulesSchema);
      if (frozenMeta && frozenMeta.dataVersion !== entry.dataVersion) {
        err('invariant', `index.json says season ${entry.id} is ${entry.dataVersion}, its meta.json says ${frozenMeta.dataVersion}`);
      }
    }
    if (entry.provisional) {
      warn(
        'invariant',
        `season ${entry.id} is provisional: a selectable pack has no general gift pool, so general ` +
          `gifts cannot be planned through it. Get the season's static data (npm run data:import).`,
      );
    }
  }
}

checkSeasonIndex();

/** Generated output older than its inputs means someone forgot to rebuild. */
function checkFreshness(): void {
  const metaPath = outPath('meta', season);
  if (!existsSync(metaPath)) return;
  const builtAt = statSync(metaPath).mtimeMs;
  const newer: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (entry.endsWith('.json') && st.mtimeMs > builtAt)
        newer.push(full.replace(`${repoPath('')}/`, ''));
    }
  };
  walk(repoPath('data/raw'));
  walk(repoPath('data/curated'));
  if (newer.length > 0) {
    warn(
      'stale',
      `${newer.length} input file(s) are newer than the built season (e.g. ${newer[0]}). Run: npm run data:build`,
    );
  }
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);

if (errors.length > 0) {
  console.error(`\ndata:validate failed with ${errors.length} error(s) and ${warnings.length} warning(s).`);
  process.exit(1);
}
console.log(`data:validate passed${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.`);

/**
 * The derived, English-only identity data behind the limbus.tools sites
 * (`eldritchtools/limbus-assets`), read for the identities the static data has not shipped.
 *
 * The game's own static records stay the source of truth wherever they exist. This fills the gap
 * that opens between a patch and the static mirror catching up — which, with the mirror we had,
 * never closed at all. It says which skills are attacks, the sins and attack types, the rank and
 * the association tags; the keywords themselves still come from the Korean skill text, because
 * this list knows less (10 of 179 identities, measured).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, repoPath } from './io.ts';
import type { AttackType, IdentitySkill, IdentityKeywordId, Sin } from '../../src/core/schema.ts';
import { sortIdentitySkills } from './derive.ts';

export const DERIVED_DIR = repoPath('data/raw/derived/eldritchtools');

interface DerivedSkill {
  id: string;
  num?: number;
  type?: { affinity?: string; type?: string; tier?: number };
}

export interface DerivedIdentity {
  name?: string;
  sinnerId?: number;
  rank?: number;
  season?: number;
  /** Release date, `YYYY-MM-DD`. The only freshness signal any source gives us per identity. */
  date?: string;
  skillKeywordList?: string[];
  /**
   * Every buff id this source says the identity's skills touch — `["AttackDown","Sinking",…]`.
   * Wider than `skillKeywordList`: it is not filtered to attack skills and it uses raw game ids,
   * so it cannot replace our derivation. It is exact about *absence*, which is what we use it for.
   */
  statuses?: string[];
  /** Exactly the base attack skills — the counterpart of the static `attributeList`. */
  skillTypes?: DerivedSkill[];
  defenseSkillTypes?: DerivedSkill[];
  tags?: string[];
}

/** English keyword names as this source writes them, mapped to the ids the app uses. */
export const KEYWORD_BY_EN: Record<string, IdentityKeywordId> = {
  Burn: 'Combustion',
  Bleed: 'Laceration',
  Tremor: 'Vibration',
  Rupture: 'Burst',
  Sinking: 'Sinking',
  Poise: 'Breath',
  Charge: 'Charge',
};

const SIN_BY_AFFINITY: Record<string, Sin> = {
  wrath: 'WRATH',
  lust: 'LUST',
  sloth: 'SLOTH',
  gluttony: 'GLUTTONY',
  gloom: 'GLOOM',
  pride: 'PRIDE',
  envy: 'ENVY',
};

const ATTACK_BY_TYPE: Record<string, AttackType> = {
  slash: 'Slash',
  pierce: 'Penetrate',
  blunt: 'Hit',
};

/**
 * Tags this source spells differently from the localization, so the name lookup misses them.
 *
 * Only associations matter here: the tag list also carries display-only labels (`Fixer`,
 * `E.G.O Gear`, `Base Identity`) that are not factions and are meant to fall through.
 */
const FACTION_BY_TAG: Record<string, string> = {
  'L Corp.': 'L_CORP',
};

export function derivedDataPresent(): boolean {
  return existsSync(join(DERIVED_DIR, 'data', 'identities.json'));
}

export function readDerivedIdentities(): Map<number, DerivedIdentity> {
  const out = new Map<number, DerivedIdentity>();
  if (!derivedDataPresent()) return out;
  const raw = readJson<Record<string, DerivedIdentity>>(join(DERIVED_DIR, 'data', 'identities.json'));
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key);
    if (Number.isFinite(id)) out.set(id, value);
  }
  return out;
}

/** When this source was last refreshed upstream, as an ISO timestamp, or null if not vendored. */
export function readDerivedFetchedAt(): string | null {
  const path = join(DERIVED_DIR, 'meta.json');
  if (!existsSync(path)) return null;
  return readJson<{ datetime?: string }>(path).datetime ?? null;
}

/** The keywords this source claims for an identity, as app ids. Ammo is not covered by it. */
export function derivedKeywords(entry: DerivedIdentity): Set<IdentityKeywordId> {
  const out = new Set<IdentityKeywordId>();
  for (const name of entry.skillKeywordList ?? []) {
    const keyword = KEYWORD_BY_EN[name];
    if (keyword) out.add(keyword);
  }
  return out;
}

/**
 * The raw buff ids this source says the identity touches, whatever the skill. We never derive from
 * it — it does not separate attack skills from passives, nor inflicting from spending — but an id
 * missing here is strong evidence the identity does not touch it at all, which is how the build
 * checks that an identity we derive no keyword for really has none.
 */
export function derivedStatuses(entry: DerivedIdentity): Set<string> {
  return new Set(entry.statuses ?? []);
}

/** The ids of the base attack skills, which this source lists outright. */
export function derivedAttackSkillIds(entry: DerivedIdentity): number[] {
  return (entry.skillTypes ?? []).map((s) => Number(s.id)).filter((id) => Number.isFinite(id));
}

export function derivedSins(entry: DerivedIdentity): Sin[] {
  const out = new Set<Sin>();
  for (const skill of entry.skillTypes ?? []) {
    const sin = skill.type?.affinity ? SIN_BY_AFFINITY[skill.type.affinity] : undefined;
    if (sin) out.add(sin);
  }
  return [...out];
}

/**
 * The base attack skills as a per-slot table — the derived counterpart of `deriveIdentitySkills`.
 *
 * This source states the slot outright (`type.tier`), so a backfilled identity loses nothing: the
 * four identities the static mirror never shipped answer 「몇 번 스킬이 무슨 속성인가」 as fully as
 * the other 183.
 *
 * Per-slot keywords are the one thing it cannot give: a `DerivedSkill` carries affinity, type and
 * tier and nothing else, and `skillKeywordList` is stated for the identity as a whole. So the rows
 * come back with empty keywords, which readers must take as 「모른다」 rather than 「없다」 — the
 * 「스킬」 tab says how many identities it could not answer for instead of counting them as no.
 */
export function derivedSkills(entry: DerivedIdentity): IdentitySkill[] {
  const rows: { skill: IdentitySkill; id: number }[] = [];
  for (const skill of entry.skillTypes ?? []) {
    const tier = skill.type?.tier;
    if (tier !== 1 && tier !== 2 && tier !== 3) continue;
    const id = Number(skill.id);
    rows.push({
      id: Number.isFinite(id) ? id : 0,
      skill: {
        slot: tier,
        sin: skill.type?.affinity ? (SIN_BY_AFFINITY[skill.type.affinity] ?? null) : null,
        attackType: skill.type?.type ? (ATTACK_BY_TYPE[skill.type.type] ?? null) : null,
        copies: Math.max(0, skill.num ?? 0),
        keywords: { base: [], special: [] },
      },
    });
  }
  return sortIdentitySkills(rows);
}

export function derivedAttackTypes(entry: DerivedIdentity): AttackType[] {
  const out = new Set<AttackType>();
  for (const skill of entry.skillTypes ?? []) {
    const type = skill.type?.type ? ATTACK_BY_TYPE[skill.type.type] : undefined;
    if (type) out.add(type);
  }
  return [...out];
}

/**
 * The associations an identity belongs to, translated from display tags back into faction ids.
 *
 * `factionByName` inverts the English names the localization already gives us, so the mapping is
 * data rather than a table; `known` keeps display-only tags from becoming factions.
 */
export function derivedFactions(
  entry: DerivedIdentity,
  factionByName: Map<string, string>,
  known: ReadonlySet<string>,
): string[] {
  const out = new Set<string>();
  for (const tag of entry.tags ?? []) {
    const id = FACTION_BY_TAG[tag] ?? factionByName.get(tag);
    if (id && known.has(id)) out.add(id);
  }
  return [...out];
}

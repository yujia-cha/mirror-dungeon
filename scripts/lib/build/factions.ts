import { cleanFactionName } from '../derive.ts';
import type { Localized } from '../../../src/core/schema.ts';
import type { Sources } from './load.ts';
import { curatedEntries } from './util.ts';

export interface Factions {
  nameById: Map<string, Localized>;
  deprecated: Set<string>;
  /** Ids with no Korean display name — reported, not guessed. */
  unnamed: string[];
  /** Korean display name -> faction id, for the condition parser. Longest names win on collision. */
  idByName: Map<string, string>;
}

export function deriveFactions(src: Sources): Factions {
  const { curated, rawPersonalities, factionKo, factionEn } = src;

  const factionIds = new Set<string>();
  for (const p of rawPersonalities) for (const id of p.associationList ?? []) factionIds.add(id);
  for (const [id] of curatedEntries(curated.factions)) factionIds.add(id);

  const nameById = new Map<string, Localized>();
  const deprecated = new Set<string>();
  const unnamed: string[] = [];

  for (const id of [...factionIds].sort()) {
    const override = curated.factions[id];
    const rawKo = factionKo.get(id);
    const rawEn = factionEn.get(id);
    const ko = override?.ko ?? (rawKo ? cleanFactionName(rawKo).name : '');
    const en = override?.en ?? (rawEn ? cleanFactionName(rawEn).name : '');
    if (rawKo && cleanFactionName(rawKo).deprecated) deprecated.add(id);
    if (!ko) unnamed.push(id);
    nameById.set(id, { ko: ko || id, en: en || ko || id });
  }

  const idByName = new Map<string, string>();
  for (const [id, name] of [...nameById].sort((a, b) => b[1].ko.length - a[1].ko.length)) {
    if (name.ko && !idByName.has(name.ko)) idByName.set(name.ko, id);
  }
  // Trait-only names (엄지, 거미집 …) also appear in condition text, so accept them too.
  for (const [id, raw] of factionKo) {
    const { name } = cleanFactionName(raw);
    if (name && !idByName.has(name)) idByName.set(name, id);
  }

  return { nameById, deprecated, unnamed, idByName };
}

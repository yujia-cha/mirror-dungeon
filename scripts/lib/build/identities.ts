import { SIN_BY_COLOR, isBattlePassiveOf, type LocalizedSkill } from '../raw.ts';
import {
  baseAttackSkillIds,
  buffIdsInSkill,
  countSkillKeywords,
  deriveSkillKeywords,
  selfUseInSkill,
  sinnerIdFromIdentityId,
  skillDiscards,
} from '../derive.ts';
import {
  buffIdsInSkillText,
  buffIdsInText,
  consumedKeywordsInSkillText,
  deriveSkillKeywordsFromText,
  keywordsInSkillText,
  mechanicsInSkillText,
  selfKeywordsInSkillText,
  skillsOfIdentity,
  skillTextDiscards,
  specialAmmoFamiliesOf,
} from '../derive-text.ts';
import {
  ATTACK_TYPE_BY_RAW,
  defenseTypesOf,
  defTypesOfSkill,
  derivedSkillFacts,
  selfFlags,
  staticSkillFacts,
} from '../identity-skills.ts';
import {
  derivedAttackSkillIds,
  derivedAttackTypes,
  derivedFactions,
  derivedSins,
  derivedStatuses,
} from '../derived-source.ts';
import { SINS, type Identity, type Localized, type Sin } from '../../../src/core/schema.ts';
import { fail } from './errors.ts';
import type { Sources } from './load.ts';
import { applyNameOverride, curatedEntries, loc } from './util.ts';

export interface IdentitySet {
  identities: Identity[];
  /** Indexed by sinner id 1~12 (index 0 unused). */
  sinnerNames: Localized[];
  /** `defType` values on a defense skill that name no defense kind — reported, never guessed. */
  unknownDefTypes: Map<string, number[]>;
}

/**
 * Three sources, in descending order of authority: the game's own static records, the derived
 * mirror plus the Korean skill text, and finally a row written by hand. Each layer only fills what
 * the one above it does not have, and the build stops if a lower layer shadows a higher one — a
 * stopgap must never outlive the real data.
 */
export function deriveIdentities(src: Sources): IdentitySet {
  const {
    curated,
    rawPersonalities,
    skills,
    personalityKo,
    personalityEn,
    factionEn,
    localizedSkills,
    specialVariants,
    knownBuffIds,
    passiveTexts,
    battlePassiveIds,
    derivedIdentitySource,
  } = src;

  const sinnerNames: Localized[] = [];
  for (let sinner = 1; sinner <= 12; sinner += 1) {
    const baseId = 10000 + sinner * 100 + 1;
    sinnerNames[sinner] = loc(personalityKo.get(baseId)?.name, personalityEn.get(baseId)?.name);
  }

  const unknownDefTypes = new Map<string, number[]>();

  /**
   * The buffs an identity brings (M129): what its base attack and defense skills' scripts give or
   * spend (`buffIdsInSkill`), what the same skills' and its battle passives' KR text grants
   * (`buffIdsInText` — a passive has no scripts at all), and what it enters battle with.
   */
  function identityBuffs(
    skillIds: number[],
    passiveIds: number[],
    initBuffs: string[],
    texts: Map<number, LocalizedSkill>,
    more: Iterable<string> = [],
  ): string[] {
    const out = new Set<string>([...initBuffs, ...more]);
    for (const id of skillIds) {
      const skill = skills.get(id);
      if (skill) for (const buff of buffIdsInSkill(skill, specialVariants)) out.add(buff);
      const text = texts.get(id);
      if (text) for (const buff of buffIdsInSkillText(text, knownBuffIds)) out.add(buff);
    }
    for (const id of passiveIds) {
      const text = passiveTexts.get(id);
      if (text) for (const buff of buffIdsInText(text, knownBuffIds)) out.add(buff);
    }
    return [...out].sort();
  }

  /**
   * `['Discard']` when one of the base attack skills discards the user's own skills (M129 — 버림 is a
   * skill mechanic no `buffKeyword` carries, so it joins `buffs` under the id the gift text uses,
   * `[Discard]`): the scripts (`skillDiscards`) or the sentence (`skillTextDiscards`).
   */
  function discardsOf(attackIds: number[], texts: Map<number, LocalizedSkill>): string[] {
    return attackIds.some((id) => {
      const skill = skills.get(id);
      const text = texts.get(id);
      return (skill && skillDiscards(skill)) || (text && skillTextDiscards(text));
    })
      ? ['Discard']
      : [];
  }

  const derivedIdentities: Identity[] = rawPersonalities.map((raw): Identity => {
    const sinnerId = sinnerIdFromIdentityId(raw.id);
    const curatedKeywords = curated.identityKeywords[String(raw.id)]?.keywords;
    // 혈찬 is spent, never inflicted, and the static data says nothing machine-readable about it —
    // only the Korean sentence does. So it is read separately and merged over what the skill data
    // gives; a curated entry still wins outright.
    // The Korean sentence of each base skill is a second reading of what it gives, joined per skill
    // with the skill data — it is the only place some grants are written: 11115's 화상, and the 특수
    // 충전 that 10312·10416·10816 gain, which the skill data stores as plain `Charge` while the
    // sentence names the variant (`ThePowerOfLoveAndHate`, `ChargeNoirAlly`, `ChargeRougeAlly`).
    const texts = skillsOfIdentity(raw.id, localizedSkills);
    const textById = new Map(texts.map((skill) => [skill.id, skill]));
    const ammoFamilies = specialAmmoFamiliesOf(texts, specialVariants);
    const attackIds = baseAttackSkillIds(raw);
    // One keyword set per base skill (M129 `skills[].keywords`); the identity's counts are their sum,
    // so the two cannot drift apart.
    const perSkill = deriveSkillKeywords(raw, skills, specialVariants, {
      alsoFrom: (skillId) => {
        const text = textById.get(skillId);
        return text ? keywordsInSkillText(text, specialVariants, ammoFamilies) : undefined;
      },
    });
    for (const id of attackIds) {
      const text = textById.get(id);
      const consumed = text ? consumedKeywordsInSkillText(text) : new Set<never>();
      if (consumed.size === 0) continue;
      const entry = perSkill.get(id) ?? { base: new Set(), special: new Set() };
      for (const kw of consumed) entry.base.add(kw);
      perSkill.set(id, entry);
    }
    const derived = countSkillKeywords(perSkill.values());
    const keywords = (curatedKeywords ?? derived) as Identity['keywords'];
    const keywordSource: Identity['keywordSource'] = curatedKeywords
      ? 'curated'
      : Object.keys(derived).length > 0
        ? 'derived'
        : 'none';

    const sins = new Set<Identity['sins'][number]>();
    const attackTypes = new Set<Identity['attackTypes'][number]>();
    // Same three skills as the keywords: an enhanced skill's sin or attack type is not the identity's.
    for (const skillId of attackIds) {
      const data = skills.get(skillId)?.skillData?.[0];
      const sin = data?.attributeType ? SIN_BY_COLOR[data.attributeType] : undefined;
      if (sin) sins.add(sin);
      const attackType = data?.atkType ? ATTACK_TYPE_BY_RAW[data.atkType] : undefined;
      if (attackType) attackTypes.add(attackType);
    }

    // What each base skill does with a 디버프 on its own user (M129 `skills[].self`): the scripts and
    // the sentence joined per skill, as the keywords are.
    const skillFacts = attackIds
      .map((id) => {
        const skill = skills.get(id);
        const text = textById.get(id);
        const self = selfFlags(
          skill ? selfUseInSkill(skill) : undefined,
          text ? selfKeywordsInSkillText(text) : undefined,
        );
        return staticSkillFacts(id, skill, perSkill.get(id), self, text ? mechanicsInSkillText(text) : []);
      })
      .sort((a, b) => a.slot - b.slot);
    if (new Set(skillFacts.map((s) => s.slot)).size !== skillFacts.length)
      fail(`identity ${raw.id} has two base attack skills in one slot: ${attackIds.join(', ')}`);
    const defenseIds = raw.defenseSkillIDList ?? [];
    const defense = defenseTypesOf(defenseIds.flatMap((id) => defTypesOfSkill(skills.get(id))));
    for (const value of defense.unknown)
      unknownDefTypes.set(value, [...(unknownDefTypes.get(value) ?? []), raw.id]);
    const buffs = identityBuffs(
      [...attackIds, ...defenseIds],
      battlePassiveIds.get(raw.id) ?? [],
      (raw.initBuffList ?? [])
        .flatMap((level) => (level.list ?? []).map((b) => b.buff ?? ''))
        .filter(Boolean),
      textById,
      discardsOf(attackIds, textById),
    );

    const title = loc(
      personalityKo.get(raw.id)?.title?.replace(/\s*\n\s*/g, ' '),
      personalityEn.get(raw.id)?.title?.replace(/\s*\n\s*/g, ' '),
    );

    return {
      id: raw.id,
      sinnerId,
      sinner: sinnerNames[sinnerId] ?? loc('', ''),
      title: applyNameOverride(title, curated.names.identities?.[String(raw.id)]),
      rank: Math.min(3, Math.max(1, raw.rank ?? 1)) as 1 | 2 | 3,
      season: raw.season ?? 0,
      factions: [...(raw.associationList ?? [])].sort(),
      traits: [...(raw.unitKeywordList ?? [])].sort(),
      keywords,
      keywordSource,
      sins: [...sins].sort((a, b) => SINS.indexOf(a) - SINS.indexOf(b)),
      attackTypes: [...attackTypes].sort(),
      skills: skillFacts,
      defenseTypes: defense.types,
      buffs,
    };
  });

  // -------------------------------------------------------------------------
  // Identities the static data does not ship
  // -------------------------------------------------------------------------

  const staticIdentityIds = new Set(derivedIdentities.map((identity) => identity.id));

  /** English faction names inverted, so a derived tag can be read back as the id the app uses. */
  const factionIdByEnglishName = new Map<string, string>();
  for (const [id, name] of factionEn)
    if (!factionIdByEnglishName.has(name)) factionIdByEnglishName.set(name, id);
  // A new association the localization does not name yet (르루주 · 시지프) is named in the curated
  // file; without this the derived mirror's "Le Rouge" tag could not find its way back to LE_ROUGE.
  for (const [id, names] of curatedEntries(curated.factions)) {
    if (names.en && !factionIdByEnglishName.has(names.en)) factionIdByEnglishName.set(names.en, id);
  }
  const knownFactionIds = new Set<string>(
    rawPersonalities
      .flatMap((raw) => raw.associationList ?? [])
      .concat(curatedEntries(curated.factions).map(([id]) => id)),
  );

  function titleFor(id: number): Localized {
    return applyNameOverride(
      loc(
        personalityKo.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
        personalityEn.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
      ),
      curated.names.identities?.[String(id)],
    );
  }

  /**
   * An identity assembled from the derived mirror and the Korean skill text.
   *
   * The mirror lists the base attack skills outright, so the keyword derivation is told which skills
   * to read rather than guessing; the Korean text is what actually names the keywords, because the
   * mirror's own list is the weaker of the two.
   */
  const backfilledIdentities: Identity[] = [...derivedIdentitySource.entries()]
    .filter(
      ([id]) =>
        !staticIdentityIds.has(id) && sinnerIdFromIdentityId(id) >= 1 && sinnerIdFromIdentityId(id) <= 12,
    )
    .filter(([id]) => personalityKo.has(id))
    .map(([id, entry]): Identity => {
      const sinnerId = entry.sinnerId ?? sinnerIdFromIdentityId(id);
      const attackIds = derivedAttackSkillIds(entry);
      const texts = skillsOfIdentity(id, localizedSkills);
      const perSkill = deriveSkillKeywordsFromText(
        texts,
        specialVariants,
        attackIds.length > 0 ? attackIds : undefined,
      );
      const keywords = countSkillKeywords(perSkill.values()) as Identity['keywords'];
      const textById = new Map(texts.map((t) => [t.id, t]));
      const skillFacts = derivedSkillFacts(
        entry,
        perSkill,
        new Map(
          attackIds.flatMap((sid) =>
            textById.has(sid) ? [[sid, selfKeywordsInSkillText(textById.get(sid)!)]] : [],
          ),
        ),
        new Map(
          attackIds.flatMap((sid) =>
            textById.has(sid) ? [[sid, mechanicsInSkillText(textById.get(sid)!)]] : [],
          ),
        ),
      );
      const defenseIds = (entry.defenseSkillTypes ?? []).map((s) => Number(s.id)).filter(Number.isFinite);
      const defense = defenseTypesOf((entry.defenseSkillTypes ?? []).map((s) => s.type?.type?.toUpperCase()));
      for (const value of defense.unknown)
        unknownDefTypes.set(value, [...(unknownDefTypes.get(value) ?? []), id]);
      // No static passive list either: a passive id is `<identity><suffix>`, battle under 20.
      const passives = [...passiveTexts.keys()].filter((p) => isBattlePassiveOf(p, id)).sort((a, b) => a - b);
      const buffs = identityBuffs([...attackIds, ...defenseIds], passives, [], textById, [
        ...derivedStatuses(entry),
        ...discardsOf(attackIds, textById),
      ]);
      return {
        id,
        sinnerId,
        sinner: sinnerNames[sinnerId] ?? loc('', ''),
        title: titleFor(id),
        rank: Math.min(3, Math.max(1, entry.rank ?? 1)) as 1 | 2 | 3,
        season: entry.season ?? 0,
        factions: derivedFactions(entry, factionIdByEnglishName, knownFactionIds).sort(),
        // The derived tags carry no size or appearance traits, and nothing reads them anyway.
        traits: [],
        keywords,
        keywordSource: 'backfilled',
        sins: derivedSins(entry).sort((a, b) => SINS.indexOf(a) - SINS.indexOf(b)),
        attackTypes: derivedAttackTypes(entry).sort(),
        // A mirror entry naming no base skill leaves `skills` out: the text heuristic chose the
        // skills then, and a list of none would contradict the counts above.
        ...(skillFacts.length > 0 ? { skills: skillFacts } : {}),
        defenseTypes: defense.types,
        buffs,
      };
    })
    .sort((a, b) => a.id - b.id);

  const backfilledIds = new Set(backfilledIdentities.map((identity) => identity.id));

  /** The last resort: a row written by hand for an identity no source has yet. */
  const curatedIdentities: Identity[] = curatedEntries(curated.identities).map(([key, entry]) => {
    const id = Number(key);
    if (!Number.isFinite(id)) fail(`curated identity key "${key}" is not an id`);
    if (staticIdentityIds.has(id)) {
      fail(
        `curated identity ${id} now has static data upstream; ` +
          `delete its entry from data/curated/identities.json so the real record is used`,
      );
    }
    if (backfilledIds.has(id)) {
      fail(
        `curated identity ${id} is now covered by the derived source; ` +
          `delete its entry from data/curated/identities.json so the fetched data is used`,
      );
    }
    const sinnerId = sinnerIdFromIdentityId(id);
    const title = loc(
      personalityKo.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
      personalityEn.get(id)?.title?.replace(/\s*\n\s*/g, ' '),
    );
    if (!title.ko)
      fail(`curated identity ${id} is not in the localization either; there is nothing to name it`);
    return {
      id,
      sinnerId,
      sinner: sinnerNames[sinnerId] ?? loc('', ''),
      title: applyNameOverride(title, curated.names.identities?.[key]),
      rank: Math.min(3, Math.max(1, entry.rank ?? 1)) as 1 | 2 | 3,
      season: entry.season ?? 0,
      factions: [...(entry.factions ?? [])].sort(),
      traits: [...(entry.traits ?? [])].sort(),
      keywords: (entry.keywords ?? {}) as Identity['keywords'],
      keywordSource: 'curated',
      sins: [...(entry.sins ?? [])].sort(
        (a, b) => SINS.indexOf(a as Sin) - SINS.indexOf(b as Sin),
      ) as Identity['sins'],
      attackTypes: [...(entry.attackTypes ?? [])].sort() as Identity['attackTypes'],
    };
  });

  const identities = [...derivedIdentities, ...backfilledIdentities, ...curatedIdentities].sort(
    (a, b) => a.id - b.id,
  );

  return { identities, sinnerNames, unknownDefTypes };
}

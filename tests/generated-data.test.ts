/**
 * Assertions against the real generated data in public/data.
 *
 * These are the facts the planner and the UI rely on. When the game changes they will fail, which
 * is the point: a change here should be read and understood, not auto-updated.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SkillTrigger } from '../src/core/schema.ts';
import {
  enumsSchema,
  giftsFileSchema,
  identitiesFileSchema,
  metaSchema,
  packsFileSchema,
  rulesSchema,
  seasonIndexSchema,
} from '../src/core/schema.ts';
import { PADDED_BRACKET, RICH_TEXT_TAG, RUNTIME_PLACEHOLDER } from '../src/core/text.ts';

/** An expected trigger, spelling out only the axes a case is about. */
function trigger(partial: Partial<SkillTrigger>): SkillTrigger {
  return {
    sin: null,
    attackType: null,
    keywords: [],
    verb: 'inflict',
    includesSpecial: false,
    subject: 'skill',
    slots: [],
    effect: 'gate',
    ...partial,
  };
}

const DATA = resolve(process.cwd(), 'public/data');
const index = seasonIndexSchema.parse(JSON.parse(readFileSync(resolve(DATA, 'index.json'), 'utf8')));
/** The season `index.json` opens: the one the vendored raw data describes. */
const season = index.default;
/** Season-owned files live in the season's directory; `enums` and `identities` are shared. */
const read = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      ['meta.json', 'rules.json', 'gifts.json', 'packs.json'].includes(name)
        ? resolve(DATA, `md${season}`, name)
        : resolve(DATA, name),
      'utf8',
    ),
  );

const meta = metaSchema.parse(read('meta.json'));
const enums = enumsSchema.parse(read('enums.json'));
const rules = rulesSchema.parse(read('rules.json'));
const gifts = giftsFileSchema.parse(read('gifts.json'));
const packs = packsFileSchema.parse(read('packs.json'));
const identities = identitiesFileSchema.parse(read('identities.json'));

const giftById = new Map(gifts.map((g) => [g.id, g]));
const packById = new Map(packs.map((p) => [p.id, p]));
const identityById = new Map(identities.map((i) => [i.id, i]));

describe('meta', () => {
  it('describes Mirror Dungeon 7', () => {
    expect(meta.dungeon.id).toBe(7);
    expect(meta.dungeon.name.ko).toBe('이름과 거미의 거울');
    expect(rules.dungeonId).toBe(7);
  });

  it('records which upstream commits the data came from, per language where they differ', () => {
    expect(meta.sources.openLethe?.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(meta.sources.eldritchtools?.sha).toMatch(/^[0-9a-f]{40}$/);
    // The localization mirror keeps each language on its own branch, so it has no single revision.
    expect(meta.sources.localize?.languages?.KR).toMatch(/^[0-9a-f]{40}$/);
    expect(meta.sources.localize?.languages?.EN).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('theme packs', () => {
  it('has the full Mirror Dungeon 7 pack list', () => {
    expect(packs).toHaveLength(116);
    expect(packs.filter((p) => p.selectable)).toHaveLength(115);
  });

  it('marks 선의의 순례 unselectable because it is story-dungeon only', () => {
    const pack = packById.get(1122)!;
    expect(pack.name.ko).toBe('선의의 순례');
    expect(pack.selectable).toBe(false);
  });

  it('places 잊혀진 자들 on floor 1 of both Normal and Hard', () => {
    const pack = packById.get(1001)!;
    expect(pack.name.ko).toBe('잊혀진 자들');
    expect(pack.availability.normal).toEqual([1]);
    expect(pack.availability.hard).toEqual([1]);
  });

  it('places 교본 on Hard floor 5 and in 평행중첩, never on Normal', () => {
    const pack = packById.get(1025)!;
    expect(pack.name.ko).toBe('교본');
    expect(pack.availability.normal).toEqual([]);
    expect(pack.availability.hard).toEqual([5]);
    expect(pack.availability.parallel).toEqual([6, 7, 8, 9, 10]);
  });

  it('keeps every keyword pack off Normal difficulty', () => {
    const keywordPacks = packs.filter((p) => p.group === 'keyword' && p.selectable);
    expect(keywordPacks).toHaveLength(14);
    for (const pack of keywordPacks) {
      expect(pack.availability.normal, `${pack.id} ${pack.name.ko}`).toEqual([]);
      expect(pack.keywordAffinity).not.toBeNull();
    }
  });

  it('restricts long-battle packs to EXTREME floors 11-15', () => {
    const longBattle = packs.filter((p) => p.group === 'longBattle');
    expect(longBattle).toHaveLength(20);
    for (const pack of longBattle) {
      expect(pack.availability.extreme).toEqual([11, 12, 13, 14, 15]);
      expect([...pack.availability.normal, ...pack.availability.hard, ...pack.availability.parallel]).toEqual(
        [],
      );
    }
  });

  it('gives every reachable floor at least as many packs as the selection screen shows', () => {
    for (const mode of ['normal', 'hard', 'parallel', 'extreme'] as const) {
      for (const floor of rules.floors[mode]) {
        const count = packs.filter((p) => p.selectable && p.availability[mode].includes(floor)).length;
        expect(count, `${mode} floor ${floor}`).toBeGreaterThanOrEqual(rules.themePacksOfferedPerFloor);
      }
    }
  });
});

describe('gifts', () => {
  it('covers every gift the season references', () => {
    expect(gifts).toHaveLength(446);
  });

  it('reads a skill trigger out of every gift whose effect names a skill', () => {
    const triggered = gifts.filter((g) => g.skillTriggers.length > 0);
    // 92 sin/type gifts plus the 12 that only a keyword clause reaches (15 carry one, 3 of which
    // already had a sin clause of their own).
    expect(triggered).toHaveLength(104);
    // The same loose scan data:validate uses: a gift that plainly names one must have parsed one.
    const loose =
      /(분노|색욕|나태|탐식|우울|오만|질투|참격|관통|타격)[^\n가-힣]{0,4}(?:속성|유형)?[^\n가-힣]{0,4}(?:기본\s*)?(?:공격\s*)?스킬/;
    expect(gifts.filter((g) => g.skillTriggers.length === 0 && loose.test(g.desc.ko))).toEqual([]);
  });

  it('keeps every trigger and 편성 restriction in a shape the app can read', () => {
    const ascending = (values: readonly number[]) => values.every((v, i) => i === 0 || v > values[i - 1]!);
    for (const gift of gifts) {
      for (const trigger of gift.skillTriggers) {
        // A trigger has to state SOMETHING, or it would match every skill in the game.
        expect(
          trigger.sin !== null || trigger.attackType !== null || trigger.keywords.length > 0,
        ).toBe(true);
        expect(ascending(trigger.slots)).toBe(true);
        // The keyword axes are only meaningful alongside a keyword; left at their defaults
        // otherwise, so nothing downstream has to ask whether they apply.
        if (trigger.keywords.length === 0) {
          expect([trigger.verb, trigger.includesSpecial, trigger.subject]).toEqual([
            'inflict',
            false,
            'skill',
          ]);
        }
      }
      expect(ascending(gift.formationSlots)).toBe(true);
      expect(gift.formationSlots.every((slot) => slot >= 1 && slot <= 12)).toBe(true);
    }
    // Every gift that narrows itself to a slot — two by attack type, the rest by keyword. 9203 is
    // absent on purpose: its 「스킬 1, 스킬 2」 is widened again by a later unrestricted line, which
    // is what the parser's subsumption rule is for.
    expect(gifts.filter((g) => g.skillTriggers.some((t) => t.slots.length > 0)).map((g) => g.id)).toEqual([
      9098, 9135, 9177, 9179, 9184, 9195, 9199, 9215, 9216, 9728, 9729, 9730, 9731, 9734, 9735,
      9743, 9841,
    ]);
    expect(gifts.filter((g) => g.formationSlots.length > 0)).toHaveLength(60);
  });

  it.each([
    [9013, [trigger({ attackType: 'Slash', effect: 'boost' })], []],
    [9767, [trigger({ sin: 'PRIDE', attackType: 'Penetrate' })], [1]],
    [9195, [trigger({ attackType: 'Slash', slots: [1] })], []],
    [9193, [trigger({ attackType: 'Slash' })], [3]],
    [9761, [], [1, 2, 7, 8]],
    // 9734 E식 차원 단검 — the gift that showed the keyword clause was being missed entirely.
    [
      9734,
      [
        trigger({ sin: 'ENVY' }),
        trigger({ keywords: ['Charge'], includesSpecial: true, slots: [1] }),
      ],
      [],
    ],
    // 인격 단위: the identity brings 진동, the slot only says which skill is buffed.
    [9728, [trigger({ keywords: ['Vibration'], includesSpecial: true, slots: [3], subject: 'identity' })], []],
    // 9216 states the same clause negated and then positive; only the positive one may survive.
    [9216, [trigger({ keywords: ['Combustion'], includesSpecial: true, slots: [3] })], []],
  ])('gift %i keys off the skills its text names', (id, triggers, formationSlots) => {
    const gift = giftById.get(id as number)!;
    expect(gift.skillTriggers).toEqual(triggers);
    expect(gift.formationSlots).toEqual(formationSlots);
  });

  it('says what kind of help every skill-trigger gift is', () => {
    const triggered = gifts.filter((g) => g.skillTriggers.length > 0);
    expect(triggered.filter((g) => g.effectBuckets.length === 0)).toEqual([]);
    const rows = triggered.flatMap((g) => g.effectBuckets);
    const count = (bucket: string) => rows.filter((b) => b === bucket).length;
    // A gift that helps two ways is listed under each, so the rows outnumber the 104 gifts.
    expect([count('damage'), count('survival'), count('egoResource'), count('buff'), count('debuff')]).toEqual([
      51, 13, 1, 72, 27,
    ]);
    expect(triggered.filter((g) => g.effectBuckets.includes('egoResource')).map((g) => g.id)).toEqual([9002]);
  });

  it.each([
    [9025, ['damage', 'survival']], // 잿빛 코트 — 피해량 + 체력 회복
    [9002, ['egoResource']], // 도착증 — the only one
    // What the ally gains is a buff, whatever it goes on to do.
    [9072, ['buff']], // 피뢰침 — 충전 횟수
    [9137, ['buff']], // 수술용 메스 — 신속
    [9010, ['buff']], // 블러디 가젯 — [피해량 증가]
    [9143, ['buff']], // 목공용 대못 — [관통 피해량 증가]
    [9012, ['buff']], // 오늘의 표정 — 타격 스킬 위력 +2
    // What the enemy is handed is a debuff.
    [9031, ['debuff']], // 닉시 다이버전스 — 대상에게 [진동] 위력 부여
  ])('sorts gift %i into %s', (id, buckets) => {
    expect(giftById.get(id as number)!.effectBuckets).toEqual(buckets);
  });

  it('names every buff the Korean text refers to, leaving no bracketed id on screen', () => {
    // The game writes a buff into its own text as `[BloodDinner]` and paints the name over it at
    // run time. Every BattleKeywords* table is read, so the Korean text carries no Latin id: 혈찬,
    // not BloodDinner. (The English text legitimately contains Latin — those are display names.)
    const leftovers = new Map<string, number>();
    for (const gift of gifts) {
      const ko = [gift.desc.ko, ...gift.conditions.flatMap((c) => (c.text ? [c.text.ko] : []))].join('\n');
      for (const m of ko.matchAll(/\[([A-Za-z][A-Za-z0-9_]*)\]/g)) leftovers.set(m[1]!, (leftovers.get(m[1]!) ?? 0) + 1);
    }
    expect([...leftovers.keys()]).toEqual([]);
    // The ids that used to leak, now named from the season and chapter tables.
    expect(giftById.get(9213)!.desc.ko).toContain('[혈찬]');
    expect(giftById.get(9795)!.conditions[0]!.text!.ko).toContain('[혈찬]을 소모하는');
    expect(giftById.get(9214)!.desc.ko).toContain('[진동 - 작열]');
  });

  it('ships description text with nothing left for the app to clean up', () => {
    // The build localizes the game's bracketed buff ids, strips Unity rich-text tags and drops the
    // runtime `{0}` counter. What it cannot name (identity-only buffs like `BloodDinner`) keeps its
    // bracketed id on purpose — a guessed name would be worse.
    for (const gift of gifts) {
      const texts = [gift.desc.ko, gift.desc.en, ...gift.conditions.flatMap((c) => (c.text ? [c.text.ko, c.text.en] : []))];
      for (const text of texts) {
        const where = `${gift.id} ${gift.name.ko}`;
        // `AttackDown` arrives from the game as 「공격 레벨 감소 」 / 「Offense Level Down 」.
        expect(text, where).not.toMatch(PADDED_BRACKET);
        expect(text, where).not.toMatch(new RegExp(RICH_TEXT_TAG.source));
        expect(text, where).not.toMatch(RUNTIME_PLACEHOLDER);
      }
    }
    // The buff names the table does have are in the reader's language, brackets and all.
    expect(giftById.get(9024)!.desc.ko).toContain('[공격 레벨 감소] 5와 [방어 레벨 감소] 5');
    expect(giftById.get(9024)!.desc.en).toContain('[Offense Level Down] and 5 [Defense Level Down]');
    expect(giftById.get(9022)!.desc.ko).toContain('[공격 레벨 증가] 2');
    // Words the game wrote in angle brackets are content, not markup, and survive.
    expect(giftById.get(9440)!.desc.ko).toContain('아군에 <혈귀>가 있다면');
  });

  it('splits acquisition the way the game does', () => {
    const byKind = new Map<string, number>();
    for (const gift of gifts) byKind.set(gift.acquisition.kind, (byKind.get(gift.acquisition.kind) ?? 0) + 1);
    expect(byKind.get('general')).toBe(187);
    expect(byKind.get('packLimited')).toBe(171);
    expect(byKind.get('fusionOnly')).toBe(59);
  });

  it('keeps the general set identical to an EXTREME pack pool, which has no exclusives', () => {
    const general = new Set(gifts.filter((g) => g.acquisition.kind === 'general').map((g) => g.id));
    const extreme = packs.find((p) => p.group === 'longBattle' && p.exclusiveGifts.length === 0)!;
    expect(new Set(extreme.giftPool)).toEqual(general);
  });

  it('never lists a fusion-only gift in a pack pool', () => {
    const pooled = new Set(packs.filter((p) => p.selectable).flatMap((p) => p.giftPool));
    for (const gift of gifts.filter((g) => g.acquisition.kind === 'fusionOnly')) {
      expect(pooled.has(gift.id), `${gift.id} ${gift.name.ko}`).toBe(false);
    }
  });

  it('reads 진혼 as a tier 4 Burn fusion result with its real ingredients', () => {
    const gift = giftById.get(9088)!;
    expect(gift.name.ko).toBe('진혼');
    expect(gift.keyword).toBe('Combustion');
    expect(gift.tier).toBe(4);
    expect(gift.acquisition.kind).toBe('fusionOnly');
    expect(gift.fusion?.recipes.map((r) => r.ingredients)).toEqual([
      [9003, 9053, 9157],
      [9003, 9053, 9101, 9155],
    ]);
  });

  it('reads 본국검보 as a fusion with a Blade Lineage condition', () => {
    const gift = giftById.get(9280)!;
    expect(gift.name.ko).toBe('본국검보[本國劍譜]');
    expect(gift.acquisition.kind).toBe('fusionOnly');
    expect(gift.fusion?.recipes.map((r) => r.ingredients)).toEqual([[9193, 9279, 9716]]);
    expect(gift.conditions).toEqual([
      expect.objectContaining({ type: 'factionCount', factions: ['BLADE_LINEAGE'], min: 3 }),
    ]);
  });

  it('reads 상납된 시가 as exclusive to 교본, which only appears on Hard floor 5 and above', () => {
    const gift = giftById.get(9283)!;
    expect(gift.acquisition.kind).toBe('packLimited');
    expect(gift.acquisition.exclusiveTo).toEqual([1025]);
    expect(gift.conditions).toEqual([
      expect.objectContaining({ type: 'factionCount', factions: ['THUMB_FINGER'], min: 3 }),
    ]);
    const pack = packById.get(1025)!;
    expect(pack.availability.normal).toEqual([]);
    expect(pack.availability.hard).toEqual([5]);
  });

  it('shares 붉게 얽힌 거미집 across the four Canto 9 packs that list it', () => {
    const gift = giftById.get(9273)!;
    expect(gift.acquisition.exclusiveTo).toEqual([1024, 1025, 1026, 1027]);
  });

  it('models the one cross-keyword recipe as 2-of-7 plus 3-of-3', () => {
    const gift = giftById.get(9083)!;
    expect(gift.fusion?.mixed).toEqual({
      aPool: [9105, 9110, 9116, 9121, 9126, 9131, 9136],
      aCount: 2,
      bPool: [9142, 9147, 9152],
      bCount: 3,
    });
    // Its ingredients come from Hard-only keyword packs, so the gift itself is Hard-only.
    expect(gift.hardOnly).toBe(true);
  });

  it('marks the 잔영 series as fusion material', () => {
    for (const id of [9991, 9992, 9993, 9994, 9995]) {
      expect(giftById.get(id)?.acquisition.kind, String(id)).toBe('material');
    }
  });

  it('parses the expected number of machine-evaluable conditions', () => {
    const counts = { keywordSkillCount: 0, factionCount: 0, fullResonance: 0, unparsed: 0 };
    for (const gift of gifts) for (const c of gift.conditions) counts[c.type] += 1;
    // 39 → 46: the seven gates the parser used to drop (혈찬·탄환·두 키워드 형태). Nothing is unparsed now.
    expect(counts).toEqual({ keywordSkillCount: 46, factionCount: 19, fullResonance: 1, unparsed: 0 });
  });

  it('resolves every faction named by a condition to a known faction id', () => {
    const known = new Set(enums.factions.map((f) => f.id));
    for (const gift of gifts) {
      for (const c of gift.conditions) {
        if (c.type !== 'factionCount') continue;
        for (const faction of c.factions) expect(known.has(faction), `${gift.id} ${faction}`).toBe(true);
      }
    }
  });
});

describe('identities', () => {
  it('covers the 183 the static data ships plus the ones backfilled from the other sources', () => {
    expect(identities).toHaveLength(187);
    expect(identities.filter((i) => i.keywordSource === 'backfilled')).toHaveLength(4);
  });

  it.each([
    [10116, 'LCE E.G.O:: 차원찢개', 1, ['Burst', 'Charge'], ['LIMBUS_COMPANY', 'LIMBUS_COMPANY_LCE']],
    [10616, '동부 섕크 협회 3과', 6, ['Breath', 'Combustion'], ['CINQ']],
    // Season 8's first two: the static data does not ship them, and their 충전 is the special
    // variant only (counted under `specialSkills`), so the keyword set still names it.
    [10416, '오트쿠튀르:: 르누아르 신발관', 4, ['Charge', 'Vibration'], []],
    [10816, '오트쿠튀르:: 르루주 부티크', 8, ['Charge', 'Laceration'], []],
  ])(
    'backfills %i 「%s」, which the static data has not shipped',
    (id, title, sinnerId, keywords, factions) => {
      const identity = identityById.get(id as number)!;
      expect(identity.title.ko).toBe(title);
      expect(identity.sinnerId).toBe(sinnerId);
      // Keywords come from the Korean skill text — see tests/text-derivation.test.ts.
      expect(Object.keys(identity.keywords).sort()).toEqual(keywords);
      expect(identity.keywordSource).toBe('backfilled');
      // Associations, sins and attack types come from the derived mirror, so unlike a hand-written
      // stub these are filled in and the faction conditions count the identity properly.
      expect(identity.factions).toEqual(factions);
      expect(identity.sins.length).toBeGreaterThan(0);
      expect(identity.attackTypes.length).toBeGreaterThan(0);
    },
  );

  it('gives every identity a per-slot skill table, whichever source it came from', () => {
    for (const identity of identities) {
      expect(identity.skills.length).toBeGreaterThan(0);
      expect([...new Set(identity.skills.map((s) => s.slot))].sort()).toEqual([1, 2, 3]);
      // The flat sets are a projection of the same table, so neither may claim the other lacks.
      const sins = new Set(identity.skills.map((s) => s.sin));
      const types = new Set(identity.skills.map((s) => s.attackType));
      for (const sin of identity.sins) expect(sins.has(sin)).toBe(true);
      for (const type of identity.attackTypes) expect(types.has(type)).toBe(true);
    }
  });

  it('reads 10101 이상 LCB 수감자 slot by slot, keywords included', () => {
    // All three skills sink, which is what 「[침잠]을 부여하는 스킬 3」 has to be able to ask.
    const sinking = { base: ['Sinking'], special: [] };
    expect(identityById.get(10101)!.skills).toEqual([
      { slot: 1, sin: 'GLOOM', attackType: 'Slash', copies: 3, keywords: sinking },
      { slot: 2, sin: 'ENVY', attackType: 'Penetrate', copies: 2, keywords: sinking },
      { slot: 3, sin: 'SLOTH', attackType: 'Slash', copies: 1, keywords: sinking },
    ]);
  });

  it('keeps an alternate skill that shares a slot but not its axes (11115 오티스)', () => {
    const skills = identityById.get(11115)!.skills;
    const burnBleed = { base: ['Combustion', 'Laceration'], special: [] };
    expect(skills.filter((s) => s.slot === 1)).toEqual([
      { slot: 1, sin: 'LUST', attackType: 'Hit', copies: 3, keywords: burnBleed },
      { slot: 1, sin: 'ENVY', attackType: 'Hit', copies: 0, keywords: burnBleed },
    ]);
  });

  it('never lets a slot claim a keyword the identity as a whole does not have', () => {
    // The per-slot table and the identity's counts are two readings of one loop, so the slots can
    // only ever name a subset. A slot naming more would mean the two had drifted apart.
    for (const identity of identities) {
      const counted = new Set(Object.keys(identity.keywords));
      for (const skill of identity.skills) {
        for (const keyword of [...skill.keywords.base, ...skill.keywords.special]) {
          expect(counted.has(keyword)).toBe(true);
        }
      }
    }
  });

  it('knows which slot uses a keyword for every identity a source describes', () => {
    // Exactly the four backfilled identities, and for one reason: the derived mirror states a
    // skill's affinity, type and tier and never its keywords, so it knows THAT they use one
    // without knowing WHICH slot does. Readers must take an empty table as 「모른다」, not 「없다」 —
    // so it matters that the set stays small and named.
    const silent = identities.filter(
      (i) =>
        Object.keys(i.keywords).length > 0 &&
        i.skills.every((s) => s.keywords.base.length === 0 && s.keywords.special.length === 0),
    );
    expect(silent.map((i) => i.id)).toEqual([10116, 10416, 10616, 10816]);
  });

  it('derives keywords from skills for all but a handful of identities', () => {
    const withoutKeywords = identities.filter((i) => i.keywordSource === 'none');
    expect(withoutKeywords.length).toBeLessThanOrEqual(10);
  });

  it.each([
    [10101, 'Sinking'],
    [10102, 'Burst'],
    [10403, 'Laceration'],
  ])('identity %i inflicts %s', (id, keyword) => {
    expect(Object.keys(identityById.get(id)!.keywords)).toContain(keyword);
  });

  it.each([
    [10215, 'Charge', '거미집 약지 제자 — 생체 재료'],
    [10614, 'Charge', '거미집 약지 아비 — 생체 재료'],
    [10504, 'Laceration', 'N사 큰 망치 — 못'],
  ])('identity %i inflicts the 특수 variant of %s (%s)', (id, keyword) => {
    const info = identityById.get(id)!.keywords[keyword as 'Charge'];
    expect(info?.specialSkills).toBeGreaterThan(0);
  });

  it.each([
    [10611, { skills: 5, specialSkills: 0 }, '마침표 사무소 대표 — 탄환'],
    [10414, { skills: 0, specialSkills: 2 }, '잔향・외로움 — 탄환 - 고독뿐'],
    [10711, { skills: 3, specialSkills: 1 }, '마침표 해결사 — 탄환 + 로직 아틀리에'],
  ])('identity %i spends ammo (%o, %s)', (id, counts) => {
    expect(identityById.get(id)!.keywords.Bullet).toEqual(counts);
  });

  it('keeps 탄환 out of the gift keywords, since no gift, pack or start pool has it', () => {
    expect(enums.keywords.map((k) => k.id)).not.toContain('Bullet');
    expect(enums.identityOnlyKeywords).toEqual([
      { id: 'Bullet', name: { ko: '탄환', en: 'Ammo' } },
      { id: 'BloodDinner', name: { ko: '혈찬', en: 'Bloodfeast' } },
    ]);
    expect(gifts.some((g) => (g.keyword as string) === 'Bullet')).toBe(false);
    expect(packs.some((p) => (p.keywordAffinity as string | null) === 'Bullet')).toBe(false);
    expect(Object.keys(rules.startGift.poolsByKeyword)).not.toContain('Bullet');
  });

  it('keeps a 특수-only inflictor apart from the base keyword', () => {
    expect(identityById.get(10504)!.keywords.Laceration).toEqual({ skills: 0, specialSkills: 2 });
    expect(identityById.get(10614)!.keywords.Charge!.skills).toBeGreaterThan(0);
  });

  it('reads 흑운회 와카슈 료슈 as Kurokumo Clan', () => {
    const identity = identityById.get(10403)!;
    expect(identity.sinner.ko).toBe('료슈');
    expect(identity.factions).toContain('BLACK_CLOUD');
  });

  it('keeps sin and attack type per identity', () => {
    const identity = identityById.get(10101)!;
    expect(identity.sins.sort()).toEqual(['ENVY', 'GLOOM', 'SLOTH'].sort());
    expect(identity.attackTypes.sort()).toEqual(['Penetrate', 'Slash']);
  });
});

describe('rules', () => {
  it('keeps the floor layout of the four run modes', () => {
    expect(rules.floors).toEqual({
      normal: [1, 2, 3, 4, 5],
      hard: [1, 2, 3, 4, 5],
      parallel: [6, 7, 8, 9, 10],
      extreme: [11, 12, 13, 14, 15],
    });
  });

  it('keeps the difficulty constraints the planner enforces', () => {
    expect(rules.difficulty).toEqual({
      hardIsSticky: true,
      parallelRequiresAllHard: true,
      extremeAllowsObservation: false,
    });
  });

  it('records the deployment limits the UI enforces', () => {
    expect(rules.deployment).toEqual({ max: 7, default: 6, verified: false });
  });

  it('reads theme pack observation costs from the game data', () => {
    expect(rules.themePacksOfferedPerFloor).toBe(3);
    expect(rules.themeObservation).toEqual({ base: 20, step: 10, unvisitedMultiplier: 1.5 });
  });

  it('offers three starting gifts per keyword for all ten keywords', () => {
    const pools = Object.entries(rules.startGift.poolsByKeyword);
    expect(pools).toHaveLength(10);
    for (const [keyword, ids] of pools) expect(ids, keyword).toHaveLength(3);
  });

  it('reads the gift observation cost table and pool from the season data', () => {
    expect(rules.giftObservation).toMatchObject({ max: 3, costTable: [70, 160, 270], verified: true });
    expect(gifts.filter((g) => g.observable).length).toBe(312);
  });

  it('derives EXTREME clear rewards and hidden-battle gifts from the stage files', () => {
    const byKind = (kind: string) => gifts.filter((g) => g.acquisition.kind === kind).map((g) => g.id);
    expect(byKind('clearReward')).toEqual([9250, 9251, 9252, 9253, 9254, 9255, 9827, 9828, 9829, 9830]);
    expect(byKind('hiddenBattle')).toEqual([9256, 9257, 9258, 9259]);
    expect(byKind('event')).toHaveLength(10);
    expect(giftById.get(9828)!.acquisition.clearRewardOf).toBe(1519);
    expect(rules.hiddenBattle).toEqual({ gifts: [9256, 9257, 9258, 9259], floors: [11, 12, 13, 14, 15], probabilityPerFloor: 0.1 });
  });

  it('carries an icon key per gift and a sprite key per pack', () => {
    expect(giftById.get(9403)!.icon).toBe(1005);
    expect(giftById.get(9088)!.icon).toBe(9088);
    expect(packs.every((p) => p.sprite.length > 0)).toBe(true);
    expect(packs.find((p) => p.id === 1501)!.sprite).toBe('CorpN_Extreme');
  });
});

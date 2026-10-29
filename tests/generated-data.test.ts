/**
 * Assertions against the real generated data in public/data.
 *
 * These are the facts the planner and the UI rely on. When the game changes they will fail, which
 * is the point: a change here should be read and understood, not auto-updated.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  enumsSchema,
  giftsFileSchema,
  identitiesFileSchema,
  metaSchema,
  packsFileSchema,
  rulesSchema,
  seasonIndexSchema,
  skillGiftIndexSchema,
  type EffectRequirement,
} from '../src/core/schema.ts';
import { buildSkillGiftIndex } from '../scripts/lib/skill-gifts.ts';
import {
  HIGHLIGHT_MARK,
  markUpgradeHighlight,
  PADDED_BRACKET,
  RICH_TEXT_TAG,
  RUNTIME_PLACEHOLDER,
  splitHighlight,
} from '../src/core/text.ts';

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
  /**
   * The hardest canary in the repo, and deliberately so.
   *
   * This asserts on `index.default` — the season the app opens. A half-known season is marked
   * `provisional` and never becomes the default, so it passes here; a *complete* new season does
   * become the default and fails here. That is the right shape: a provisional md8 is something the
   * owner published on purpose, while a season turnover is a fact a person has to read and sign
   * off. Bumping this to 8 is part of the commit that makes md8 the default, not something to do
   * ahead of it. (2026-10-17: OpenLethe af2aa4df shipped md8 whole — common data, drop pool,
   * observation list, the four dungeon files — so md8 is complete and the default; md7 is frozen.)
   */
  it('describes Mirror Dungeon 8', () => {
    expect(meta.dungeon.id).toBe(8);
    expect(meta.dungeon.name.ko).toBe('시지프의 거울');
    expect(rules.dungeonId).toBe(8);
    expect(meta.provisional).toBe(false);
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
  it('has the full Mirror Dungeon 8 pack list', () => {
    // MD8 adds no pack: the same 120 as MD7 after the 10-15 patch (칸토 X 1028~1031 included).
    expect(packs).toHaveLength(120);
    expect(packs.filter((p) => p.selectable)).toHaveLength(119);
  });

  it('takes the Canto X packs from the static data, their own general pool and sprite included', () => {
    // In md7 these were backfilled with an assumed pool of every general gift; the md8 static data
    // ships them, so the pool is the game's own (73 of the 186 general gifts) and no pack outside
    // their own leaks an exclusive in.
    const general = new Set(gifts.filter((g) => g.acquisition.kind === 'general').map((g) => g.id));
    const sprites = { 1028: 'Canto_X', 1029: 'Canto_X_mid', 1030: 'Canto_X_mid2', 1031: 'Canto_X_hard' };
    for (const [id, sprite] of Object.entries(sprites)) {
      const pack = packById.get(Number(id))!;
      expect(pack.sprite, id).toBe(sprite);
      expect(pack.exclusiveGifts, id).toHaveLength(2);
      const others = pack.giftPool.filter((g) => !pack.exclusiveGifts.includes(g));
      expect(others.length, id).toBe(73);
      for (const giftId of others) expect(general.has(giftId), `${id} ${giftId}`).toBe(true);
      for (const giftId of pack.exclusiveGifts) {
        expect(giftById.get(giftId), String(giftId)).toMatchObject({ observable: true, obtainable: true });
      }
    }
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
    // 446 → 454: 칸토 X 팩의 전용 기프트 9284~9291.
    expect(gifts).toHaveLength(454);
  });

  it('names every buff the Korean text refers to, leaving no bracketed id on screen', () => {
    // The game writes a buff into its own text as `[BloodDinner]` and paints the name over it at
    // run time. Every BattleKeywords* table is read, so the Korean text carries no Latin id: 혈찬,
    // not BloodDinner. (The English text legitimately contains Latin — those are display names.)
    const leftovers = new Map<string, number>();
    for (const gift of gifts) {
      const ko = [gift.desc.ko, ...gift.conditions.flatMap((c) => (c.text ? [c.text.ko] : []))].join('\n');
      for (const m of ko.matchAll(/\[([A-Za-z][A-Za-z0-9_]*)\]/g))
        leftovers.set(m[1]!, (leftovers.get(m[1]!) ?? 0) + 1);
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
      const texts = [
        gift.desc.ko,
        gift.desc.en,
        ...gift.conditions.flatMap((c) => (c.text ? [c.text.ko, c.text.en] : [])),
      ];
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

  it('ships the game text of every enhancement step, emphasis as ** and nothing else (M130)', () => {
    const enhanceable = gifts.filter((g) => g.upgradeLevels > 0);
    // 111 enhanceable gifts, every one with its text — 9291 꽃가위 included (backfilled in md7, static
    // in md8): the localize files carry 19291/29291.
    expect(enhanceable).toHaveLength(111);
    for (const gift of gifts) {
      const where = `${gift.id} ${gift.name.ko}`;
      if (gift.upgradeLevels === 0) {
        expect(gift.upgrades, where).toBeUndefined();
        continue;
      }
      expect(
        gift.upgrades?.map((u) => u.level),
        where,
      ).toEqual(gift.upgradeLevels === 2 ? [1, 2] : [1]);
      for (const upgrade of gift.upgrades ?? []) {
        // The game names a step after its gift: 「하모닉스」 → 「하모닉스+」 / 「하모닉스++」.
        expect(upgrade.name.ko, where).toBe(gift.name.ko + '+'.repeat(upgrade.level));
        for (const text of [upgrade.name.ko, upgrade.name.en, upgrade.desc.ko, upgrade.desc.en]) {
          expect(text, where).not.toMatch(new RegExp(RICH_TEXT_TAG.source));
          expect(text, where).not.toMatch(RUNTIME_PLACEHOLDER);
          expect(text, where).not.toMatch(PADDED_BRACKET);
          // Paired marks only: every `**` opens or closes an emphasis.
          expect(text.split(HIGHLIGHT_MARK).length % 2, where).toBe(1);
        }
        expect(upgrade.desc.ko.match(/\[([A-Za-z][A-Za-z0-9_]*)\]/g), where).toBeNull();
      }
    }
    const harmonics = giftById.get(9236)!.upgrades!;
    expect(harmonics[0]!.desc.ko).toContain('[취약] **2** 얻음');
    expect(harmonics[1]!.desc.ko).toContain('(턴당 **3**회)');
    expect(giftById.get(9291)!.upgrades![1]!.desc.ko).toContain('**15%**');
  });

  it('splits the emphasis mark back into runs', () => {
    expect(markUpgradeHighlight('[Vulnerable] <style="upgradeHighlight">2</style> 얻음')).toBe(
      '[Vulnerable] **2** 얻음',
    );
    expect(splitHighlight('턴당 **2**회')).toEqual([
      { text: '턴당 ', strong: false },
      { text: '2', strong: true },
      { text: '회', strong: false },
    ]);
    // An unpaired mark stays text instead of swallowing the rest.
    expect(splitHighlight('a ** b')).toEqual([{ text: 'a ** b', strong: false }]);
  });

  it('splits acquisition the way the game does', () => {
    const byKind = new Map<string, number>();
    for (const gift of gifts) byKind.set(gift.acquisition.kind, (byKind.get(gift.acquisition.kind) ?? 0) + 1);
    // MD8: 187 → 186 general, 179 → 180 pack-limited — 9205 전혈 플라스크 left every general pool
    // for the specific pools of 1019~1021 and 1507·1514·1518.
    expect(byKind.get('general')).toBe(186);
    expect(byKind.get('packLimited')).toBe(180);
    // The MD8 drop pool leaves 9205 out of `egoGifts` while those packs and the observation list
    // still offer it — and it is 미니어처 대관람차 (9213)'s ingredient, so unobtainable would kill it.
    // The owner confirmed in game (2026-10-17) that it drops from exactly these six packs.
    expect(giftById.get(9205)).toMatchObject({ obtainable: true, observable: true });
    expect(giftById.get(9205)!.acquisition.exclusiveTo).toEqual([1019, 1020, 1021, 1507, 1514, 1518]);
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
    // 46 → 45: 먹장구름's 10-identity sentence is a step of its 6-identity gate, not a second gate.
    expect(counts).toEqual({ keywordSkillCount: 45, factionCount: 19, fullResonance: 1, unparsed: 0 });
  });

  it('gates each count once: higher thresholds of the same count are steps (먹장구름)', () => {
    for (const gift of gifts) {
      const subjects = gift.conditions.flatMap((c) =>
        c.type === 'keywordSkillCount' && c.min !== null
          ? [`k:${[...c.keywords].sort().join('+')}:${c.verb}:${c.scope}:${c.includesSpecial}`]
          : c.type === 'factionCount'
            ? [`f:${[...c.factions].sort().join('|')}:${c.scope}`]
            : [],
      );
      expect(new Set(subjects).size, `${gift.id}`).toBe(subjects.length);
    }
    const sinking = gifts.find((g) => g.id === 9211)!.conditions;
    expect(sinking).toMatchObject([{ min: 6, tiers: [{ min: 10 }] }]);
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

describe('gift effects (M129)', () => {
  it('gives every gift its effects', () => {
    expect(gifts.filter((g) => !g.effects).map((g) => g.id)).toEqual([]);
    expect(gifts.filter((g) => g.desc.ko && g.effects!.length === 0).map((g) => g.id)).toEqual([]);
  });

  /**
   * A threshold the ring judges (`gift.conditions`) must reach the effects too, or the 추천 기프트
   * judgement would recommend a gift the deck cannot switch on: some effect asks for the same
   * keywords or factions, and a gating threshold keeps its `min`.
   */
  it('reflects every parsed threshold in some effect requirement', () => {
    for (const gift of gifts) {
      const reqs = (gift.effects ?? []).flatMap((e) => e.requires);
      for (const c of gift.conditions) {
        if (c.type === 'keywordSkillCount') {
          const match = reqs.find(
            (r) => r.type === 'skillKeyword' && c.keywords.every((k) => r.keywords.includes(k)),
          );
          expect(match, `${gift.id} ${c.keywords.join('+')}`).toBeDefined();
        }
        if (c.type === 'factionCount') {
          const match = reqs.find(
            (r) => r.type === 'faction' && c.factions.every((f) => r.factions.includes(f)),
          );
          expect(match, `${gift.id} ${c.factions.join('|')}`).toBeDefined();
          if (match?.type === 'faction' && match.min !== undefined) expect(match.min).toBe(c.min);
        }
      }
    }
  });

  it('reads the gates the owner checked', () => {
    const gate = (id: number) => giftById.get(id)!.effects!.find((e) => e.kind === 'gate');
    expect(gate(9088)?.requires).toEqual([
      { type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true, min: 5, scope: 'deployed' },
    ]);
    expect(giftById.get(9215)!.effects).toEqual([
      {
        kind: 'effect',
        requires: [{ type: 'skillKeyword', keywords: ['Combustion'], includesSpecial: true, slot: 3 }],
      },
    ]);
    expect(giftById.get(9214)!.effects).toEqual([
      { kind: 'effect', requires: [{ type: 'identityBuff', buffs: ['VibrationIgnition'] }] },
    ]);
    expect(giftById.get(9271)!.effects!.map((e) => e.requires)).toEqual([
      [{ type: 'faction', factions: ['BLACK_BEAST_RABBIT'] }],
      [{ type: 'identityBuff', buffs: ['LegStrength'] }],
    ]);
  });

  /** `gift.effect` keys (`9105.0`) whose requirements — or an `anyOf` option — have this type. */
  const effectsWith = (type: EffectRequirement['type']): string[] =>
    gifts.flatMap((g) =>
      (g.effects ?? []).flatMap((e, i) =>
        e.requires.some(
          (r) => r.type === type || (r.type === 'anyOf' && r.options.some((o) => o.type === type)),
        )
          ? [`${g.id}.${i}`]
          : [],
      ),
    );

  it('leaves no line unclassified: E.G.O, 버림 and cross-kind 「또는」 all have requirements now', () => {
    expect(gifts.flatMap((g) => (g.effects ?? []).filter((e) => e.unclassified).map(() => g.id))).toEqual([]);
  });

  it('reads every E.G.O skill condition as egoSkill, the keyword inside it asking nothing more', () => {
    // Gates of the seven 조각 gifts, their 「… 속성 E.G.O 스킬의 경우」 lines, 9058 and 9733.
    const pieces = [9105, 9110, 9116, 9121, 9126, 9131, 9136].flatMap((id) => [`${id}.0`, `${id}.2`]);
    expect(effectsWith('egoSkill')).toEqual(['9058.1', ...pieces, '9733.1'].sort());
    for (const id of [9105, 9110, 9116, 9121, 9126, 9131, 9136])
      expect(giftById.get(id)!.effects![0]).toEqual({ kind: 'gate', requires: [{ type: 'egoSkill' }] });
  });

  it('carries an anyOf on each of the 17 cross-kind 「A 또는 B」 lines, and 9167’s self alternative', () => {
    const lines = [
      '9009.0',
      '9011.0',
      '9012.0',
      '9014.1',
      '9015.1',
      '9019.0',
      '9025.1',
      '9026.0',
      '9027.0',
      '9030.0',
      '9032.0',
      '9034.0',
      '9043.0',
      '9221.0',
      '9223.1',
      '9258.2',
      '9291.1',
    ];
    expect(effectsWith('anyOf')).toEqual([...lines, '9167.1'].sort());
    expect(giftById.get(9223)!.effects![1]!.requires).toEqual([
      { type: 'faction', factions: ['RING_FINGER'] },
      {
        type: 'anyOf',
        options: [
          { type: 'skill', attackTypes: ['Slash'] },
          { type: 'skill', sins: ['LUST'] },
        ],
      },
    ]);
  });

  it('asks for a discarding identity on the three 버림 lines (9201, 9202 with 디에치 협회, 9203)', () => {
    const discard = gifts.flatMap((g) =>
      (g.effects ?? []).flatMap((e, i) =>
        e.requires.some((r) => r.type === 'identityBuff' && r.buffs.includes('Discard'))
          ? [`${g.id}.${i}`]
          : [],
      ),
    );
    expect(discard).toEqual(['9201.2', '9202.1', '9203.1']);
    expect(giftById.get(9202)!.effects![1]!.requires).toContainEqual({
      type: 'faction',
      factions: ['DIECI'],
    });
  });

  it('reads 「자신의 [진동] 횟수를 소모하는」 and 「자신에게 [화상]을 부여하는」 as selfKeyword', () => {
    expect(effectsWith('selfKeyword')).toEqual(['9164.1', '9166.1', '9166.3', '9167.1', '9167.3', '9819.0']);
    expect(giftById.get(9819)!.effects![0]!.requires).toEqual([
      { type: 'selfKeyword', keywords: ['Combustion'], verb: 'gain' },
    ]);
  });

  it('names only factions and identities that exist', () => {
    const known = new Set(enums.factions.map((f) => f.id));
    for (const gift of gifts) {
      for (const r of (gift.effects ?? []).flatMap((e) => e.requires)) {
        if (r.type === 'faction')
          for (const f of r.factions) expect(known.has(f), `${gift.id} ${f}`).toBe(true);
        if (r.type === 'identity')
          for (const id of r.ids) expect(identityById.has(id), `${gift.id} ${id}`).toBe(true);
      }
    }
  });
});

describe('identities', () => {
  it('covers the 190 the static data ships plus the 2 only the other sources know', () => {
    // 2026-10-17: OpenLethe af2aa4df shipped 11016, the last mirror-only identity at the time.
    // 2026-10-29: 10617 and 10717 arrive from the derived mirror and the localize text first.
    expect(identities).toHaveLength(192);
    expect(identities.filter((i) => i.keywordSource === 'backfilled')).toHaveLength(2);
  });

  it.each([
    [10116, 'LCE E.G.O:: 차원찢개', 1, ['Burst', 'Charge'], ['LIMBUS_COMPANY', 'LIMBUS_COMPANY_LCE']],
    [10616, '동부 섕크 협회 3과', 6, ['Breath', 'Combustion'], ['CINQ']],
    // Season 8's first three: the static data did not ship them at first, and their 충전 is the
    // special variant only (counted under `specialSkills`), so the keyword set still names it.
    [10416, '오트쿠튀르:: 르누아르 신발관', 4, ['Charge', 'Vibration'], ['LE_NOIR', 'SISYPHE']],
    [10816, '오트쿠튀르:: 르루주 부티크', 8, ['Charge', 'Laceration'], ['LE_ROUGE', 'SISYPHE']],
    [10917, '오트쿠튀르:: 수선실', 9, ['Charge', 'Vibration'], ['SISYPHE']],
    [10315, '오트쿠튀르:: 르누아르 브랜드 매니저', 3, ['Charge', 'Vibration'], ['LE_NOIR', 'SISYPHE']],
    [11016, '오트쿠튀르:: 르루주 붉은 신', 10, ['Charge', 'Laceration'], ['LE_ROUGE', 'SISYPHE']],
    [
      10617,
      '오트쿠튀르:: 르누아르 3F 방송실',
      6,
      ['Charge', 'Vibration'],
      ['LE_NOIR', 'SISYPHE'],
      'backfilled',
    ],
    [
      10717,
      '오트쿠튀르:: 르루주 바느질의 왕',
      7,
      ['Charge', 'Laceration'],
      ['LE_ROUGE', 'SISYPHE'],
      'backfilled',
    ],
  ])(
    'knows %i 「%s」 once the static data ships it',
    (id, title, sinnerId, keywords, factions, source = 'derived') => {
      const identity = identityById.get(id as number)!;
      expect(identity.title.ko).toBe(title);
      expect(identity.sinnerId).toBe(sinnerId);
      // Keywords come from the Korean skill text — see tests/text-derivation.test.ts.
      expect(Object.keys(identity.keywords).sort()).toEqual(keywords);
      expect(identity.keywordSource).toBe(source);
      // Associations, sins and attack types come from the derived mirror, so unlike a hand-written
      // stub these are filled in and the faction conditions count the identity properly.
      expect(identity.factions).toEqual(factions);
      expect(identity.sins.length).toBeGreaterThan(0);
      expect(identity.attackTypes.length).toBeGreaterThan(0);
    },
  );

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
    // Declared as 「- 특수 충전 (위력 고정)」, which a bare-line pattern missed until M60.
    [10410, 'Charge', '로보토미 E.G.O:: 적안・참회 — 적안·참회'],
    [10913, 'Charge', '로보토미 E.G.O:: 눈물로 벼려낸 검 — 검은 눈물'],
  ])('identity %i inflicts the 특수 variant of %s (%s)', (id, keyword) => {
    const info = identityById.get(id)!.keywords[keyword as 'Charge'];
    expect(info?.specialSkills).toBeGreaterThan(0);
  });

  it.each([
    [10611, { skills: 3, specialSkills: 0 }, '마침표 사무소 대표 — 탄환'],
    [10414, { skills: 0, specialSkills: 2 }, '잔향・외로움 — 탄환 - 고독뿐'],
    // 로직 아틀리에제 탄환 is spent only by the enhanced S3 1071105, not by any base skill.
    [10711, { skills: 3, specialSkills: 0 }, '마침표 해결사 — 탄환'],
  ])('identity %i spends ammo (%o, %s)', (id, counts) => {
    expect(identityById.get(id)!.keywords.Bullet).toEqual(counts);
  });

  // Keywords, sins and attack types come from the base S1/S2/S3 only. 흑수 - 묘 필두 파우스트's
  // 호흡 is on its enhanced S3 「흑수 묘 오의 - 운해현현」 alone, so the identity is 파열 only.
  it('reads an identity off its base S1/S2/S3, not the enhanced skill an S3 turns into', () => {
    expect(identityById.get(10212)!.keywords).toEqual({ Burst: { skills: 3, specialSkills: 0 } });
    const abi = identityById.get(10115)!;
    expect(Object.keys(abi.keywords).sort()).toEqual(['Breath', 'Sinking']);
    expect(abi.sins).not.toContain('WRATH');
    // S2·S3 inflict 화상 when the sword is in state 2/3 — written only in the Korean text (M86).
    expect(identityById.get(11115)!.keywords.Combustion).toEqual({ skills: 2, specialSkills: 0 });
  });

  // A 디버프 counts when the skill inflicts it on the other side, 호흡·충전 when the skill gives
  // itself or spends its own — not when it merely checks or scales off one (M86).
  it('counts a keyword only when a base skill gives or spends it, not when it reads it', () => {
    const keys = (id: number) => Object.keys(identityById.get(id)!.keywords).sort();
    // 「[Breath]이 6 이상이면」 only checks 호흡.
    expect(keys(10916)).not.toContain('Breath');
    // 동백 이상 puts its 진동 on itself.
    expect(keys(10104)).not.toContain('Vibration');
    // Given to the target, by scripts that do not say GiveBuff on the buff itself or say it oddly.
    expect(keys(10110)).toContain('Vibration'); // CheckAdditionalBuffOnEquipEgo
    expect(keys(10508)).toContain('Laceration'); // CheckAdditionalBuff20509
    expect(keys(10805)).toContain('Burst'); // GiveBuffOnLoseDuel
    expect(keys(10808)).toContain('Breath'); // to the lowest-SP allies — the user's side counts
    // 특수 침잠 given through the script name alone.
    expect(identityById.get(10110)!.keywords.Sinking?.specialSkills).toBeGreaterThan(0);
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

describe('identity skills (M129)', () => {
  it('gives every identity a source derives its base skills, one per slot S1~S3', () => {
    const derived = identities.filter((i) => i.keywordSource !== 'none');
    for (const identity of derived) {
      const slots = (identity.skills ?? []).map((s) => s.slot);
      expect([identity.id, slots]).toEqual([identity.id, [1, 2, 3]]);
    }
  });

  it('reads LCB 수감자 이상 skill by skill: sin, attack type, weight and coins', () => {
    const skills = identityById.get(10101)!.skills!;
    expect(skills.map((s) => [s.slot, s.sin, s.attackType, s.weight, s.coins?.count])).toEqual([
      [1, 'GLOOM', 'Slash', 1, 1],
      [2, 'ENVY', 'Penetrate', 1, 2],
      [3, 'SLOTH', 'Slash', 1, 3],
    ]);
    expect(skills.every((s) => s.coins?.plus && !s.coins.minus && !s.coins.unbreakable)).toBe(true);
  });

  it('marks unbreakable and minus coins where the game draws them', () => {
    const lantern = identityById.get(10111)!.skills!;
    expect(lantern.map((s) => [s.coins?.unbreakable, s.coins?.minus])).toEqual([
      [true, false],
      [true, false],
      [false, true],
    ]);
  });

  it('reads the attack weight of an area S3', () => {
    expect(identityById.get(10714)!.skills!.find((s) => s.slot === 3)!.weight).toBe(3);
  });

  it("puts 거미집 중지 아비's text-only 화상 on its S2 and S3, not its S1", () => {
    const skills = identityById.get(11115)!.skills!;
    expect(skills.map((s) => s.keywords.Combustion?.base ?? false)).toEqual([false, true, true]);
  });

  it('adds the per-skill keyword flags up to the keyword counts the planner uses', () => {
    for (const identity of identities) {
      if (!identity.skills || identity.keywordSource === 'curated') continue;
      for (const [keyword, counts] of Object.entries(identity.keywords)) {
        const base = identity.skills.filter(
          (s) => s.keywords[keyword as keyof typeof s.keywords]?.base,
        ).length;
        const special = identity.skills.filter(
          (s) => s.keywords[keyword as keyof typeof s.keywords]?.special,
        ).length;
        expect([identity.id, keyword, base, special]).toEqual([
          identity.id,
          keyword,
          counts.skills,
          counts.specialSkills,
        ]);
      }
    }
  });

  it('lists 각력【묘】 for the three 흑수 - 묘 identities and nobody else', () => {
    const holders = identities.filter((i) => i.buffs?.includes('LegStrength')).map((i) => i.id);
    expect(holders).toEqual([10212, 10411, 11112]);
    for (const id of holders) expect(identityById.get(id)!.title.ko).toMatch(/흑수 - 묘/);
  });

  it('lists 진동 - 작열 for 새벽 사무소 해결사 파우스트, whose skills switch 진동 into it', () => {
    expect(identityById.get(10216)!.buffs).toContain('VibrationIgnition');
  });

  it('reads a passive-only buff from the passive text', () => {
    // 흑수 - 묘 필두's battle passive 「천구성」: 「[BurstZilu]의 수치가 0이 되어 소멸시,
    // [BurstVulnerableZilu]이 부여됨」 — none of its base or defense skills names that buff.
    expect(identityById.get(10212)!.buffs).toContain('BurstVulnerableZilu');
  });

  it('lists 버림 (Discard) for the seven identities whose base skills discard', () => {
    // 디에치 협회 ×4 (10108·10510·10608·10907), 정사무소 이스마엘 (10813), 어금니 사무소 이상·오티스 (10105·11105).
    const discarders = identities.filter((i) => i.buffs?.includes('Discard')).map((i) => i.id);
    expect(discarders).toEqual([10105, 10108, 10510, 10608, 10813, 10907, 11105]);
  });

  it('reads which skills spend their own 진동 and which put 화상 on their own user (skills[].self)', () => {
    const holders = (keyword: 'Vibration' | 'Combustion', verb: 'gain' | 'consume'): number[] =>
      identities.filter((i) => i.skills?.some((s) => s.self?.[keyword]?.[verb])).map((i) => i.id);
    expect(holders('Vibration', 'consume')).toEqual([
      10105, 10207, 10309, 10409, 10609, 10807, 10810, 10909, 11007, 11010, 11105, 11113,
    ]);
    expect(holders('Combustion', 'gain')).toEqual([10211, 10714, 11014]);
    // 1030903 「자신의 [Vibration] 횟수를 10 소모하여 코인 위력 +2」 is S3 only.
    expect(identityById.get(10309)!.skills!.map((s) => s.self?.Vibration?.consume ?? false)).toEqual([
      false,
      false,
      true,
    ]);
    // Every static identity knows its skills' scripts (a mirror-only one would say nothing: `self`
    // stays undefined — scripts/lib/identity-skills.test.ts covers that path now that none is left).
    for (const identity of identities)
      if (identity.keywordSource === 'derived')
        expect(identity.skills!.every((s) => s.self !== undefined)).toBe(true);
  });

  it('keeps the kinds of every defense skill, a counter included', () => {
    expect(identityById.get(10101)!.defenseTypes).toEqual(['guard']);
    expect(identityById.get(10212)!.defenseTypes).toEqual(['counter', 'guard']);
  });

  it('reads 11016 from the static data once it ships, weight and coins included', () => {
    // Mirror-only until 2026-10-17 (weight and coins were null); the derived source agreed on the
    // sins, attack types, defenses and buffs, which the static data now states itself.
    const couture = identityById.get(11016)!;
    expect(couture.keywordSource).toBe('derived');
    expect(couture.skills!.map((s) => [s.slot, s.sin, s.attackType, s.weight, s.coins?.count])).toEqual([
      [1, 'GLUTTONY', 'Penetrate', 1, 1],
      [2, 'WRATH', 'Penetrate', 1, 2],
      [3, 'LUST', 'Penetrate', 1, 3],
    ]);
    expect(couture.defenseTypes).toEqual(['counter', 'evade', 'guard']);
    expect(couture.buffs).toContain('ChargeRougeAlly');
  });
});

describe('skill-gifts index (M129)', () => {
  const file = skillGiftIndexSchema.parse(
    JSON.parse(readFileSync(resolve(DATA, `md${season}`, 'skill-gifts.json'), 'utf8')),
  );

  it('is exactly what core computes from the data today (a rule change needs a rebuild)', () => {
    expect(file).toEqual(buildSkillGiftIndex(identities, gifts));
  });

  it('lists 9215 (화상 스킬 3) under the S3 of an identity whose S3 inflicts 화상, and E.G.O nowhere', () => {
    // 10714 흑수 - 유 필두: its S3 inflicts 화상.
    expect(file['10714']?.['3']).toContainEqual([9215, 0, 0]);
    const egoRefs = Object.values(file)
      .flatMap((slots) => Object.values(slots).flat())
      .filter(([g, e, r]) => giftById.get(g)!.effects![e]!.requires[r]!.type === 'egoSkill');
    expect(egoRefs).toEqual([]);
  });

  it('puts a whole-identity requirement (faction, buff) under slot 0', () => {
    // 9271 흑수환 - 묘: effect 1 asks for 각력【묘】, which 10212 brings.
    expect(file['10212']?.['0']).toContainEqual([9271, 1, 0]);
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
    // 312 → 320: 칸토 X 팩의 전용 기프트 8개. md7은 `backfillAssumptions.exclusivesObservable`로 가정했고,
    // md8은 정적 관측 목록이 그대로 싣는다.
    expect(gifts.filter((g) => g.observable).length).toBe(320);
  });

  it('derives EXTREME clear rewards and hidden-battle gifts from the stage files', () => {
    const byKind = (kind: string) => gifts.filter((g) => g.acquisition.kind === kind).map((g) => g.id);
    expect(byKind('clearReward')).toEqual([9250, 9251, 9252, 9253, 9254, 9255, 9827, 9828, 9829, 9830]);
    expect(byKind('hiddenBattle')).toEqual([9256, 9257, 9258, 9259]);
    expect(byKind('event')).toHaveLength(10);
    expect(giftById.get(9828)!.acquisition.clearRewardOf).toBe(1519);
    expect(rules.hiddenBattle).toEqual({
      gifts: [9256, 9257, 9258, 9259],
      floors: [11, 12, 13, 14, 15],
      probabilityPerFloor: 0.1,
    });
  });

  it('carries an icon key per gift and a sprite key per pack', () => {
    expect(giftById.get(9403)!.icon).toBe(1005);
    expect(giftById.get(9088)!.icon).toBe(9088);
    expect(packs.every((p) => p.sprite.length > 0)).toBe(true);
    expect(packs.find((p) => p.id === 1501)!.sprite).toBe('CorpN_Extreme');
  });
});

describe('the start never changes the pack route (M145)', () => {
  // The app plans no starting gift (`APP_START` in `src/app/lib/plan-input.ts`): every gift a
  // starting pool hands over is a general drop the planner never routes through a pack, so taking
  // it at the start would not move a single pack. A season where some start-pool gift needs a pack
  // makes the start matter for routing again — this fails, and the app's start setting has to come
  // back rather than the route quietly ignoring it.
  it('every start-pool gift of the default season is freely available', async () => {
    const { loadGameDataFromDisk } = await import('../src/core/data/node.ts');
    const { buildIndexes } = await import('../src/core/index.ts');
    const data = loadGameDataFromDisk(undefined, season);
    const indexes = buildIndexes(data);
    const pools = Object.values(data.rules.startGift.poolsByKeyword).flat();
    const tagged = data.gifts.filter((g) => g.acquisition.startKeyword).map((g) => g.id);
    const startPool = [...new Set([...pools, ...tagged])].sort((a, b) => a - b);
    expect(startPool.length).toBeGreaterThan(0);
    expect(startPool.filter((id) => !indexes.freelyAvailableGifts.has(id))).toEqual([]);
  });
});

describe('the 잔영 are held always (M152)', () => {
  // The app keeps no mark for a 잔영 and takes none as a goal: they come from toasts the reader
  // cannot see, any number at a time, and fusions and sales spend them uncounted. That changes no
  // route only while no recipe eats one — a season whose recipe needs a 잔영 makes their count
  // matter for planning again, and this fails before the app plans a fusion it cannot make.
  it('no recipe of the default season eats a 잔영, and no pack drops one', async () => {
    const { loadGameDataFromDisk } = await import('../src/core/data/node.ts');
    const data = loadGameDataFromDisk(undefined, season);
    const materials = new Set(data.gifts.filter((g) => g.acquisition.kind === 'material').map((g) => g.id));
    expect(materials.size).toBeGreaterThan(0);
    const eating = data.gifts.filter((g) =>
      (g.fusion?.recipes ?? []).some((r) => r.ingredients.some((id) => materials.has(id))),
    );
    expect(eating.map((g) => g.id)).toEqual([]);
    expect(data.gifts.filter((g) => materials.has(g.id) && g.acquisition.packs.length > 0)).toEqual([]);
  });
});

/**
 * The review table for the gift effects (M129): what the parser read from every gift's text.
 *
 *   npm run gift-effects:report     writes docs/research/gift-effects.md
 *
 * Reads the built data (`public/data`), so run `npm run data:build` first. The table is for the
 * owner to read line by line: each effect's Korean line next to the requirements it was given, and
 * ⚠ on a line that reads like a condition no rule covers. Deterministic — no dates, sorted by id.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoPath } from './lib/io.ts';
import { OUT, seasonDir } from './lib/out.ts';
import { readBattleKeywordNames } from './lib/raw.ts';
import { readCuratedGiftEffects, splitEffectBlocks } from './lib/parse-effects.ts';
import {
  enumsSchema,
  giftsFileSchema,
  identitiesFileSchema,
  seasonIndexSchema,
  type EffectRequirement,
  type Gift,
  type GiftEffect,
} from '../src/core/schema.ts';

const index = seasonIndexSchema.parse(JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')));
const gifts = giftsFileSchema.parse(
  JSON.parse(readFileSync(join(seasonDir(index.default), 'gifts.json'), 'utf8')),
);
const enums = enumsSchema.parse(JSON.parse(readFileSync(join(OUT, 'enums.json'), 'utf8')));
const identities = identitiesFileSchema.parse(JSON.parse(readFileSync(join(OUT, 'identities.json'), 'utf8')));
const buffNames = readBattleKeywordNames('KR');
const curatedIds = new Set(readCuratedGiftEffects(repoPath('data/curated/gift-effects.json')).byId.keys());

const factionName = new Map(enums.factions.map((f) => [f.id, f.name.ko]));
const keywordName = new Map([...enums.keywords, ...enums.identityOnlyKeywords].map((k) => [k.id, k.name.ko]));
const sinName = new Map<string, string>(
  Object.entries({
    WRATH: '분노',
    LUST: '색욕',
    SLOTH: '나태',
    GLUTTONY: '탐식',
    GLOOM: '우울',
    PRIDE: '오만',
    ENVY: '질투',
  }),
);
const identityName = new Map(identities.map((i) => [i.id, `${i.title.ko} ${i.sinner.ko}`]));
const ATTACK_KO: Record<string, string> = { Slash: '참격', Penetrate: '관통', Hit: '타격' };
const DEFENSE_KO: Record<string, string> = { guard: '가드', evade: '회피', counter: '반격' };
const SCOPE_KO: Record<string, string> = { deployed: '출격', formation: '편성', reserve: '대기' };
const KIND_KO: Record<GiftEffect['kind'], string> = { effect: '효과', gate: '발동 조건', note: '메모' };
const ACQUISITION_KO: Record<string, string> = {
  general: '범용 드랍',
  packLimited: '팩 한정',
  clearReward: '클리어 보상',
  fusionOnly: '조합 전용',
  startOnly: '시작',
  material: '재료',
  hiddenBattle: '히든 전투',
  event: '이벤트',
  unknown: '미상',
};
const SHAPE_KO: Record<string, (n?: number) => string> = {
  singleCoin: () => '단일 코인 스킬',
  coinsAtMost: (n) => `코인 ${n}개 이하 스킬`,
  coinsAtLeast: (n) => `코인 ${n}개 이상 스킬`,
  plusCoin: () => '더하기 코인 스킬',
  minusCoin: () => '빼기 코인 스킬',
  unbreakableCoin: () => '파괴 불가 코인',
  weightAtLeast: (n) => `공격 가중치 ${n} 이상 스킬`,
  weightExactly: (n) => `공격 가중치 ${n} 스킬`,
};

function count(min?: number, scope?: string): string {
  if (!min) return '';
  return ` ${min}인 이상${scope ? `(${SCOPE_KO[scope]})` : ''}`;
}

function describeRequirement(req: EffectRequirement): string {
  switch (req.type) {
    case 'skillKeyword':
      return (
        `${req.keywords.map((k) => keywordName.get(k) ?? k).join('·')}${req.includesSpecial ? '(특수 포함)' : ''} 스킬` +
        `${req.slot ? ` — 스킬 ${req.slot}` : ''}${count(req.min, req.scope)}`
      );
    case 'identityBuff':
      return `인격 버프 ${req.buffs.map((b) => `「${buffNames.get(b) ?? b}」(${b})`).join('·')}`;
    case 'faction':
      return `${req.factions.map((f) => factionName.get(f) ?? f).join('·')} 소속${count(req.min, req.scope)}`;
    case 'identity':
      return `인격 ${req.ids.map((id) => identityName.get(id) ?? String(id)).join('·')}`;
    case 'skill':
      return `${[
        (req.sins ?? []).map((s) => sinName.get(s) ?? s).join('·'),
        (req.attackTypes ?? []).map((a) => ATTACK_KO[a] ?? a).join('·'),
      ]
        .filter(Boolean)
        .join(' ')} 스킬`;
    case 'resonance':
      return `${req.sins.map((s) => sinName.get(s) ?? s).join('·')} 공명`;
    case 'shape':
      return SHAPE_KO[req.kind]!(req.n);
    case 'defense':
      return `${req.kinds.map((k) => DEFENSE_KO[k]).join('·')} 스킬`;
    case 'selfKeyword': {
      const names = req.keywords.map((k) => keywordName.get(k) ?? k).join('·');
      return req.verb === 'gain' ? `자신에게 ${names} 부여하는 스킬` : `자신의 ${names} 소모하는 스킬`;
    }
    case 'egoSkill':
      return 'E.G.O 스킬 (늘 충족, 「E.G.O」 절)';
    case 'anyOf':
      return req.options.map(describeRequirement).join(' 또는 ');
  }
}

function shorten(text: string, max = 90): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/** Whether some effect of the gift works for any deck (no requirement on it or on a gate). */
function worksForAnyDeck(gift: Gift): boolean {
  const effects = gift.effects ?? [];
  const gates = effects.filter((e) => e.kind === 'gate');
  if (gates.some((g) => g.requires.length > 0)) return false;
  return effects.some((e) => e.kind === 'effect' && e.requires.length === 0);
}

const effects = gifts.flatMap((g) => g.effects ?? []);
const tally = (values: string[]): string => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
};
const unclassified = effects.filter((e) => e.unclassified);
const anyDeck = gifts.filter(worksForAnyDeck);

const out: string[] = [];
out.push('# 기프트 효과 요구 (M129)');
out.push('');
out.push(
  '`npm run gift-effects:report`가 `public/data`에서 만든다 — 손으로 고치지 않는다. 기프트 설명을 효과(줄 + 그 아래 `- ` 줄)로 나누고, ' +
    '덱이 갖춰야 효과가 쓸모 있는 것만 요구로 적었다(`scripts/lib/parse-effects.ts`). 상태·전투 상황·편성 칸은 요구가 아니다. ' +
    '⚠는 조건처럼 읽히지만 규칙이 없는 줄이다(요구 없음으로 취급). 고칠 것은 `data/curated/gift-effects.json`에 적는다.',
);
out.push('');
out.push('## 요약');
out.push('');
out.push(
  `- 시즌 ${index.default}, 기프트 ${gifts.length}개, 효과 ${effects.length}개 (${tally(effects.map((e) => KIND_KO[e.kind]))})`,
);
out.push(`- 요구 종류: ${tally(effects.flatMap((e) => e.requires.map((r) => r.type)))}`);
out.push(
  `- 요구가 하나라도 있는 효과: ${effects.filter((e) => e.kind === 'effect' && e.requires.length > 0).length}개`,
);
out.push(`- ⚠ 분류되지 않은 줄: ${unclassified.length}개`);
out.push(
  `- 수기 보정한 기프트: ${curatedIds.size}개 (${[...curatedIds].sort((a, b) => a - b).join(', ') || '없음'})`,
);
out.push(
  `- 어떤 덱에서나 쓸 수 있는 효과가 있는 기프트: ${anyDeck.length}개 / 덱을 가리는 기프트: ${gifts.length - anyDeck.length}개`,
);
out.push('');
out.push('## 기프트별');
out.push('');

for (const gift of gifts) {
  const list = gift.effects ?? [];
  const blocks = splitEffectBlocks(gift.desc.ko);
  const paired = blocks.length === list.length;
  out.push(
    `### ${gift.id} ${gift.name.ko} · ${ACQUISITION_KO[gift.acquisition.kind] ?? gift.acquisition.kind}` +
      `${worksForAnyDeck(gift) ? '' : ' · 덱을 가림'}${curatedIds.has(gift.id) ? ' · 보정(data/curated/gift-effects.json)' : ''}`,
  );
  out.push('');
  if (list.length === 0) {
    out.push('(설명 없음)');
    out.push('');
    continue;
  }
  if (!paired) out.push('*(효과 수가 설명의 줄 수와 다르다 — 줄을 짝짓지 않는다)*');
  out.push('| 종류 | 줄 | 요구 |');
  out.push('|---|---|---|');
  list.forEach((effect, i) => {
    const text = paired ? shorten(blocks[i]!.head) : '';
    const reqs = effect.requires.map(describeRequirement).join(' + ') || '—';
    out.push(`| ${KIND_KO[effect.kind]} | ${cell(text)} | ${effect.unclassified ? '⚠ ' : ''}${cell(reqs)} |`);
  });
  out.push('');
}

const path = repoPath('docs/research/gift-effects.md');
writeFileSync(path, `${out.join('\n').trimEnd()}\n`);
console.log(
  `gift-effects:report: ${gifts.length} gifts, ${effects.length} effects, ${unclassified.length} unclassified → ${path}`,
);

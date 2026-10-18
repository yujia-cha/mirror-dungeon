/**
 * Why 「추천 기프트」 recommends what it does (M129) — the debugging view the app never shows.
 *
 *   npm run recommend -- --deck 10101,10203,… --deployed 10101,10203
 *   npm run recommend -- --deck … --gift 9215,9271        (only these gifts, every effect)
 *   npm run recommend -- --deck … --all                    (also the gifts it does not recommend)
 *
 * Without --deployed the first `deployment.default` identities fight, as in the planner. Gifts come
 * in the app's order — section by section (deck, free, ego), each ranked by `recommendationScore`
 * (`src/app/lib/recommend-rank.ts`) — then, with --all, the ones it does not recommend. Each prints
 * its verdict (`deck` / `free` / `ego` / `none`) and score, then each effect: kind, usable, and every
 * requirement with have/need (and how many identities the data could not judge).
 */
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import {
  analyseDeck,
  buildIndexes,
  relevanceReason,
  requirementLabel,
  type GiftEffectsReport,
} from '../src/core/index.ts';
import type { Gift } from '../src/core/schema.ts';
import { conditionReportsByGift } from '../src/app/lib/gift-tile.ts';
import { effectReportsByGift, recommendedGifts } from '../src/app/lib/recommend.ts';
import { recommendationScore } from '../src/app/lib/recommend-rank.ts';
import { flagValue, hasFlag } from './lib/io.ts';

function numbers(text: string | undefined): number[] {
  return (text ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

const data = loadGameDataFromDisk();
const indexes = buildIndexes(data);
const deck = numbers(flagValue('--deck'));
const deployedFlag = flagValue('--deployed');
const stats = analyseDeck(
  deck,
  indexes,
  data.rules.deployment,
  deployedFlag === undefined ? undefined : numbers(deployedFlag),
);
const only = new Set(numbers(flagValue('--gift')));
const showAll = hasFlag('--all') || only.size > 0;

console.log(`deployed: ${stats.deployed.join(', ') || '(nobody)'}`);
if (stats.unknownIdentities.length > 0) console.log(`unknown ids: ${stats.unknownIdentities.join(', ')}`);

const gifts = data.gifts.filter((gift) => (only.size > 0 ? only.has(gift.id) : gift.obtainable));
const reports = effectReportsByGift(gifts, stats, indexes);
const {
  deck: deckGroup,
  free,
  ego,
} = recommendedGifts(gifts, conditionReportsByGift(data, stats, indexes), reports, {
  deployed: stats.deployed,
});
const recommended = new Set([...deckGroup, ...free, ...ego].map((entry) => entry.gift.id));
const none = gifts.filter((gift) => !recommended.has(gift.id));

function print(gift: Gift, verdict: string, report: GiftEffectsReport): void {
  const score = recommendationScore(report, { deployed: stats.deployed });
  console.log(`\n${gift.id} ${gift.name.ko} — ${verdict} score ${score} (${relevanceReason(report)})`);
  for (const effect of report.effects) {
    const reqs = effect.requirements
      .map(
        (r) =>
          `${requirementLabel(r.requirement)} ${r.have}/${r.need}${r.unknown ? ` ?${r.unknown}` : ''}${r.satisfied ? ' ✓' : ' ✗'}`,
      )
      .join(', ');
    const mark = effect.kind === 'effect' ? (effect.usable ? '●' : '○') : '·';
    const hints = effect.hints.map((h) => ` · 참고 ${requirementLabel(h.requirement)} ${h.have}명`).join('');
    console.log(
      `  ${mark} [${effect.kind}]${effect.unclassified ? ' ⚠미분류' : ''} ${reqs || '(조건 없음)'}${hints}`,
    );
  }
}

for (const [verdict, entries] of [
  ['deck', deckGroup],
  ['free', free],
  ['ego', ego],
] as const)
  for (const entry of entries) print(entry.gift, verdict, reports.get(entry.gift.id)!);
// The app keeps a plain gift only when it is pack-bound, so a general plain one is `none` here.
if (showAll) for (const gift of none) print(gift, 'none', reports.get(gift.id)!);
console.log(`\ndeck ${deckGroup.length} · ego ${ego.length} · free ${free.length} · none ${none.length}`);

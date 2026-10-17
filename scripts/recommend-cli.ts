/**
 * Why 「추천 기프트」 recommends what it does (M129) — the debugging view the app never shows.
 *
 *   npm run recommend -- --deck 10101,10203,… --deployed 10101,10203
 *   npm run recommend -- --deck … --gift 9215,9271        (only these gifts, every effect)
 *   npm run recommend -- --deck … --all                    (also the gifts it does not recommend)
 *
 * Without --deployed the first `deployment.default` identities fight, as in the planner. Each gift
 * prints its verdict (`deck` / `free` / `none`), then each effect: kind, usable, and every
 * requirement with have/need (and how many identities the data could not judge).
 */
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import {
  analyseDeck,
  buildIndexes,
  giftEffectsReport,
  relevanceReason,
  requirementLabel,
} from '../src/core/index.ts';
import { isPackBound } from '../src/app/lib/gift-priority.ts';
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

const counts = { deck: 0, ego: 0, free: 0, none: 0 };
for (const gift of data.gifts) {
  if (only.size > 0 && !only.has(gift.id)) continue;
  if (!gift.obtainable && only.size === 0) continue;
  const report = giftEffectsReport(gift, stats, indexes.identityById);
  // The app keeps a plain gift only when it is pack-bound.
  const verdict = report.relevance === 'free' && !isPackBound(gift) ? 'none' : (report.relevance ?? 'none');
  counts[verdict] += 1;
  if (verdict === 'none' && !showAll) continue;
  console.log(`\n${gift.id} ${gift.name.ko} — ${verdict} (${relevanceReason(report)})`);
  for (const effect of report.effects) {
    const reqs = effect.requirements
      .map(
        (r) =>
          `${requirementLabel(r.requirement)} ${r.have}/${r.need}${r.unknown ? ` ?${r.unknown}` : ''}${r.satisfied ? ' ✓' : ' ✗'}`,
      )
      .join(', ');
    const mark = effect.kind === 'effect' ? (effect.usable ? '●' : '○') : '·';
    console.log(
      `  ${mark} [${effect.kind}]${effect.unclassified ? ' ⚠미분류' : ''} ${reqs || '(조건 없음)'}`,
    );
  }
}
console.log(`\ndeck ${counts.deck} · ego ${counts.ego} · free ${counts.free} · none ${counts.none}`);

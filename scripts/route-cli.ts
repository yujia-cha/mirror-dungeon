/**
 * Run the planner from the command line, for debugging and regression work.
 *
 *   npm run route -- --deck 10101,10203,10312 --want 9088,9283 --floors 1-5 --difficulty hard
 *   npm run route -- --want 9083 --floors 1-15 --json
 *   npm run route -- --share '#s=...'        (a URL hash copied from the web app)
 *
 * Flags: --deck, --want, --floors, --difficulty normal|hard, --hard-from N,
 *        --must gift,gift (these are required; the rest are best-effort),
 *        --observe gift,gift (pin these for 기프트 관측), --no-observe (planner may not observe),
 *        --assume-unvisited (price every observation as a first visit to that pack, ×1.5),
 *        --pin floor:pack,…, --ban pack,…, --prefer pack,… (must be included somewhere),
 *        --floor N (run in progress: floors below N are played; pin them to say which pack was taken),
 *        --own gift,… (already in hand), --failed gift,… (missed for good),
 *        --result-only gift,… (fusion results whose ingredients are not goals of their own),
 *        --alternatives, --json, --explain, --trace
 */
// lz-string ships CommonJS, so under Node's ESM loader it only has a default export.
import lzString from 'lz-string';
import { loadGameDataFromDisk } from '../src/core/data/node.ts';
import { buildIndexes, defaultOptions, planAlternatives, planRoute } from '../src/core/index.ts';
import type { Keyword } from '../src/core/schema.ts';
import type { PlanInput, PlanOptions } from '../src/core/types.ts';
import { plannedGifts, type FusionGoalMap } from '../src/app/lib/plan-input.ts';
import { flagValue, hasFlag } from './lib/io.ts';

function numbers(text: string | undefined): number[] {
  if (!text) return [];
  return text
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n));
}

/** `--floors 1-7` → 7. Any last floor is accepted; `planRoute` clamps it to the season's range. */
function parseFloors(text: string | undefined): number {
  if (text === undefined) return 5;
  const last = Number(text.trim().split('-').pop());
  if (Number.isInteger(last) && last >= 1) return last;
  console.error(`route: --floors "${text}" is not a range like 1-15; planning floors 1-5`);
  return 5;
}

function parsePins(text: string | undefined): Record<number, number> {
  const out: Record<number, number> = {};
  for (const pair of (text ?? '').split(',')) {
    const [floor, pack] = pair.split(':').map((n) => Number(n));
    if (Number.isFinite(floor) && Number.isFinite(pack)) out[floor!] = pack!;
  }
  return out;
}

/**
 * Accept a share hash from the web app so a user report can be reproduced verbatim.
 *
 * The payload carries the app's 「재료도 목표」 choices, so the wanted list is built with the very
 * function the app uses — which also means every goal comes out best-effort, the way the app
 * plans them. `--must` is a CLI-only lever and does not apply to a shared link. Links written
 * before the app dropped 반드시/보통 still carry a `priority` map; it is ignored here too.
 */
function fromShare(hash: string): PlanInput | null {
  const payload = hash.replace(/^#?s=/, '');
  const json = lzString.decompressFromEncodedURIComponent(payload);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      deck?: number[];
      deployed?: number[];
      wanted?: number[];
      fusionGoal?: FusionGoalMap;
      options?: Partial<PlanOptions>;
    };
    return {
      deck: parsed.deck ?? [],
      wanted: plannedGifts(parsed.wanted ?? [], parsed.fusionGoal ?? {}),
      options: {
        ...defaultOptions(),
        ...parsed.options,
        ...(parsed.deployed ? { deployed: parsed.deployed } : {}),
      },
    };
  } catch {
    return null;
  }
}

const loaded = loadGameDataFromDisk();
// --no-observe removes the observation slots altogether, for reproducing a pure pack route.
const data = hasFlag('--no-observe')
  ? { ...loaded, rules: { ...loaded.rules, giftObservation: { ...loaded.rules.giftObservation, max: 0 } } }
  : loaded;
const indexes = buildIndexes(data);

const share = flagValue('--share');
const input: PlanInput = share
  ? (fromShare(share) ?? { deck: [], wanted: [], options: defaultOptions() })
  : {
      deck: numbers(flagValue('--deck')),
      wanted: numbers(flagValue('--want')).map((giftId) => ({
        giftId,
        required: flagValue('--must') === undefined || numbers(flagValue('--must')).includes(giftId),
        ...(numbers(flagValue('--result-only')).includes(giftId) ? { ingredientsAsGoals: false } : {}),
      })),
      options: {
        ...defaultOptions(),
        lastFloor: parseFloors(flagValue('--floors')),
        hardFromFloor:
          flagValue('--hard-from') !== undefined
            ? Number(flagValue('--hard-from'))
            : flagValue('--difficulty') === 'hard'
              ? 1
              : null,
        startKeyword: (flagValue('--keyword') as Keyword | undefined) ?? 'auto',
        observedGifts: numbers(flagValue('--observe')),
        pinnedPacks: parsePins(flagValue('--pin')),
        bannedPacks: numbers(flagValue('--ban')),
        preferredPacks: numbers(flagValue('--prefer')),
        currentFloor: flagValue('--floor') !== undefined ? Number(flagValue('--floor')) : 1,
        ownedGifts: numbers(flagValue('--own')),
        unobtainableGifts: numbers(flagValue('--failed')),
        // Prices every observation as if its pack had never been entered (×1.5). The app never
        // sets this — it knows from the run which packs are new — but it is the honest price for a
        // plan made before the run starts, so the CLI can ask for it.
        assumeUnvisitedPacks: hasFlag('--assume-unvisited'),
      },
    };

const plan = planRoute(input, data, indexes);
const variants = hasFlag('--alternatives') ? planAlternatives(input, data, indexes, plan) : [];

if (hasFlag('--json')) {
  console.log(JSON.stringify(hasFlag('--alternatives') ? { plan, variants } : plan, null, 2));
  process.exit(0);
}

const giftName = (id: number): string => `${indexes.giftById.get(id)?.name.ko ?? '?'}(${id})`;
const packName = (id: number): string => `${indexes.packById.get(id)?.name.ko ?? '?'}(${id})`;

console.log(
  `${data.meta.dungeon.name.ko} — ${input.options.lastFloor}층까지, ` +
    `${input.options.hardFromFloor ? `${input.options.hardFromFloor}층부터 Hard` : 'Normal'}`,
);

if (input.deck.length > 0) {
  const names = input.deck.map((id) => {
    const identity = indexes.identityById.get(id);
    return identity ? `${identity.sinner.ko} ${identity.title.ko}` : `알 수 없음(${id})`;
  });
  console.log(`덱: ${names.join(', ')}`);
}

if ((input.options.currentFloor ?? 1) > 1) {
  const owned = input.options.ownedGifts ?? [];
  console.log(
    `진행 중: 현재 ${input.options.currentFloor}층${owned.length > 0 ? `, 보유 ${owned.map(giftName).join(', ')}` : ''}`,
  );
}

console.log('\n시작');
console.log(`  키워드: ${plan.start.keyword ?? '(없음)'}`);
console.log(`  시작 기프트: ${plan.start.startGift ? giftName(plan.start.startGift) : '(없음)'}`);
const observedText = plan.start.observed.map((o) => {
  const why = o.pinned ? '지정' : o.freedPack !== null ? `추천, ${packName(o.freedPack)} 불필요` : '추천';
  return `${giftName(o.giftId)} (${why})`;
});
console.log(
  `  관측: ${observedText.length > 0 ? observedText.join(', ') : '(없음)'}` +
    `${observedText.length > 0 ? ` — 별빛 ${plan.start.starlight}${plan.start.starlightVerified ? '' : ' (미확인 값)'}` : ''}`,
);

console.log('\n층별 루트');
for (const floor of plan.floors) {
  const pack = floor.packId === null ? '자유 (아무 팩)' : packName(floor.packId);
  const obs = floor.observation.needed
    ? floor.observation.possible
      ? ` [관측 +${floor.observation.starlight}]`
      : ' [관측 불가 — 우연히 등장해야 함]'
    : '';
  const window =
    floor.window && floor.window.from !== floor.window.to
      ? ` [${floor.window.from}~${floor.window.to}층 중 한 층]`
      : floor.passed
        ? ' [지남]'
        : floor.reason === 'pinned'
          ? ' [고정(핀)]'
          : '';
  console.log(
    `  ${String(floor.floor).padStart(2)}층 (${floor.mode}) ${floor.passed && floor.packId === null ? '지남' : pack}${window}${obs}`,
  );
  for (const pickup of floor.pickups) {
    const tag = pickup.kind === 'exclusive' ? '전용' : '풀';
    const why = pickup.neededFor ? ` → ${giftName(pickup.neededFor)} 재료` : '';
    console.log(`      · ${giftName(pickup.giftId)} [${tag}]${why}`);
  }
  if (hasFlag('--explain') && floor.alternatives.length > 0) {
    console.log(`      대안: ${floor.alternatives.slice(0, 5).map(packName).join(', ')}`);
  }
}

if (plan.generalDrops.length > 0) {
  console.log(`\n범용 드랍 (확정 아님): ${plan.generalDrops.map(giftName).join(', ')}`);
}

if (plan.fusions.length > 0) {
  console.log('\n조합');
  for (const fusion of plan.fusions) {
    const when = fusion.unreachable ? '불가' : `${fusion.earliestFloor}층 이후`;
    console.log(`  ${giftName(fusion.result)} ← ${fusion.ingredients.map(giftName).join(' + ')} (${when})`);
  }
}

if (plan.conditions.length > 0) {
  console.log('\n조건');
  for (const condition of plan.conditions) {
    console.log(
      `  ${condition.satisfied ? 'O' : 'X'} ${giftName(condition.giftId)} — ${condition.detail.ko}`,
    );
  }
}

if (plan.unresolved.length > 0) {
  console.log('\n미해결');
  for (const entry of plan.unresolved) {
    console.log(`  ${giftName(entry.giftId)} [${entry.reason}] ${entry.detail.ko}`);
  }
}

if (plan.warnings.length > 0) {
  console.log('\n경고');
  for (const warning of plan.warnings) console.log(`  [${warning.code}] ${warning.detail.ko}`);
}

console.log(
  `\n요약: 필요 팩 ${plan.stats.requiredPacks}개, 별빛 ${plan.stats.starlight}, ` +
    `${plan.stats.coveredWanted}/${plan.stats.totalWanted} 확보, ${plan.stats.elapsedMs}ms`,
);

if (variants.length > 0) {
  console.log('\n대안 루트');
  for (const variant of variants) {
    const packs = variant.plan.floors
      .filter((f) => f.packId !== null)
      .map((f) => `${f.floor}층 ${packName(f.packId!)}`);
    console.log(
      `  ${variant.dropped.map(giftName).join(', ')} 제외 → ${variant.plan.stats.coveredWanted}/${variant.plan.stats.totalWanted} 확보, ` +
        `${packs.join(' · ') || '자유'}` +
        (variant.plan.unresolved.length > 0
          ? ` (미해결 ${variant.plan.unresolved.map((u) => giftName(u.giftId)).join(', ')})`
          : ''),
    );
  }
}

if (hasFlag('--trace')) {
  console.log(`탐색 노드 ${plan.stats.searchNodes}${plan.stats.searchCapped ? ' (한도 도달)' : ''}`);
}

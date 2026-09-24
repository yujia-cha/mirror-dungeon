/**
 * The top of the stage: the floor on stage as a big number, the entered pack or the pack-less
 * state as a badge, and a strip of the fifteen floors that mirrors the route (played, skipped, the
 * frontier) and lets the player look back at a played floor.
 *
 * All fifteen cells are drawn the same: the app always plans Hard 1~15, so banding 1-5 / 6-10 /
 * 11-15 said nothing the floor number did not. The pack on a floor stays in `title`, `aria-label`
 * and `data-pack` — it no longer gets a dot of its own.
 */
import { t, type Lang } from '../i18n.ts';
import { useApp } from '../store.ts';
import { stageModeFor, type StageMode } from '../lib/stage.ts';
import { Badge } from '../components/ui.tsx';
import { usePlan } from '../shell/plan-context.ts';

/** The entered pack is named by the caller; here only the pack-less states get a badge. */
function modeBadge(mode: StageMode, lang: Lang, lastFloor: number) {
  if (mode === 'skipped') return <Badge tone="neutral">{t('stageSkipped', lang)}</Badge>;
  if (mode === 'done') return <Badge tone="sure">{t('stageDone', lang, { last: lastFloor })}</Badge>;
  return null;
}

export function FloorHeader({ mode }: { mode: StageMode }) {
  // `goTo` rather than the store action: walking forward on the strip has to settle the floors it
  // leaves behind, exactly as 「다음 층」 does.
  const { lang, shown, packName, goTo } = usePlan();
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const floor = run.stageFloor;
  // Past the end the stage stands on the done floor; the number still reads the last floor, and no
  // cell is current, which is the truth — every floor is behind.
  const shownFloor = Math.min(floor, lastFloor);
  const entered = run.visits[floor];
  // One cell per floor this season opens — fifteen today, fewer in a season that has opened less.
  const floors = Array.from({ length: lastFloor }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-3" data-testid="floor-header">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex items-baseline gap-2">
          <span className="font-num text-4xl font-bold leading-none text-fg" data-testid="stage-floor">
            {shownFloor}
          </span>
          <span className="font-num text-sm text-fg-3">{t('stageOf', lang, { last: lastFloor })}</span>
        </div>
        {entered !== undefined ? (
          <Badge tone="sure">{packName(entered)}</Badge>
        ) : (
          modeBadge(mode, lang, lastFloor)
        )}
      </div>
      <ol className="flex gap-1" aria-label={t('tabRoutePlan', lang)} data-testid="floor-strip">
        {floors.map((f) => {
          const state = stageModeFor(run, f, lastFloor);
          const planned = shown?.floors.find((entry) => entry.floor === f)?.packId ?? null;
          const shownPack = run.visits[f] ?? (state === 'undecided' ? planned : null);
          const reachable = f <= Math.min(run.currentFloor, lastFloor);
          return (
            <li key={f} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => goTo(f)}
                disabled={!reachable}
                aria-current={f === floor ? 'step' : undefined}
                aria-label={`${t('stageFloor', lang, { floor: f })}${shownPack !== null ? ` · ${packName(shownPack)}` : ''}`}
                title={shownPack !== null ? packName(shownPack) : undefined}
                data-testid="floor-cell"
                data-floor={f}
                data-state={state}
                data-pack={shownPack ?? undefined}
                // The floor on stage is the one thing to act on here, so it is the only cell that
                // takes the accent; entered and skipped floors keep saying what they already said.
                // A floor still out of reach is drawn in `fg-3` rather than faded: `opacity-60`
                // put 11px text at about 3.0:1, and this is 5.02:1.
                className={`flex h-9 w-full flex-col items-center justify-center rounded-sm border text-[11px] leading-none transition-colors ${
                  f === floor ? 'border-accent ring-1 ring-accent' : 'border-line'
                } ${state === 'entered' ? 'bg-ink text-ink-fg' : state === 'skipped' ? 'bg-surface-3 text-fg-3' : 'bg-surface text-fg-2'} disabled:cursor-default disabled:bg-bg disabled:text-fg-3`}
              >
                <span className="font-num">{f}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

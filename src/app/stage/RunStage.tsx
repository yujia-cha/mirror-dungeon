/**
 * The run screen in the middle of the shell. The floor on stage is either undecided (pull a pack
 * card down to enter it, or the dashed card to pass), entered (the pack area is open), skipped
 * (nothing here; a pack can still be recorded), or past the end of the run.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useApp } from '../store.ts';
import { enterablePacks, packsOfferedOn } from '../lib/stage.ts';
import { t } from '../i18n.ts';
import { Button, Card, Notice } from '../components/ui.tsx';
import { usePlan, usePlanRun } from '../shell/plan-context.ts';
import { OtherEntryCard, OtherPacks, StagePackCard } from './EnterablePacks.tsx';
import { PackArea } from './EnteredPack.tsx';
import { FloorHeader } from './FloorHeader.tsx';

/** How long the pack area takes to fold away after the player goes back (matches its CSS transition). */
const FOLD_MS = 200;

export function RunStage({ onOpenGifts }: { onOpenGifts: () => void }) {
  const { indexes, lang, shown, exclusivesOf, enter, next, openPack } = usePlan();
  // The stage shows the floor on stage, so it reads the half that follows it (M165).
  const { ctx, stageMode } = usePlanRun();
  const run = useApp((s) => s.run);
  const resetRun = useApp((s) => s.resetRun);
  const lastFloor = useApp((s) => s.lastFloor);
  const floor = run.stageFloor;
  // The cards show a pack as entered on this floor: on the dungeon's last floor its clear reward is
  // not coming (M173), so the card does not promise it.
  const exclusivesHere = useCallback((packId: number) => exclusivesOf(packId, floor), [exclusivesOf, floor]);
  const routePacks = enterablePacks(shown, floor, indexes);
  const offered = packsOfferedOn(indexes, floor);
  const entered = run.visits[floor];

  // When the entry on the stage floor is taken back, the area stays a moment to fold away.
  const [closing, setClosing] = useState<number | null>(null);
  const previous = useRef<{ floor: number; entered: number | undefined }>({ floor, entered });
  useEffect(() => {
    const before = previous.current;
    previous.current = { floor, entered };
    // Any other move ends the fold at once. Leaving `closing` set would keep a collapsed but live
    // pack area in the DOM, its 「입장 취소」·「다음 층」 buttons still reachable by keyboard.
    if (before.floor !== floor || before.entered === undefined || entered !== undefined) {
      setClosing(null);
      return undefined;
    }
    setClosing(before.entered);
    const timer = window.setTimeout(() => setClosing(null), FOLD_MS);
    return () => window.clearTimeout(timer);
  }, [floor, entered]);

  let body;
  if (stageMode === 'done') {
    body = (
      <Card className="flex flex-col items-center gap-3 px-4 py-8 text-center" testId="stage-done">
        <div className="text-subheading ">{t('stageDone', lang, { last: lastFloor })}</div>
        {/* Only the run is dropped. The deck, the goals and the route options are the plan the
            player came here with, and the next dungeon reset uses the same one. */}
        <Button variant="primary" onClick={resetRun}>
          {t('stageNewRun', lang)}
        </Button>
      </Card>
    );
  } else if (stageMode === 'entered' && entered !== undefined) {
    body = <PackArea key={entered} packId={entered} />;
  } else {
    body = (
      <div className="flex flex-col gap-3" data-testid="stage-undecided" data-mode={stageMode}>
        {closing !== null ? <PackArea key={`closing-${closing}`} packId={closing} closing /> : null}
        {!shown ? (
          <Notice icon={<Star size={14} aria-hidden />}>
            <span className="mr-2">{t('stageNoGoals', lang)}</span>
            <Button size="sm" variant="primary" onClick={onOpenGifts}>
              {t('tabGifts', lang)}
            </Button>
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-subheading ">{t('stageEnterable', lang)}</span>
        </div>
        {shown && routePacks.length === 0 && stageMode === 'undecided' ? (
          <p className="text-body text-fg-subtle">{t('stageNoRoutePack', lang)}</p>
        ) : null}
        <div className="flex flex-wrap items-start gap-3 pb-3" data-testid="stage-packs">
          {routePacks.map(({ packId, alternatives }) => {
            const pack = indexes.packById.get(packId);
            return pack ? (
              <StagePackCard
                key={packId}
                pack={pack}
                ctx={ctx}
                exclusivesOf={exclusivesHere}
                onEnter={enter}
                onOpen={openPack}
                alternatives={alternatives}
              />
            ) : null;
          })}
          {stageMode === 'undecided' ? <OtherEntryCard onSkip={next} lang={lang} /> : null}
        </div>
        {/* The alternatives are already in this list — they are offered here and are not route
            packs — so they are marked and pulled to the front rather than listed a second time. */}
        <OtherPacks
          offered={offered}
          exclude={new Set(routePacks.map((p) => p.packId))}
          sameGifts={new Set(routePacks.flatMap((p) => p.alternatives))}
          ctx={ctx}
          exclusivesOf={exclusivesHere}
          onEnter={enter}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="run-stage" data-mode={stageMode}>
      <FloorHeader mode={stageMode} />
      {body}
    </div>
  );
}

/**
 * The run screen in the middle of the shell. The floor on stage is either undecided (pull a pack
 * card down to enter it, or the dashed card to pass), entered (the pack area is open), skipped
 * (nothing here; a pack can still be recorded), or past the end of the run.
 */
import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useApp } from '../store.ts';
import { enterablePacks, packsOfferedOn } from '../lib/stage.ts';
import { pick, t } from '../i18n.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { PackSheetBody } from '../components/PackSheet.tsx';
import { Button, Card, Notice } from '../components/ui.tsx';
import { usePlan } from '../shell/PlanContext.tsx';
import { OtherEntryCard, OtherPacks, StagePackCard } from './EnterablePacks.tsx';
import { PackArea } from './EnteredPack.tsx';
import { FloorHeader } from './FloorHeader.tsx';

/** How long the pack area takes to fold away after the player goes back (matches its CSS transition). */
const FOLD_MS = 200;

export function RunStage({ onOpenGifts }: { onOpenGifts: () => void }) {
  const { indexes, lang, shown, ctx, exclusivesOf, stageMode, enter, next } = usePlan();
  const run = useApp((s) => s.run);
  const lastFloor = useApp((s) => s.lastFloor);
  const floor = run.stageFloor;
  const routePacks = enterablePacks(shown, floor);
  const offered = packsOfferedOn(indexes, floor);
  const entered = run.visits[floor];

  // When the entry on the stage floor is taken back, the area stays a moment to fold away.
  const [closing, setClosing] = useState<number | null>(null);
  // The pack sheet opened from a card's title; rendered here so no pulled card's transform contains it.
  const [detail, setDetail] = useState<number | null>(null);
  const previous = useRef<{ floor: number; entered: number | undefined }>({ floor, entered });
  useEffect(() => {
    const before = previous.current;
    previous.current = { floor, entered };
    // Any other move ends the fold at once. Leaving `closing` set would keep a collapsed but live
    // pack area in the DOM, its 「돌아가기」·「다음 층」 buttons still reachable by keyboard.
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
      <Card className="flex flex-col items-center gap-2.5 px-4 py-8 text-center" testId="stage-done">
        <div className="text-sm font-semibold">{t('stageDone', lang, { last: lastFloor })}</div>
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
          <span className="text-sm font-semibold">{t('stageEnterable', lang)}</span>
        </div>
        {shown && routePacks.length === 0 && stageMode === 'undecided' ? <p className="text-xs text-fg-3">{t('stageNoRoutePack', lang)}</p> : null}
        <div className="flex flex-wrap items-start gap-2.5 pb-3" data-testid="stage-packs">
          {routePacks.map(({ packId }) => {
            const pack = indexes.packById.get(packId);
            return pack ? <StagePackCard key={packId} pack={pack} ctx={ctx} exclusivesOf={exclusivesOf} onEnter={enter} onOpen={setDetail} /> : null;
          })}
          {stageMode === 'undecided' ? <OtherEntryCard onSkip={next} lang={lang} /> : null}
        </div>
        <OtherPacks offered={offered} exclude={new Set(routePacks.map((p) => p.packId))} ctx={ctx} exclusivesOf={exclusivesOf} onEnter={enter} />
        {detail !== null ? (
          <DetailSurface mode="sheet" label={pick(indexes.packById.get(detail)?.name, lang)} closeLabel={t('routeClose', lang)} onClose={() => setDetail(null)}>
            <PackSheetBody packId={detail} ctx={ctx} />
          </DetailSurface>
        ) : null}
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

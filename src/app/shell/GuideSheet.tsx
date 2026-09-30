/**
 * The guide the header's 「?」 opens: the README's visitor sections as cards, one at a time.
 *
 * The cards sit in a horizontal track with scroll snapping, so a finger swipe is the browser's own
 * scroll and needs no gesture code of ours; the buttons and ←/→ move the same track. The card on
 * show is read back from the scroll position, but only once the track has settled on a card —
 * a smooth scroll passes through every position on the way, and reading those would make the
 * counter flicker. Cards off screen are `inert`, so Tab stays on the one being read.
 */
import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GUIDE_CARDS, pick, t, type Lang } from '../i18n.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';

export function GuideSheet({
  lang,
  noticeUrl,
  onClose,
}: {
  lang: Lang;
  noticeUrl: string;
  onClose: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = GUIDE_CARDS.length;
  const last = index === total - 1;

  const go = (next: number): void => {
    const to = Math.max(0, Math.min(total - 1, next));
    setIndex(to);
    const el = track.current;
    // jsdom has no element `scrollTo`; the index above is what the page reads either way.
    el?.scrollTo?.({ left: to * el.clientWidth, behavior: 'smooth' });
  };

  const onScroll = (): void => {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    const at = Math.round(el.scrollLeft / el.clientWidth);
    if (Math.abs(el.scrollLeft - at * el.clientWidth) < 2 && at !== index) setIndex(at);
  };

  const cardLabel = (i: number): string =>
    t('guideCard', lang, { n: i + 1, total, title: pick(GUIDE_CARDS[i]!.title, lang) });

  return (
    <DetailSurface mode="sheet" label={t('guide', lang)} closeLabel={t('routeClose', lang)} onClose={onClose}>
      <div
        className="flex flex-col gap-3"
        data-testid="guide"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            go(index + 1);
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            go(index - 1);
          }
        }}
      >
        <div className="flex items-baseline gap-2 pr-8">
          <h2 className="text-base font-semibold">{t('guide', lang)}</h2>
          <span className="font-num text-xs text-fg-3" aria-hidden>
            {index + 1} / {total}
          </span>
        </div>
        <div
          ref={track}
          onScroll={onScroll}
          className="scroll-x flex snap-x snap-mandatory"
          aria-roledescription="carousel"
          aria-label={t('guide', lang)}
          data-testid="guide-track"
        >
          {GUIDE_CARDS.map((card, i) => (
            <section
              key={card.title.ko}
              role="group"
              aria-roledescription="slide"
              aria-label={cardLabel(i)}
              inert={i !== index || undefined}
              data-testid="guide-card"
              data-current={i === index || undefined}
              className="flex w-full flex-none snap-start snap-always flex-col gap-2 px-0.5"
            >
              <h3 className="text-lg font-semibold">{pick(card.title, lang)}</h3>
              <ul className="flex flex-col gap-2 break-keep text-sm leading-relaxed text-fg">
                {card.lines.map((line) => (
                  <li key={line.ko} className="flex gap-2">
                    <span className="mt-[0.6em] h-1 w-1 flex-none rounded-full bg-fg-3" aria-hidden />
                    <span>{pick(line, lang)}</span>
                  </li>
                ))}
              </ul>
              {'notice' in card ? (
                <a
                  className="text-sm text-fg-2 underline hover:text-fg"
                  href={noticeUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t('guideNotice', lang)}
                </a>
              ) : null}
            </section>
          ))}
        </div>
        {/* What a screen reader hears when the card changes: the counter and the title. */}
        <p className="sr-only" aria-live="polite" data-testid="guide-live">
          {cardLabel(index)}
        </p>
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label={t('guidePrev', lang)}
            title={t('guidePrev', lang)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-line-control text-fg hover:bg-surface-2 disabled:border-line disabled:text-fg-3 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={18} aria-hidden />
          </button>
          <span className="flex items-center gap-1.5" aria-hidden>
            {GUIDE_CARDS.map((card, i) => (
              <span
                key={card.title.ko}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-ink' : 'w-1.5 bg-line-strong'}`}
              />
            ))}
          </span>
          {last ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center rounded-sm bg-ink px-4 text-sm font-medium text-ink-fg"
              data-testid="guide-done"
            >
              {t('guideDone', lang)}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label={t('guideNext', lang)}
              title={t('guideNext', lang)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-sm border border-line-control text-fg hover:bg-surface-2"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </DetailSurface>
  );
}

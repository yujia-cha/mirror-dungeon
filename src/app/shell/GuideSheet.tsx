/**
 * The guide the header's 「?」 opens: the README's visitor sections as cards, one at a time.
 *
 * The cards sit in a horizontal track with scroll snapping, so a finger swipe is the browser's own
 * scroll and needs no gesture code of ours; the buttons and ←/→ move the same track. The card on
 * show is read back from the scroll position, but only once the track has settled on a card —
 * a smooth scroll passes through every position on the way, and reading those would make the
 * counter flicker. Cards off screen are `inert`, so Tab stays on the one being read.
 *
 * The sheet itself does not scroll (`ownScroll`, M157): the counter, each card's title and the
 * controls at the foot stay in view, and only a card's body scrolls when it is longer than the
 * sheet. When the whole sheet scrolled, a long card pushed ‹ › out of reach.
 *
 * A card is sentences and pictures in the order `docs/copy.md` gives (M114). A sentence is a
 * bullet, a numbered step, a sub-heading or a paragraph (`GuideLine.form`, M157). It may carry
 * `**bold**`, `` `code` `` and links (`parseInline`). An image reserves its box from the size the
 * generator read, loads lazily and never outgrows the sheet; a video plays muted and looped only
 * while its card is on show, and not at all on its own under 「동작 줄이기」 — then it waits on
 * its first frame with the native controls, for the reader to start.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GUIDE_CARDS, isGuideMedia, pick, t, type GuideMedia, type Lang } from '../i18n.ts';
import { DetailSurface } from '../components/BlockDetail.tsx';
import { Button, IconButton } from '../components/ui.tsx';
import { scrollBehavior } from '../lib/motion.ts';
import { parseInline } from '../lib/inline-markdown.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';

/** One guide sentence with its inline marks. */
export function GuideText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((token, i) => {
        if (token.kind === 'strong') return <strong key={i}>{token.text}</strong>;
        if (token.kind === 'code')
          return (
            <code key={i} className="rounded-xs bg-surface-sunken px-1">
              {token.text}
            </code>
          );
        if (token.kind === 'link')
          return (
            <a
              key={i}
              href={token.href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-fg-muted underline hover:text-fg"
            >
              {token.text}
            </a>
          );
        return <span key={i}>{token.text}</span>;
      })}
    </>
  );
}

const MEDIA_CLASS =
  'block h-auto max-h-[45dvh] w-full rounded-md border border-border bg-surface-sunken object-contain';

/** A picture in a card. `active` is whether its card is the one on show. */
export function GuideFigure({ media, lang, active }: { media: GuideMedia; lang: Lang; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const src = `${import.meta.env.BASE_URL}${media.src}`;
  const alt = pick(media.alt, lang);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    // jsdom has no media playback; a browser that refuses autoplay just leaves the first frame.
    if (active && !reduceMotion) void el.play?.()?.catch?.(() => undefined);
    else el.pause?.();
  }, [active, reduceMotion]);

  if (media.kind === 'video')
    return (
      <video
        ref={video}
        src={src}
        aria-label={alt}
        muted
        loop
        playsInline
        preload="metadata"
        controls={reduceMotion}
        className={`${MEDIA_CLASS} aspect-video`}
        data-testid="guide-video"
      />
    );
  return (
    <img
      src={src}
      alt={alt}
      width={media.width}
      height={media.height}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={MEDIA_CLASS}
      data-testid="guide-image"
    />
  );
}

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
    el?.scrollTo?.({ left: to * el.clientWidth, behavior: scrollBehavior() });
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
    <DetailSurface
      mode="sheet"
      label={t('guide', lang)}
      closeLabel={t('routeClose', lang)}
      onClose={onClose}
      ownScroll
    >
      <div
        className="flex min-h-0 flex-1 flex-col gap-3"
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
        <div className="flex flex-none items-baseline gap-2 pr-8">
          <h2 className="text-heading ">{t('guide', lang)}</h2>
          <span className="font-num text-caption text-fg-subtle" aria-hidden>
            {index + 1} / {total}
          </span>
        </div>
        <div
          ref={track}
          onScroll={onScroll}
          className="scroll-x flex min-h-0 flex-1 snap-x snap-mandatory overflow-y-hidden"
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
              className="flex min-h-0 w-full flex-none snap-start snap-always flex-col gap-2 px-0.5"
            >
              <h3 className="flex-none text-title">{pick(card.title, lang)}</h3>
              {/* Only this part scrolls: the title above and the controls below stay in view. A
                  scroller is a tab stop so a keyboard can scroll it (the card's links may be none). */}
              <div
                className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain"
                tabIndex={0}
                data-testid="guide-body"
              >
                <ul className="flex flex-col gap-2 break-keep text-body text-fg">
                  {card.lines.map((line) =>
                    isGuideMedia(line) ? (
                      <li key={line.src}>
                        <GuideFigure media={line} lang={lang} active={i === index} />
                      </li>
                    ) : line.form === 'heading' ? (
                      <li key={line.ko} className="pt-2">
                        <h4 className="text-heading">
                          <GuideText text={pick(line, lang)} />
                        </h4>
                      </li>
                    ) : line.form === 'paragraph' ? (
                      <li key={line.ko}>
                        <GuideText text={pick(line, lang)} />
                      </li>
                    ) : (
                      <li key={line.ko} className="flex gap-2">
                        {line.form === 'numbered' ? (
                          <span className="font-num w-4 flex-none text-label text-fg-muted">{line.n}.</span>
                        ) : (
                          <span
                            className="mt-[0.6em] h-1 w-1 flex-none rounded-full bg-fg-subtle"
                            aria-hidden
                          />
                        )}
                        <span>
                          <GuideText text={pick(line, lang)} />
                        </span>
                      </li>
                    ),
                  )}
                </ul>
                {'notice' in card ? (
                  <a
                    className="text-body text-fg-muted underline hover:text-fg"
                    href={noticeUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t('guideNotice', lang)}
                  </a>
                ) : null}
              </div>
            </section>
          ))}
        </div>
        {/* What a screen reader hears when the card changes: the counter and the title. */}
        <p className="sr-only" aria-live="polite" data-testid="guide-live">
          {cardLabel(index)}
        </p>
        <div className="flex flex-none items-center justify-between gap-2 border-t border-border pt-3">
          <IconButton
            onClick={() => go(index - 1)}
            disabled={index === 0}
            label={t('guidePrev', lang)}
            size="lg"
          >
            <ChevronLeft size={18} aria-hidden />
          </IconButton>
          <span className="flex items-center gap-1.5" aria-hidden>
            {GUIDE_CARDS.map((card, i) => (
              <span
                key={card.title.ko}
                // No transition: the design system animates colour and transform, never width.
                className={`h-1.5 rounded-full ${i === index ? 'w-4 bg-primary' : 'w-1.5 bg-border-strong'}`}
              />
            ))}
          </span>
          {last ? (
            <Button variant="primary" size="lg" onClick={onClose} testId="guide-done">
              {t('guideDone', lang)}
            </Button>
          ) : (
            <IconButton onClick={() => go(index + 1)} label={t('guideNext', lang)} size="lg">
              <ChevronRight size={18} aria-hidden />
            </IconButton>
          )}
        </div>
      </div>
    </DetailSurface>
  );
}

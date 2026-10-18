/**
 * The divider between a side panel and the stage. Dragging it sets the panel's width; the
 * keyboard moves it in steps, and a double press puts it back to the default. It is a separator
 * in the accessibility tree, so its value reads as the width it carries.
 *
 * A drag writes the width straight onto the panel (`panelId`) and this separator, and commits it to
 * the store once, when the pointer lets go. Committing on every `pointermove` re-rendered the whole
 * shell and wrote the persisted state to `localStorage` dozens of times a second. React leaves the
 * panel's inline width alone meanwhile — it only touches a style whose prop changed — and the
 * commit then hands it the same value.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLatest } from '../lib/useLatest.ts';
import { clampPanelWidth, PANEL_WIDTH } from '../store.ts';
import { t, type Lang } from '../i18n.ts';

const STEP = 16;

export function PanelResizer({
  side,
  panelId,
  width,
  onWidth,
  lang,
}: {
  side: 'left' | 'right';
  /** The element id of the panel this divider sizes; a drag writes its width there. */
  panelId: string;
  width: number;
  onWidth: (width: number) => void;
  lang: Lang;
}) {
  const [dragging, setDragging] = useState(false);
  /** Where the drag started, and the width it has reached so far (committed on release). */
  const drag = useRef<{ x: number; width: number; now: number } | null>(null);
  const self = useRef<HTMLDivElement>(null);
  const onWidthRef = useLatest(onWidth);

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event: PointerEvent): void => {
      const from = drag.current;
      if (!from) return;
      // The left panel grows as the pointer goes right; the right one is the mirror of that.
      const delta = side === 'left' ? event.clientX - from.x : from.x - event.clientX;
      const next = clampPanelWidth(from.width + delta);
      if (next === from.now) return;
      from.now = next;
      const panel = document.getElementById(panelId);
      if (panel) panel.style.width = `${next}px`;
      self.current?.setAttribute('aria-valuenow', String(next));
    };
    const stop = (): void => {
      const from = drag.current;
      drag.current = null;
      setDragging(false);
      if (from && from.now !== from.width) onWidthRef.current(from.now);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging, side, panelId, onWidthRef]);

  // A key press is one change already, so it commits at once.
  const onKey = useCallback(
    (event: React.KeyboardEvent): void => {
      const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
      const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === grow) onWidth(clampPanelWidth(width + STEP));
      else if (event.key === shrink) onWidth(clampPanelWidth(width - STEP));
      else if (event.key === 'Home') onWidth(PANEL_WIDTH.default);
      else return;
      event.preventDefault();
    },
    [side, width, onWidth],
  );

  return (
    <div
      ref={self}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-controls={panelId}
      aria-label={t('panelResize', lang)}
      aria-valuenow={width}
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={PANEL_WIDTH.max}
      title={t('panelResizeHint', lang)}
      data-testid={`panel-resizer-${side}`}
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        drag.current = { x: event.clientX, width, now: width };
        setDragging(true);
        event.preventDefault();
      }}
      onDoubleClick={() => onWidth(PANEL_WIDTH.default)}
      onKeyDown={onKey}
      className={`group sticky top-14 z-10 h-[calc(100dvh-56px)] w-1.5 flex-none cursor-col-resize touch-none bg-border/0 transition-colors hover:bg-border-strong focus-visible:bg-primary focus-visible:outline-none ${dragging ? 'bg-primary' : ''}`}
    >
      <span className="pointer-events-none mx-auto block h-full w-px bg-border" aria-hidden />
    </div>
  );
}

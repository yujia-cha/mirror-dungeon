/**
 * The divider between a side panel and the stage. Dragging it sets the panel's width; the
 * keyboard moves it in steps, and a double press puts it back to the default. It is a separator
 * in the accessibility tree, so its value reads as the width it carries.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PANEL_WIDTH } from '../store.ts';
import { t, type Lang } from '../i18n.ts';

const STEP = 16;

export function PanelResizer({ side, width, onWidth, lang }: { side: 'left' | 'right'; width: number; onWidth: (width: number) => void; lang: Lang }) {
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  const onWidthRef = useRef(onWidth);
  onWidthRef.current = onWidth;

  const clamp = (value: number): number => Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, Math.round(value)));

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event: PointerEvent): void => {
      const from = start.current;
      if (!from) return;
      // The left panel grows as the pointer goes right; the right one is the mirror of that.
      const delta = side === 'left' ? event.clientX - from.x : from.x - event.clientX;
      onWidthRef.current(clamp(from.width + delta));
    };
    const stop = (): void => {
      start.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [dragging, side]);

  const onKey = useCallback(
    (event: React.KeyboardEvent): void => {
      const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
      const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === grow) onWidth(clamp(width + STEP));
      else if (event.key === shrink) onWidth(clamp(width - STEP));
      else if (event.key === 'Home') onWidth(PANEL_WIDTH.default);
      else return;
      event.preventDefault();
    },
    [side, width, onWidth],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={t('panelResize', lang)}
      aria-valuenow={width}
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={PANEL_WIDTH.max}
      title={t('panelResizeHint', lang)}
      data-testid={`panel-resizer-${side}`}
      data-dragging={dragging || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        start.current = { x: event.clientX, width };
        setDragging(true);
        event.preventDefault();
      }}
      onDoubleClick={() => onWidth(PANEL_WIDTH.default)}
      onKeyDown={onKey}
      className={`group sticky top-14 z-10 h-[calc(100dvh-56px)] w-1.5 flex-none cursor-col-resize touch-none bg-line/0 transition-colors hover:bg-line-strong focus-visible:bg-ink focus-visible:outline-none ${dragging ? 'bg-ink' : ''}`}
    >
      <span className="pointer-events-none mx-auto block h-full w-px bg-line" aria-hidden />
    </div>
  );
}

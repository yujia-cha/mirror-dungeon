/**
 * A collapsible side panel: beside the stage on a desktop, its own full-screen page on a phone.
 * Both carry a tab bar at the top.
 *
 * The phone page is a page, not a dialog — it covers the shell (which goes `inert` behind it),
 * it has no backdrop, and it does not close on a stray press or on Escape. It closes from its
 * back button or from the device's back gesture, both of which go through the one history entry
 * `usePageHistory` owns.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft } from 'lucide-react';
import { useRovingTabs } from '../lib/useRovingTabs.ts';
import { t, type Lang } from '../i18n.ts';
import { usePageHistory } from '../lib/usePageHistory.ts';

export interface PanelTab<Id extends string> {
  id: Id;
  label: string;
}

export function TabBar<Id extends string>({
  tabs,
  tab,
  onTab,
  label,
}: {
  tabs: PanelTab<Id>[];
  tab: Id;
  onTab: (id: Id) => void;
  label: string;
}) {
  const strip = useRef<HTMLDivElement | null>(null);
  const index = Math.max(
    0,
    tabs.findIndex((entry) => entry.id === tab),
  );
  // One Tab stop for the strip, arrows to move between the tabs; see `useRovingTabs`.
  const onKeyDown = useRovingTabs(strip, tabs.length, index, (next) => {
    const entry = tabs[next];
    if (entry) onTab(entry.id);
  });
  return (
    <div
      ref={strip}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex gap-1 border-b border-line bg-surface px-2 pt-2"
    >
      {tabs.map((entry) => {
        const on = entry.id === tab;
        return (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onTab(entry.id)}
            className={`-mb-px border-b-2 px-2.5 pb-2 pt-1 text-sm ${on ? 'border-ink font-semibold text-fg' : 'border-transparent text-fg-2 hover:text-fg'}`}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}

export function SidePanel<Id extends string>({
  id,
  side,
  label,
  desktop,
  open,
  onClose,
  tabs,
  tab,
  onTab,
  lang,
  width,
  children,
}: {
  id: string;
  side: 'left' | 'right';
  label: string;
  /** Desktop: an aside beside the stage; otherwise a drawer over it. */
  desktop: boolean;
  open: boolean;
  onClose: () => void;
  tabs: PanelTab<Id>[];
  tab: Id;
  onTab: (id: Id) => void;
  lang: Lang;
  /** Desktop width in px, dragged by the divider next to the panel. */
  width: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePageHistory(open, onClose, !desktop);
  useEffect(() => {
    if (open && !desktop) ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [open, desktop]);
  if (!open) return null;
  const bar = <TabBar tabs={tabs} tab={tab} onTab={onTab} label={label} />;
  if (desktop) {
    return (
      <aside
        id={id}
        aria-label={label}
        data-testid={`panel-${side}`}
        style={{ width }}
        className={`sticky top-14 flex h-[calc(100dvh-56px)] flex-none flex-col overflow-hidden bg-surface ${side === 'left' ? 'border-r' : 'border-l'} border-line`}
      >
        {bar}
        <div className="@container min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>
      </aside>
    );
  }
  // Portalled to the body so the page sits outside the shell the phone marks `inert`.
  return createPortal(
    <div
      ref={ref}
      id={id}
      data-testid={`page-${side}`}
      className="fixed inset-0 z-40 flex flex-col bg-bg"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="flex h-11 flex-none items-center gap-1 border-b border-line bg-surface px-1.5">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('panelBack', lang)}
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-full text-fg-2 hover:bg-surface-2"
        >
          <ChevronLeft size={17} aria-hidden />
        </button>
        <h1 className="truncate text-sm font-semibold">{label}</h1>
      </div>
      {bar}
      <div
        className="@container min-h-0 flex-1 overflow-y-auto px-3 py-3"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

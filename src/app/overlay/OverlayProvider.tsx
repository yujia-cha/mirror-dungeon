/**
 * The overlay window (M132), held above the screens like the screen reader's session: the button
 * that opens it sits in the header's 「화면 인식」 popover, which closes on any press outside it,
 * and the window must outlive that. So the window's state is here, inside `CaptureProvider` (the
 * window shows the session's state and log), and the window's contents are drawn from here too.
 */
import type { ReactNode } from 'react';
import { t } from '../i18n.ts';
import { useApp } from '../store.ts';
import { OverlayContext } from './overlay-context.ts';
import { OverlayView } from './OverlayView.tsx';
import { useOverlayWindow } from './useOverlayWindow.ts';

export function OverlayProvider({ children }: { children: ReactNode }) {
  const lang = useApp((s) => s.lang);
  // The window's title bar, in the reader's language.
  const overlay = useOverlayWindow(t('overlayTitle', lang));
  return (
    <OverlayContext.Provider value={overlay}>
      {children}
      {overlay.window ? <OverlayView target={overlay.window.document.body} /> : null}
    </OverlayContext.Provider>
  );
}

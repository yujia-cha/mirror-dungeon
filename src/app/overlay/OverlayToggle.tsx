/**
 * 「오버레이 창 열기」 / 「오버레이 창 닫기」 in the 「화면 인식」 popover (M132). Needs no screen
 * share: the window shows the route and the run whether the reader is on or not. Not drawn where
 * the browser has no Document Picture-in-Picture.
 */
import { PictureInPicture2 } from 'lucide-react';
import { t } from '../i18n.ts';
import { Button } from '../components/ui.tsx';
import { usePlan } from '../shell/plan-context.ts';
import { useOverlay } from './overlay-context.ts';

export function OverlayToggle() {
  const { lang } = usePlan();
  const overlay = useOverlay();
  if (!overlay.supported) return null;
  const open = overlay.window !== null;
  return (
    <div
      className="flex flex-col items-start gap-1 border-t border-border pt-3"
      data-testid="overlay-section"
      data-open={open || undefined}
    >
      {/* The label is the state: 「열기」 while closed, 「닫기」 while the window is up. */}
      <Button onClick={() => (open ? overlay.close() : void overlay.open())} testId="overlay-toggle">
        <PictureInPicture2 size={14} aria-hidden />
        {open ? t('overlayClose', lang) : t('overlayOpen', lang)}
      </Button>
      <p className="text-caption text-fg-subtle">{t('overlayHint', lang)}</p>
    </div>
  );
}

/**
 * The screen reader's one session, held above the screens that show it (M111), and the owner's
 * diagnostics that listen to it (M112).
 *
 * The controls live in a header popover that closes on any press outside it; the share must not
 * end with it. So the session (`useCapture`) sits here, inside `PlanProvider` because it applies
 * events through the plan's run actions, and the popover and the header button read it through
 * `useCaptureSession` (`capture-context.ts`). The diagnostics need the session's state and the
 * session needs the diagnostics' hooks; each reads the other through a getter, not a render value.
 * The visitor's feedback diagnostics (M127, `feedback/`) are a separate record merged in beside them.
 * The overlay window (M132, `overlay/`) shows the session too and outlives the popover for the same
 * reason, so its provider sits right inside this one.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CaptureContext } from './capture-context.ts';
import { useDiagnostics } from './diagnostics/useDiagnostics.ts';
import { useCapture } from './useCapture.ts';
import { mergeCaptureHooks, useVisitorDiagnostics } from '../feedback/useVisitorDiagnostics.ts';
import { OverlayProvider } from '../overlay/OverlayProvider.tsx';

export function CaptureProvider({ children }: { children: ReactNode }) {
  const session = useRef<ReturnType<typeof useCapture> | null>(null);
  const diagnostics = useDiagnostics(
    useMemo(
      () => ({
        status: () => session.current?.status ?? 'idle',
        applying: () => session.current?.applying ?? null,
      }),
      [],
    ),
  );
  // The visitor's own text-only record (M127) listens to the same session, separately.
  const visitor = useVisitorDiagnostics();
  const hooks = useMemo(() => mergeCaptureHooks(visitor, diagnostics.hooks), [visitor, diagnostics.hooks]);
  const capture = useCapture(hooks);
  useEffect(() => {
    session.current = capture;
  });
  const value = useMemo(() => ({ ...capture, diagnostics }), [capture, diagnostics]);
  return (
    <CaptureContext.Provider value={value}>
      <OverlayProvider>{children}</OverlayProvider>
    </CaptureContext.Provider>
  );
}

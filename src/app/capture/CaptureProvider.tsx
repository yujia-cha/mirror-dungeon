/**
 * The screen reader's one session, held above the screens that show it (M111), and the owner's
 * diagnostics that listen to it (M112).
 *
 * The controls live in a header popover that closes on any press outside it; the share must not
 * end with it. So the session (`useCapture`) sits here, inside `PlanProvider` because it applies
 * events through the plan's run actions, and the popover and the header button read it through
 * `useCaptureSession` (`capture-context.ts`). The diagnostics need the session's state and the
 * session needs the diagnostics' hooks; each reads the other through a getter, not a render value.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { CaptureContext } from './capture-context.ts';
import { useDiagnostics } from './diagnostics/useDiagnostics.ts';
import { useCapture } from './useCapture.ts';

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
  const capture = useCapture(diagnostics.hooks);
  useEffect(() => {
    session.current = capture;
  });
  const value = useMemo(() => ({ ...capture, diagnostics }), [capture, diagnostics]);
  return <CaptureContext.Provider value={value}>{children}</CaptureContext.Provider>;
}

/**
 * The feedback log's one wiring point (M127), called by `main.tsx` before the first render: the
 * window's uncaught errors and the store's changes go into `feedbackLog`, and each entry is copied
 * to the visitor's own diagnostics record while that is on.
 */
import { feedbackLog, installFeedbackLog } from '../lib/feedback-log.ts';
import { useApp } from '../store.ts';
import { visitorDiagnostics } from './visitor-diagnostics.ts';

export function installFeedback(): () => void {
  const uninstall = installFeedbackLog(window, useApp);
  const unlink = feedbackLog.subscribe((entry) => visitorDiagnostics.onLog(entry));
  // A record batched for writing must not be lost with the tab.
  const flush = (): void => visitorDiagnostics.flush();
  window.addEventListener('pagehide', flush);
  return () => {
    uninstall();
    unlink();
    window.removeEventListener('pagehide', flush);
  };
}

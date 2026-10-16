/** The screen reader session's context and hook (the provider is `CaptureProvider.tsx`, M111). */
import { createContext, useContext } from 'react';
import type { DiagnosticsApi } from './diagnostics/useDiagnostics.ts';
import type { useCapture } from './useCapture.ts';

/** The session, and the owner's diagnostics that listen to it (M112). */
export type CaptureApi = ReturnType<typeof useCapture> & { diagnostics: DiagnosticsApi };

export const CaptureContext = createContext<CaptureApi | null>(null);

/** The session. Throws outside `CaptureProvider`, like `usePlan`. */
export function useCaptureSession(): CaptureApi {
  const value = useContext(CaptureContext);
  if (!value) throw new Error('useCaptureSession needs a CaptureProvider');
  return value;
}

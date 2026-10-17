/** The overlay window's context and hook (the provider is `OverlayProvider.tsx`, M132). */
import { createContext, useContext } from 'react';
import type { OverlayWindowApi } from './useOverlayWindow.ts';

export const OverlayContext = createContext<OverlayWindowApi | null>(null);

/** The window. Throws outside `OverlayProvider`, like `useCaptureSession`. */
export function useOverlay(): OverlayWindowApi {
  const value = useContext(OverlayContext);
  if (!value) throw new Error('useOverlay needs an OverlayProvider');
  return value;
}

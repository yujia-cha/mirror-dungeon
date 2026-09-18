import { useSyncExternalStore } from 'react';

/** Whether `query` matches; false where `matchMedia` is missing (jsdom), which reads as a phone. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** The desktop layout: side panels beside the stage instead of drawers over it. */
export function useDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

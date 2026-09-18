import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals, so Testing Library's automatic cleanup is not registered for us.
// Without this, every render stacks up and queries find duplicates.
afterEach(() => {
  cleanup();
});

// jsdom has no pointer events. A MouseEvent with the pointer fields is enough for the drag hook,
// which registers window listeners and only uses pointer capture when the element offers it.
//
// A suite that opts into the node environment (`// @vitest-environment node`, for the ones that
// read data/raw the way the pipeline scripts do) has no DOM at all, so all of this is skipped.
if (typeof globalThis.Element !== 'undefined') {
  if (typeof globalThis.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      readonly isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
      }
    }
    Object.defineProperty(globalThis, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
    // Testing Library builds events from `window[EventType]`, a separate object in vitest's jsdom.
    if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
      Object.defineProperty(window, 'PointerEvent', { value: PointerEventPolyfill, configurable: true, writable: true });
    }
  }
  for (const name of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (typeof Element.prototype[name] !== 'function') {
      Object.defineProperty(Element.prototype, name, { value: () => undefined, configurable: true, writable: true });
    }
  }
  if (typeof Element.prototype.hasPointerCapture !== 'function') {
    Object.defineProperty(Element.prototype, 'hasPointerCapture', { value: () => false, configurable: true, writable: true });
  }
}

/**
 * M122: a first visit starts dark whatever the system prefers; a saved choice still wins.
 */
import { describe, expect, it } from 'vitest';
import { PERSIST_VERSION, sanitizePersisted } from '../store.ts';

describe('theme (M122)', () => {
  it('starts dark on a first visit even when the system prefers light, and keeps a saved choice', () => {
    // Arrange: a system that prefers light.
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('light'),
    })) as typeof window.matchMedia;
    try {
      // Act + Assert
      expect(sanitizePersisted({}, PERSIST_VERSION).dark).toBe(true);
      expect(sanitizePersisted({ dark: false }, PERSIST_VERSION).dark).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });
});

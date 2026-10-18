import { describe, expect, it } from 'vitest';
import { advancePin } from './lock-pin.ts';

describe('advancePin', () => {
  it('leaves fetchedAt alone when the tip is the pinned commit', () => {
    // Arrange
    const pin = { ref: 'main', sha: 'aaaa' };
    const entry = { fetchedAt: '2026-10-01' };
    // Act
    const moved = advancePin(pin, entry, 'aaaa', '2026-10-18');
    // Assert
    expect(moved).toBe(false);
    expect(pin.sha).toBe('aaaa');
    expect(entry.fetchedAt).toBe('2026-10-01');
  });

  it('moves the sha and stamps fetchedAt when the tip moved', () => {
    // Arrange
    const pin = { ref: 'main', sha: 'aaaa' };
    const entry = { fetchedAt: '2026-10-01' };
    // Act
    const moved = advancePin(pin, entry, 'bbbb', '2026-10-18');
    // Assert
    expect(moved).toBe(true);
    expect(pin.sha).toBe('bbbb');
    expect(entry.fetchedAt).toBe('2026-10-18');
  });
});

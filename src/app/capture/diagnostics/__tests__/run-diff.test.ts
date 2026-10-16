import { describe, expect, it } from 'vitest';
import { emptyRun } from '../../../store.ts';
import { runDiff } from '../useDiagnostics.ts';

describe('runDiff', () => {
  it('is null when nothing changed', () => {
    expect(runDiff(emptyRun(), emptyRun())).toBeNull();
  });

  it('lists entries, statuses and the frontier that moved, in order', () => {
    // Arrange
    const before = { ...emptyRun(), giftStatus: { 9006: 'got' as const } };
    const after = {
      ...emptyRun(),
      currentFloor: 2,
      visits: { 1: 1002 },
      giftStatus: { 9403: 'got' as const, 9404: 'failed' as const },
    };
    // Act
    const diff = runDiff(before, after);
    // Assert
    expect(diff).toEqual({
      visits: [{ floor: 1, from: null, to: 1002 }],
      status: [
        { giftId: 9006, from: 'got', to: null },
        { giftId: 9403, from: null, to: 'got' },
        { giftId: 9404, from: null, to: 'failed' },
      ],
      currentFloor: { from: 1, to: 2 },
    });
  });
});

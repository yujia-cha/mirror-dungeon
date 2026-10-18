import { describe, expect, it } from 'vitest';
import { appDefaultOptions, emptyRun, sanitizeRun } from '../../store.ts';
import { consumedStatus, giftDone, planInputFor } from '../plan-input.ts';

describe('「조합에 씀」 — an ingredient used up in a fusion the route wanted (M149)', () => {
  it('is what a fusion leaves its ingredients only when it made a gift the route collects', () => {
    expect(consumedStatus(50, new Set([50, 1]))).toBe('used');
    expect(consumedStatus(60, new Set([50, 1]))).toBeNull();
    expect(consumedStatus(50, undefined)).toBeNull();
  });

  it('counts as dealt with, like a gift in hand, and nothing else does', () => {
    expect([giftDone('got'), giftDone('used')]).toEqual([true, true]);
    expect([giftDone('failed'), giftDone(null), giftDone(undefined)]).toEqual([false, false, false]);
  });

  it('is neither owned nor lost for the planner, so a second fusion eating it routes for another', () => {
    // Arrange: 9001 in hand, 9002 used up, 9003 missed.
    const run = { ...emptyRun(), giftStatus: { 9001: 'got', 9002: 'used', 9003: 'failed' } as const };
    // Act
    const input = planInputFor({ deck: [], deployed: [], wanted: [], options: appDefaultOptions(), run });
    // Assert
    expect(input.options.ownedGifts).toEqual([9001]);
    expect(input.options.unobtainableGifts).toEqual([9003]);
  });

  it('survives a reload, while an unknown status does not', () => {
    const run = sanitizeRun({ currentFloor: 3, giftStatus: { 9002: 'used', 9004: 'eaten' } });
    expect(run.giftStatus).toEqual({ 9002: 'used' });
  });
});

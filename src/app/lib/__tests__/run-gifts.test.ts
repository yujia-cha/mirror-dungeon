/**
 * M160: the two readings of the run record every surface shares.
 */
import { describe, expect, it } from 'vitest';
import { floorOfVisit, heldGifts } from '../run-gifts.ts';

describe('heldGifts', () => {
  it('lists the gifts marked collected, not the used or missed ones, as numbers', () => {
    // Arrange
    const giftStatus = { 9001: 'got', 9002: 'failed', 9003: 'used', 9004: 'got' } as const;
    // Act + Assert
    expect(heldGifts(giftStatus)).toEqual([9001, 9004]);
    expect(heldGifts({})).toEqual([]);
  });
});

describe('floorOfVisit', () => {
  it('finds the floor a pack was entered on, as a number, or null', () => {
    // Arrange
    const visits = { 1: 1001, 3: 1008 };
    // Act + Assert
    expect(floorOfVisit(visits, 1008)).toBe(3);
    expect(floorOfVisit(visits, 1001)).toBe(1);
    expect(floorOfVisit(visits, 1002)).toBeNull();
    expect(floorOfVisit({}, 1001)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { fitShift } from '../fit-inside.ts';

describe('fitShift', () => {
  const bounds = { left: 0, right: 400 };

  it('leaves a popover that fits where it is', () => {
    expect(fitShift({ left: 10, right: 350 }, bounds, 12)).toBe(0);
  });

  it('slides a popover that runs past the right edge back inside, padding kept', () => {
    // A right-column slot at x=200 with a 340px picker: 540 → 388.
    expect(fitShift({ left: 200, right: 540 }, bounds, 12)).toBe(-152);
  });

  it('never pushes the left edge past the bounds', () => {
    expect(fitShift({ left: 20, right: 460 }, bounds, 12)).toBe(-8);
    expect(fitShift({ left: 5, right: 460 }, bounds, 12)).toBe(-0);
  });
});

import { describe, expect, it } from 'vitest';
import { scaledIconSize, tileColumns } from '../lib/icon-size.ts';

describe('scaledIconSize', () => {
  it('keeps the base size at 「보통」', () => {
    expect(scaledIconSize(32, 'md')).toBe(32);
    expect(scaledIconSize(44, 'md')).toBe(44);
  });

  it('scales both bases to whole pixels', () => {
    // Arrange + Act + Assert: the list tile reaches the stage size at 「크게」.
    expect(scaledIconSize(32, 'sm')).toBe(28);
    expect(scaledIconSize(32, 'lg')).toBe(44);
    expect(scaledIconSize(32, 'xl')).toBe(56);
    expect(scaledIconSize(44, 'sm')).toBe(39);
    expect(scaledIconSize(44, 'xl')).toBe(77);
  });
});

describe('tileColumns', () => {
  it('never goes narrower than the 64px the names were laid out for', () => {
    expect(tileColumns(28)).toBe('repeat(auto-fill,minmax(64px,1fr))');
    expect(tileColumns(32)).toBe('repeat(auto-fill,minmax(64px,1fr))');
  });

  it('widens the column for a larger tile', () => {
    expect(tileColumns(44)).toBe('repeat(auto-fill,minmax(68px,1fr))');
    expect(tileColumns(56)).toBe('repeat(auto-fill,minmax(80px,1fr))');
  });
});

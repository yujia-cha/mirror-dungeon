import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artKeysAcrossSeasons } from './art-keys.ts';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function write(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

describe('artKeysAcrossSeasons', () => {
  it('unions every season index.json lists, so a frozen season keeps its drawings legal', () => {
    dir = mkdtempSync(join(tmpdir(), 'art-keys-'));
    write(join(dir, 'index.json'), { default: 8, seasons: [{ id: 8 }, { id: 7 }] });
    write(join(dir, 'md7/gifts.json'), [{ icon: 9001 }, { icon: 9002 }]);
    write(join(dir, 'md7/packs.json'), [{ sprite: 'Old' }, { sprite: 'Kept' }]);
    write(join(dir, 'md8/gifts.json'), [{ icon: 9002 }, { icon: 9900 }]);
    write(join(dir, 'md8/packs.json'), [{ sprite: 'Kept' }, { sprite: 'Kept' }]);

    const keys = artKeysAcrossSeasons(dir);
    expect(Object.fromEntries(keys.gifts)).toEqual({ 9001: [7], 9002: [7, 8], 9900: [8] });
    expect(Object.fromEntries(keys.packs)).toEqual({ Old: [7], Kept: [7, 8] });
  });

  it('reads nothing when there is no index, rather than throwing', () => {
    dir = mkdtempSync(join(tmpdir(), 'art-keys-'));
    const keys = artKeysAcrossSeasons(dir);
    expect(keys.gifts.size + keys.packs.size).toBe(0);
  });
});

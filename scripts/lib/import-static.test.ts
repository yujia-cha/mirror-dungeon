import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { indexByName, planImport, writeImport } from './import-static.ts';

describe('data:import writes all or nothing', () => {
  let box: string;
  let source: string;
  let target: string;
  const targetOf = (file: string) => join(target, file);

  beforeEach(() => {
    box = mkdtempSync(join(tmpdir(), 'md-import-'));
    source = join(box, 'extracted');
    target = join(box, 'static');
    mkdirSync(join(source, 'deep'), { recursive: true });
    writeFileSync(join(source, 'a.json'), JSON.stringify({ list: [1] }));
    writeFileSync(join(source, 'deep', 'b.json'), JSON.stringify({ list: [2] }));
  });
  afterEach(() => rmSync(box, { recursive: true, force: true }));

  it('copies nothing when a later file is rejected', () => {
    // Arrange: a.json is fine, c.json (checked after it) is not JSON.
    writeFileSync(join(source, 'c.json'), 'not json');
    const plan = planImport(['x/a.json', 'x/c.json'], indexByName(source), targetOf);
    // Act
    const wrote = writeImport(plan);
    // Assert
    expect(plan.copies.map((c) => c.file)).toEqual(['x/a.json']);
    expect(plan.rejected).toEqual(['x/c.json — not valid JSON']);
    expect(wrote).toBe(false);
    expect(existsSync(target)).toBe(false);
  });

  it('copies every changed file when nothing is rejected', () => {
    // Arrange: b.json is already vendored as it is.
    mkdirSync(join(target, 'x'), { recursive: true });
    writeFileSync(join(target, 'x', 'b.json'), JSON.stringify({ list: [2] }));
    const plan = planImport(['x/a.json', 'x/b.json', 'x/gone.json'], indexByName(source), targetOf);
    // Act
    const wrote = writeImport(plan);
    // Assert
    expect(wrote).toBe(true);
    expect(plan.unchanged).toEqual(['x/b.json']);
    expect(plan.missing).toEqual(['x/gone.json']);
    expect(JSON.parse(readFileSync(join(target, 'x', 'a.json'), 'utf8'))).toEqual({ list: [1] });
  });

  it('rejects a name two extracted files share', () => {
    // Arrange
    writeFileSync(join(source, 'deep', 'a.json'), JSON.stringify({ list: [3] }));
    // Act
    const plan = planImport(['x/a.json'], indexByName(source), targetOf);
    // Assert
    expect(plan.rejected).toEqual(['x/a.json — 2 files share this name; cannot tell them apart']);
    expect(writeImport(plan)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { appendRow, changelogRow, countsSummary, sourcesSummary } from './changelog.ts';
import type { Meta } from '../../src/core/schema.ts';

function meta(overrides: Partial<Meta> = {}): Meta {
  return {
    dataVersion: '7.f85f9464',
    schemaVersion: 1,
    dungeon: { id: 7, name: { ko: '이름과 거미의 거울', en: 'Mirror of Names and Spiders' } },
    sources: {
      openLethe: { repo: 'LEAGUE-OF-NINE/OpenLethe', sha: '823129adccea571a', fetchedAt: '2026-09-11' },
      localize: {
        repo: 'LocalizeLimbusCompany/LocalizeLimbusCompany',
        sha: '231a8bcfc3472737',
        fetchedAt: '2026-09-11',
      },
    },
    staticDataPresent: true,
    provisional: false,
    counts: { gifts: 446, packs: 116, identities: 183, fusionRecipes: 68 },
    ...overrides,
  };
}

describe('countsSummary', () => {
  it('lists only the counts that moved, with the delta', () => {
    const before = meta();
    const after = meta({ counts: { gifts: 448, packs: 117, identities: 183, fusionRecipes: 68 } });
    expect(countsSummary(before, after)).toBe('기프트 446→448 (+2), 팩 116→117 (+1)');
  });

  it('says so when only the contents changed', () => {
    expect(countsSummary(meta(), meta({ dataVersion: '7.aaaaaaaa' }))).toBe('수치 변동 없음 (내용만 변경)');
  });

  it('falls back to plain totals for the first entry', () => {
    expect(countsSummary(null, meta())).toBe('기프트 446, 팩 116, 인격 183, 조합 레시피 68');
  });

  it('reports a removal with a negative delta', () => {
    const after = meta({ counts: { gifts: 444, packs: 116, identities: 183, fusionRecipes: 68 } });
    expect(countsSummary(meta(), after)).toBe('기프트 446→444 (-2)');
  });
});

describe('sourcesSummary', () => {
  it('shows an arrow only for sources whose sha moved', () => {
    const after = meta({
      sources: {
        ...meta().sources,
        openLethe: { repo: 'LEAGUE-OF-NINE/OpenLethe', sha: '1a2b3c4d5e6f7890', fetchedAt: '2026-10-01' },
      },
    });
    expect(sourcesSummary(meta(), after)).toBe('localize 231a8bcf / openLethe 823129ad→1a2b3c4d');
  });

  it('lists bare shas when there is no previous meta', () => {
    expect(sourcesSummary(null, meta())).toBe('localize 231a8bcf / openLethe 823129ad');
  });
});

describe('changelogRow', () => {
  it('renders one markdown table row', () => {
    const after = meta({
      dataVersion: '7.aaaaaaaa',
      counts: { gifts: 448, packs: 116, identities: 183, fusionRecipes: 68 },
    });
    expect(changelogRow(meta(), after, '2026-10-01')).toBe(
      '| 2026-10-01 | 7.aaaaaaaa | localize 231a8bcf / openLethe 823129ad | 기프트 446→448 (+2) |',
    );
  });
});

describe('appendRow', () => {
  const doc = [
    '# 데이터 변경 기록',
    '',
    '| 날짜 | dataVersion | 원본 | 변경 |',
    '|---|---|---|---|',
    '| 2026-09-11 | 7.f85f9464 | localize 231a8bcf | 기프트 446 |',
    '',
  ].join('\n');

  it('inserts after the last table row and keeps the rest of the file', () => {
    const out = appendRow(doc, '| 2026-10-01 | 7.aaaaaaaa | localize 231a8bcf | 기프트 448 |');
    expect(out.split('\n')).toEqual([
      '# 데이터 변경 기록',
      '',
      '| 날짜 | dataVersion | 원본 | 변경 |',
      '|---|---|---|---|',
      '| 2026-09-11 | 7.f85f9464 | localize 231a8bcf | 기프트 446 |',
      '| 2026-10-01 | 7.aaaaaaaa | localize 231a8bcf | 기프트 448 |',
      '',
    ]);
  });

  it('does not record the same refresh twice, even on a later date', () => {
    expect(appendRow(doc, '| 2026-10-01 | 7.f85f9464 | localize 231a8bcf | 기프트 446 |')).toBe(doc);
  });

  it('appends at the end when the document has no table yet', () => {
    expect(appendRow('# 기록\n', '| 2026-10-01 | 7.a | x | y |')).toBe(
      '# 기록\n\n| 2026-10-01 | 7.a | x | y |\n',
    );
  });
});

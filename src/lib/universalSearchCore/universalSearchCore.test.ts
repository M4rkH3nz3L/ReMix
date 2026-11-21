import type { SearchDoc } from '@/lib/universalSearchCore/docs';
import { allowedEdits, docTime, editDistance, inRange, isUnfinished } from '@/lib/universalSearchCore/scoring';
import * as universalSearch from '@/lib/universalSearch';

/** 🔎 A universal search belső segédei (REFACTOR: a src/lib/universalSearch.ts-ből kiemelve) — a mai viselkedés rögzítve. */

const doc = (over: Partial<SearchDoc> = {}): SearchDoc => ({ id: 'd', scope: 'project', title: 't', ...over });

describe('editDistance — korlátos Levenshtein', () => {
  it('pontos táv a korláton belül', () => {
    expect(editDistance('neon', 'neon', 2)).toBe(0);
    expect(editDistance('neon', 'noen', 2)).toBe(2);
    expect(editDistance('intro', 'introo', 1)).toBe(1);
  });

  it('korlát fölött max+1 (hossz-különbség vagy sor-minimum miatt korán kilép)', () => {
    expect(editDistance('ab', 'abcdef', 2)).toBe(3);
    expect(editDistance('abcd', 'wxyz', 1)).toBe(2);
  });
});

describe('allowedEdits — a hossz-függő hibaszám', () => {
  it('≤3 → 0, 4–5 → 1, 6+ → 2', () => {
    expect([1, 3, 4, 5, 6, 12].map(allowedEdits)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('docTime / inRange — idő-szűrés', () => {
  it('az updatedAt előnyt élvez a createdAt-tel szemben', () => {
    expect(docTime(doc({ createdAt: 'c', updatedAt: 'u' }))).toBe('u');
    expect(docTime(doc({ createdAt: 'c' }))).toBe('c');
    expect(docTime(doc())).toBeUndefined();
  });

  it('idő nélküli dokumentum csak szűrő NÉLKÜL fér be; a from inkluzív, a to exkluzív', () => {
    expect(inRange(doc(), {})).toBe(true);
    expect(inRange(doc(), { from: '2026' })).toBe(false);
    const d = doc({ updatedAt: '2026-06-01T00:00:00.000Z' });
    expect(inRange(d, { from: '2026-06-01T00:00:00.000Z' })).toBe(true);
    expect(inRange(d, { to: '2026-06-01T00:00:00.000Z' })).toBe(false);
  });
});

describe('isUnfinished — a „félbehagyott” heurisztika', () => {
  it.each([
    [{ published: true, progress: 0.2 }, false],
    [{ progress: 1, status: 'draft' }, false],
    [{ status: 'published', published: false }, false],
    [{ published: false }, true],
    [{ progress: 0.5 }, true],
    [{ status: 'review' }, true],
    [{ status: 'archived' }, false],
    [{}, false],
  ] as const)('%j → %s', (meta, expected) => {
    expect(isUnfinished(doc({ meta: { ...meta } }))).toBe(expected);
  });

  it('meta nélkül nem félbehagyott', () => {
    expect(isUnfinished(doc())).toBe(false);
  });
});

describe('universalSearch barrel — a publikus felület', () => {
  it('a futásidejű exportok listája változatlan', () => {
    expect(Object.keys(universalSearch).sort()).toEqual(
      ['assetToDoc', 'groupByScope', 'parseQuery', 'projectToDoc', 'resolveTimeRange', 'scoreDoc', 'scoreDocFuzzy', 'search', 'suggest'].sort()
    );
  });
});

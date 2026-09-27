import {
  applyUnifiedDiff,
  buildHunks,
  diffLines,
  diffStats,
  formatUnifiedDiff,
  parseUnifiedDiff,
} from '@/lib/codeDiff';

describe('codeDiff — diffLines', () => {
  it('egyszerű csere: egy sor törlődik, egy hozzáadódik', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    expect(d).toEqual([
      { kind: 'equal', text: 'a' },
      { kind: 'remove', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'equal', text: 'c' },
    ]);
  });

  it('azonos szöveg → csupa equal', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.kind === 'equal')).toBe(true);
  });

  it('diffStats megszámolja az add/remove-ot', () => {
    expect(diffStats(diffLines('a\nb', 'a\nb\nc'))).toEqual({ additions: 1, deletions: 0 });
    expect(diffStats(diffLines('a\nb\nc', 'a'))).toEqual({ additions: 0, deletions: 2 });
  });
});

describe('codeDiff — unified formázás + parse', () => {
  it('formatUnifiedDiff fejlécet + prefixelt sorokat ad', () => {
    const patch = formatUnifiedDiff('a\nb\nc\n', 'a\nB\nc\n', { context: 1 });
    expect(patch).toContain('--- a');
    expect(patch).toContain('+++ b');
    expect(patch).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(patch).toContain('-b');
    expect(patch).toContain('+B');
  });

  it('azonos bemenetre üres patch', () => {
    expect(formatUnifiedDiff('x\ny', 'x\ny')).toBe('');
  });

  it('parseUnifiedDiff visszaadja a hunk-okat + sorokat', () => {
    const patch = formatUnifiedDiff('a\nb\nc', 'a\nB\nc', { context: 1 });
    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(1);
    const kinds = hunks[0].lines.map((l) => l.kind);
    expect(kinds).toContain('remove');
    expect(kinds).toContain('add');
  });
});

describe('codeDiff — apply (round-trip garancia)', () => {
  const roundtrip = (a: string, b: string, context = 3) => {
    const patch = formatUnifiedDiff(a, b, { context });
    return applyUnifiedDiff(a, patch);
  };

  it('egyszerű csere round-trip', () => {
    const a = 'line1\nline2\nline3\nline4';
    const b = 'line1\nCHANGED\nline3\nline4';
    const res = roundtrip(a, b);
    expect(res.ok).toBe(true);
    expect(res.result).toBe(b);
  });

  it('több különálló hunk round-trip', () => {
    const a = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const b = a.replace('l2', 'X2').replace('l17', 'X17');
    const res = roundtrip(a, b);
    expect(res.ok).toBe(true);
    expect(res.result).toBe(b);
  });

  it('beszúrás a végére + törlés az elejéről', () => {
    const a = 'a\nb\nc';
    const b = 'b\nc\nd\ne';
    const res = roundtrip(a, b);
    expect(res.ok).toBe(true);
    expect(res.result).toBe(b);
  });

  it('üres patch → változatlan forrás', () => {
    const res = applyUnifiedDiff('x\ny', '');
    expect(res.ok).toBe(true);
    expect(res.result).toBe('x\ny');
  });

  it('a horgony sor-szám eltolódásra ROBUSZTUS (patch régebbi verzióhoz)', () => {
    const base = 'a\nb\nc\nd';
    const b = 'a\nb\nC\nd';
    const patch = formatUnifiedDiff(base, b, { context: 1 });
    // a forrásba előre beszúrtak egy sort → a sor-számok eltolódtak, de a horgony megvan
    const shifted = 'HEADER\n' + base;
    const res = applyUnifiedDiff(shifted, patch);
    expect(res.ok).toBe(true);
    expect(res.result).toBe('HEADER\na\nb\nC\nd');
  });
});

describe('codeDiff — konfliktus', () => {
  it('ha a horgony nem található → konfliktus, a forrás VÁLTOZATLAN', () => {
    const patch = formatUnifiedDiff('a\nb\nc', 'a\nB\nc', { context: 1 });
    const res = applyUnifiedDiff('teljesen\nmás\ntartalom', patch);
    expect(res.ok).toBe(false);
    expect(res.result).toBe('teljesen\nmás\ntartalom');
    expect(res.conflicts[0]).toMatchObject({ hunkIndex: 0, detail: 'anchor_not_found' });
  });
});

describe('codeDiff — buildHunks', () => {
  it('a közeli változásokat egy hunkba vonja, a távoliakat külön', () => {
    const a = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n');
    const b = a.replace('l1', 'X1').replace('l25', 'X25');
    const hunks = buildHunks(diffLines(a, b), 3);
    expect(hunks).toHaveLength(2);
  });
});

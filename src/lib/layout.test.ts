import {
  alignRects,
  autoLayout,
  boundingBox,
  distributeCenters,
  distributeSpacing,
  gridColumns,
  resizeWithConstraints,
  snapToGrid,
  type Rect,
} from '@/lib/layout';

describe('layout — boundingBox', () => {
  it('uniós doboz', () => {
    const rects: Rect[] = [
      { x: 10, y: 10, width: 20, height: 20 },
      { x: 50, y: 5, width: 10, height: 40 },
    ];
    expect(boundingBox(rects)).toEqual({ x: 10, y: 5, width: 50, height: 40 });
  });
  it('üres → 0-doboz', () => {
    expect(boundingBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('layout — alignRects', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 40, y: 20, width: 20, height: 30 },
  ];

  it('left: mindkettő a doboz bal széléhez', () => {
    expect(alignRects(rects, 'left').map((r) => r.x)).toEqual([0, 0]);
  });
  it('right: a jobb szélhez (x = right - width)', () => {
    // bbox right = 60 → x = 60-10=50 és 60-20=40
    expect(alignRects(rects, 'right').map((r) => r.x)).toEqual([50, 40]);
  });
  it('hcenter a megadott container középpontjára', () => {
    const c: Rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(alignRects([{ x: 0, y: 0, width: 20, height: 20 }], 'hcenter', c)[0].x).toBe(40);
  });
  it('vcenter csak a függőleges tengelyt mozgatja', () => {
    const out = alignRects(rects, 'vcenter');
    expect(out[0].x).toBe(0); // x érintetlen
  });
});

describe('layout — distribute', () => {
  it('distributeSpacing egyenlő réseket ad (szélsők maradnak)', () => {
    // három 10 széles, span 0..70 → free = 70-30 = 40, gap = 20
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 25, y: 0, width: 10, height: 10 },
      { x: 60, y: 0, width: 10, height: 10 },
    ];
    const out = distributeSpacing(rects, 'horizontal');
    expect(out.map((r) => r.x)).toEqual([0, 30, 60]);
  });

  it('distributeCenters egyenlő középpont-távolságot ad', () => {
    const rects: Rect[] = [
      { x: 0, y: 0, width: 10, height: 10 }, // center 5
      { x: 20, y: 0, width: 20, height: 10 }, // center 30
      { x: 90, y: 0, width: 10, height: 10 }, // center 95
    ];
    // első center 5, utolsó 95 → step 45 → középső center 50 → x=50-10=40
    expect(distributeCenters(rects, 'horizontal')[1].x).toBe(40);
  });

  it('<3 elemre no-op (másolat)', () => {
    const rects: Rect[] = [{ x: 0, y: 0, width: 10, height: 10 }];
    expect(distributeSpacing(rects, 'horizontal')).toEqual(rects);
  });

  it('megőrzi a bemeneti sorrendet', () => {
    const rects: Rect[] = [
      { x: 60, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 25, y: 0, width: 10, height: 10 },
    ];
    const out = distributeSpacing(rects, 'horizontal');
    // a 0. elem (eredetileg jobb szélen, x=60) marad a span jobb végén
    expect(out[0].x).toBe(60);
    expect(out[1].x).toBe(0);
  });
});

describe('layout — autoLayout (flex)', () => {
  const children = [
    { width: 20, height: 10 },
    { width: 30, height: 10 },
  ];

  it('row + gap + padding, start igazítás', () => {
    const out = autoLayout({ width: 200, height: 50 }, children, {
      direction: 'row',
      gap: 10,
      padding: 5,
      align: 'start',
    });
    expect(out[0]).toMatchObject({ x: 5, y: 5, width: 20 });
    expect(out[1].x).toBe(35); // 5 + 20 + 10
  });

  it('column + center kereszt-igazítás', () => {
    const out = autoLayout({ width: 100, height: 200 }, children, { direction: 'column', gap: 0, align: 'center' });
    // első gyerek width 20 → x = (100-20)/2 = 40
    expect(out[0].x).toBe(40);
    expect(out[1].x).toBe(35); // (100-30)/2
    expect(out[1].y).toBe(10); // 0 + 10
  });

  it('justify space-between kihúzza a széleket', () => {
    const out = autoLayout({ width: 100, height: 20 }, children, { direction: 'row', justify: 'space-between' });
    expect(out[0].x).toBe(0);
    expect(out[1].x).toBe(70); // 100-30
  });

  it('align stretch a keresztméretet a belső sávra húzza', () => {
    const out = autoLayout({ width: 100, height: 40 }, [{ width: 20, height: 10 }], {
      direction: 'row',
      padding: 5,
      align: 'stretch',
    });
    expect(out[0].height).toBe(30); // 40 - 5 - 5
  });

  it('üres gyereklista → üres', () => {
    expect(autoLayout({ width: 10, height: 10 }, [], { direction: 'row' })).toEqual([]);
  });
});

describe('layout — grid + snap', () => {
  it('gridColumns margóval és belső közzel', () => {
    // 100 széles, 2 oszlop, gutter 10, margin 5 → usable = 100-10-10 = 80 → colW 40
    const cols = gridColumns(100, 2, 10, 5);
    expect(cols[0]).toMatchObject({ x: 5, width: 40 });
    expect(cols[1].x).toBe(55); // 5 + 40 + 10
  });

  it('snapToGrid a legközelebbi pontra', () => {
    expect(snapToGrid(23, 10)).toBe(20);
    expect(snapToGrid(26, 10)).toBe(30);
    expect(snapToGrid(23, 10, 5)).toBe(25); // origó 5 → pontok 5,15,25,…
  });
});

describe('layout — resizeWithConstraints', () => {
  const old = { width: 100, height: 100 };
  const bigger = { width: 200, height: 100 };
  const rect: Rect = { x: 10, y: 10, width: 20, height: 20 };

  it('start: pozíció + méret változatlan', () => {
    expect(resizeWithConstraints(rect, old, bigger, { horizontal: 'start', vertical: 'start' })).toMatchObject({ x: 10, width: 20 });
  });
  it('end: a jobb margó marad (right-anchor)', () => {
    // old right margin = 100-(10+20)=70 → új x = 200-70-20 = 110
    expect(resizeWithConstraints(rect, old, bigger, { horizontal: 'end', vertical: 'start' }).x).toBe(110);
  });
  it('stretch: a szélesség a konténerrel nő (marginok maradnak)', () => {
    // left margin 10, right margin 70 → új width = 200-10-70 = 120
    expect(resizeWithConstraints(rect, old, bigger, { horizontal: 'stretch', vertical: 'start' }).width).toBe(120);
  });
  it('scale: pozíció + méret arányosan', () => {
    const r = resizeWithConstraints(rect, old, bigger, { horizontal: 'scale', vertical: 'start' });
    expect(r.x).toBe(20); // 10 * 2
    expect(r.width).toBe(40); // 20 * 2
  });
  it('center: a középpont-eltolás megmarad', () => {
    // center = 10+10=20; offset a konténer közepétől = 20-50 = -30; új center = 100-30 = 70; x = 70-10=60
    expect(resizeWithConstraints(rect, old, bigger, { horizontal: 'center', vertical: 'start' }).x).toBe(60);
  });
});

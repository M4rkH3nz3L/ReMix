import { parseSvg } from '@/lib/svgImport';

/* eslint-disable @typescript-eslint/no-explicit-any */
const first = (svg: string) => parseSvg(svg).layers[0] as any;

describe('svgImport — doksi-méret / viewBox', () => {
  it('viewBox adja a méretet', () => {
    const r = parseSvg('<svg viewBox="0 0 320 240"><rect x="0" y="0" width="10" height="10"/></svg>');
    expect(r.width).toBe(320);
    expect(r.height).toBe(240);
  });

  it('width/height fallback viewBox nélkül', () => {
    const r = parseSvg('<svg width="200" height="150"><rect x="0" y="0" width="10" height="10"/></svg>');
    expect(r.width).toBe(200);
    expect(r.height).toBe(150);
  });
});

describe('svgImport — primitívek', () => {
  it('rect → rectangle réteg, doksi-normalizált doboz', () => {
    const l = first('<svg viewBox="0 0 100 100"><rect x="10" y="20" width="40" height="30" fill="#ff0000"/></svg>');
    expect(l.kind).toBe('shape');
    expect(l.shape).toBe('rectangle');
    expect(l.position).toEqual({ x: 0.3, y: 0.35 });
    expect(l.w).toBe(0.4);
    expect(l.h).toBe(0.3);
    expect(l.fill).toBe('#ff0000');
  });

  it('rect rx → cornerRadius', () => {
    const l = first('<svg viewBox="0 0 100 100"><rect x="0" y="0" width="40" height="40" rx="10"/></svg>');
    expect(l.cornerRadius).toBeCloseTo(0.25, 3);
  });

  it('circle → ellipse réteg', () => {
    const l = first('<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="25"/></svg>');
    expect(l.shape).toBe('ellipse');
    expect(l.position).toEqual({ x: 0.5, y: 0.5 });
    expect(l.w).toBe(0.5);
    expect(l.h).toBe(0.5);
  });

  it('ellipse rx/ry', () => {
    const l = first('<svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="40" ry="10"/></svg>');
    expect(l.shape).toBe('ellipse');
    expect(l.w).toBe(0.8);
    expect(l.h).toBe(0.2);
  });

  it('stroke → borderColor + borderWidth (a vászon-magasság %-a)', () => {
    const l = first('<svg viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50" fill="#fff" stroke="#0000ff" stroke-width="2"/></svg>');
    expect(l.borderColor).toBe('#0000ff');
    expect(l.borderWidth).toBe(2);
  });
});

describe('svgImport — path / polygon', () => {
  it('path → path réteg zárt kontúrral, saját dobozra normalizálva', () => {
    const l = first('<svg viewBox="0 0 100 100"><path d="M0 0 L100 0 L100 100 Z" fill="#00ff00"/></svg>');
    expect(l.shape).toBe('path');
    expect(l.closed).toBe(true);
    expect(l.points).toHaveLength(3);
    expect(l.points[0]).toEqual({ x: 0, y: 0 });
    expect(l.points[1]).toEqual({ x: 1, y: 0 });
    expect(l.points[2]).toEqual({ x: 1, y: 1 });
    expect(l.position).toEqual({ x: 0.5, y: 0.5 });
    expect(l.w).toBe(1);
    expect(l.h).toBe(1);
  });

  it('polygon → zárt path', () => {
    const l = first('<svg viewBox="0 0 100 100"><polygon points="0,0 100,0 50,100"/></svg>');
    expect(l.shape).toBe('path');
    expect(l.closed).toBe(true);
    expect(l.points).toHaveLength(3);
  });

  it('polyline → nyitott path', () => {
    const l = first('<svg viewBox="0 0 100 100"><polyline points="0,0 50,50 100,0"/></svg>');
    expect(l.shape).toBe('path');
    expect(l.closed).toBe(false);
  });

  it('nyitott stroke-path: a fill a stroke színét kapja + strokeWidth', () => {
    const l = first('<svg viewBox="0 0 100 100"><path d="M0 0 L100 100" fill="none" stroke="#123456" stroke-width="4"/></svg>');
    expect(l.shape).toBe('path');
    expect(l.fill).toBe('#123456');
    expect(l.strokeWidth).toBe(4);
    expect(l.borderColor).toBeUndefined();
  });
});

describe('svgImport — transzform', () => {
  it('csoport translate eltolja a pozíciót', () => {
    const l = first('<svg viewBox="0 0 100 100"><g transform="translate(10,10)"><rect x="0" y="0" width="20" height="20"/></g></svg>');
    expect(l.shape).toBe('rectangle');
    expect(l.position).toEqual({ x: 0.2, y: 0.2 });
    expect(l.w).toBe(0.2);
  });

  it('scale a méretet skálázza', () => {
    const l = first('<svg viewBox="0 0 100 100"><rect x="0" y="0" width="10" height="10" transform="scale(2)"/></svg>');
    expect(l.w).toBe(0.2);
    expect(l.h).toBe(0.2);
  });

  it('forgatott primitív path-tá válik', () => {
    const l = first('<svg viewBox="0 0 100 100"><rect x="40" y="40" width="20" height="20" transform="rotate(45 50 50)"/></svg>');
    expect(l.shape).toBe('path');
    // 45°-ra forgatva a bbox ~28.28 széles a vászonon → ~0.283
    expect(l.w).toBeCloseTo(0.283, 2);
  });

  it('öröklődő stílus a csoportból', () => {
    const l = first('<svg viewBox="0 0 100 100"><g fill="#abcdef"><rect x="0" y="0" width="10" height="10"/></g></svg>');
    expect(l.fill).toBe('#abcdef');
  });
});

describe('svgImport — gradiens', () => {
  it('linearGradient url(#) → ShapeGradient', () => {
    const svg =
      '<svg viewBox="0 0 100 100"><defs>' +
      '<linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/>' +
      '</linearGradient></defs>' +
      '<rect x="0" y="0" width="100" height="100" fill="url(#g1)"/></svg>';
    const l = first(svg);
    expect(l.gradient).toEqual({
      type: 'linear',
      angle: 0,
      stops: [
        { color: '#ffffff', at: 0 },
        { color: '#000000', at: 1 },
      ],
    });
  });

  it('radialGradient + %-offset', () => {
    const svg =
      '<svg viewBox="0 0 100 100"><defs>' +
      '<radialGradient id="r1"><stop offset="0%" stop-color="#f00"/><stop offset="100%" stop-color="#00f"/></radialGradient>' +
      '</defs><circle cx="50" cy="50" r="50" fill="url(#r1)"/></svg>';
    const l = first(svg);
    expect(l.gradient.type).toBe('radial');
    expect(l.gradient.stops).toEqual([
      { color: '#f00', at: 0 },
      { color: '#00f', at: 1 },
    ]);
  });
});

describe('svgImport — szöveg', () => {
  it('text → text réteg', () => {
    const l = first('<svg viewBox="0 0 100 100"><text x="10" y="50" font-size="20" font-weight="bold" fill="#333333">Szia</text></svg>');
    expect(l.kind).toBe('text');
    expect(l.text).toBe('Szia');
    expect(l.color).toBe('#333333');
    expect(l.fontWeight).toBe('bold');
    expect(l.fontSize).toBe(20);
    expect(l.position).toEqual({ x: 0.1, y: 0.5 });
  });
});

describe('svgImport — több elem / robusztusság', () => {
  it('több elem sorrendben, style="" felülír', () => {
    const svg =
      '<svg viewBox="0 0 100 100">' +
      '<rect x="0" y="0" width="10" height="10" fill="#111" style="fill:#222"/>' +
      '<circle cx="50" cy="50" r="10"/>' +
      '</svg>';
    const r = parseSvg(svg);
    expect(r.layers).toHaveLength(2);
    expect((r.layers[0] as any).fill).toBe('#222');
    expect((r.layers[1] as any).shape).toBe('ellipse');
  });

  it('üres / érvénytelen SVG → üres', () => {
    expect(parseSvg('').layers).toEqual([]);
    expect(parseSvg('<not-svg/>').layers).toEqual([]);
  });

  it('komment és self-closing tolerálása', () => {
    const r = parseSvg('<svg viewBox="0 0 100 100"><!-- c --><rect x="0" y="0" width="10" height="10"/></svg>');
    expect(r.layers).toHaveLength(1);
  });
});

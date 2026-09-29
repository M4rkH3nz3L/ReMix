import {
  addAdjustment,
  createAdjustment,
  duplicateAdjustment,
  flattenAdjustments,
  isNeutralAdjust,
  isNeutralStack,
  moveAdjustment,
  removeAdjustment,
  reorderAdjustment,
  resolvePipeline,
  scaleAdjust,
  setAmount,
  summarizeStack,
  toggleAdjustment,
  updateAdjustment,
  type AdjustmentLayer,
} from '@/lib/adjustmentStack';

const stackOf = (...layers: AdjustmentLayer[]) => layers;
const CURVE = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.9 },
  { x: 1, y: 1 },
];

describe('adjustmentStack — verem-műveletek', () => {
  it('createAdjustment alap: engedélyezve, teljes erő, névvel', () => {
    const a = createAdjustment('exposure', { exposure: 0.4 });
    expect(a.enabled).toBe(true);
    expect(a.amount).toBe(1);
    expect(a.name).toBe('Expozíció');
    expect(a.adjust).toEqual({ exposure: 0.4 });
    expect(a.id).toMatch(/^adj_/);
  });

  it('add / remove', () => {
    const a = createAdjustment('exposure');
    const b = createAdjustment('contrast');
    let s = addAdjustment([], a);
    s = addAdjustment(s, b);
    expect(s).toHaveLength(2);
    expect(s[1].id).toBe(b.id); // a tetőre
    s = removeAdjustment(s, a.id);
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe(b.id);
  });

  it('addAdjustment index', () => {
    const a = createAdjustment('exposure');
    const b = createAdjustment('contrast');
    const c = createAdjustment('vignette');
    const s = addAdjustment(addAdjustment([a], b), c, 1);
    expect(s.map((l) => l.kind)).toEqual(['exposure', 'vignette', 'contrast']);
  });

  it('reorder / move', () => {
    const a = createAdjustment('exposure');
    const b = createAdjustment('contrast');
    const c = createAdjustment('vignette');
    const s = [a, b, c];
    expect(reorderAdjustment(s, a.id, 1).map((l) => l.kind)).toEqual(['contrast', 'exposure', 'vignette']);
    expect(reorderAdjustment(s, c.id, -2).map((l) => l.kind)).toEqual(['vignette', 'exposure', 'contrast']);
    expect(moveAdjustment(s, a.id, 2).map((l) => l.kind)).toEqual(['contrast', 'vignette', 'exposure']);
    // tartomány-vágás
    expect(reorderAdjustment(s, a.id, -5)[0].id).toBe(a.id);
  });

  it('toggle / setAmount / update / duplicate', () => {
    const a = createAdjustment('exposure', { exposure: 0.4 });
    let s = [a];
    expect(toggleAdjustment(s, a.id)[0].enabled).toBe(false);
    expect(toggleAdjustment(s, a.id, true)[0].enabled).toBe(true);
    expect(setAmount(s, a.id, 2)[0].amount).toBe(1); // vágás 0..1
    expect(setAmount(s, a.id, -1)[0].amount).toBe(0);
    s = updateAdjustment(s, a.id, { adjust: { contrast: 0.2 }, name: 'X' });
    expect(s[0].adjust).toEqual({ exposure: 0.4, contrast: 0.2 });
    expect(s[0].name).toBe('X');
    const dup = duplicateAdjustment(s, a.id);
    expect(dup).toHaveLength(2);
    expect(dup[1].id).not.toBe(a.id);
    expect(dup[1].adjust).toEqual(s[0].adjust);
    expect(dup[1].adjust).not.toBe(s[0].adjust); // mély másolat
  });
});

describe('adjustmentStack — flatten kompozíció', () => {
  it('skalárok súlyozottan összeadódnak', () => {
    const s = stackOf(createAdjustment('exposure', { exposure: 0.5 }), createAdjustment('exposure', { exposure: 0.3 }));
    expect(flattenAdjustments(s)).toEqual({ exposure: 0.8 });
  });

  it('a tartományba vág', () => {
    const s = stackOf(createAdjustment('custom', { brightness: 0.2 }), createAdjustment('custom', { brightness: 0.2 }));
    expect(flattenAdjustments(s)).toEqual({ brightness: 0.3 }); // clamp -0.3..0.3
  });

  it('amount skálázza a hatást', () => {
    const one = [{ ...createAdjustment('exposure', { exposure: 0.4 }), amount: 0.5 }];
    expect(flattenAdjustments(one)).toEqual({ exposure: 0.2 });
  });

  it('disabled / amount=0 kimarad', () => {
    const a = { ...createAdjustment('exposure', { exposure: 0.5 }), enabled: false };
    const b = { ...createAdjustment('contrast', { contrast: 0.2 }), amount: 0 };
    expect(flattenAdjustments([a, b])).toEqual({});
  });

  it('3-way balance komponensenként összeadódik', () => {
    const a = createAdjustment('colorBalance', { balance: { sh: { r: 0.3 } } });
    const b = createAdjustment('colorBalance', { balance: { sh: { r: 0.2 }, hi: { b: 0.4 } } });
    expect(flattenAdjustments([a, b])).toEqual({ balance: { sh: { r: 0.5 }, hi: { b: 0.4 } } });
  });

  it('görbe: az utolsó engedélyezett nyer, amount-tal identitás felé', () => {
    const a = createAdjustment('curves', { curves: { rgb: CURVE } });
    const b = { ...createAdjustment('curves', { curves: { rgb: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] } }), amount: 0.5 };
    const out = flattenAdjustments([a, b]);
    // b nyer, amount 0.5: (0.5,0.7) → y = 0.5 + (0.7-0.5)*0.5 = 0.6
    expect(out.curves!.rgb).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }]);
  });

  it('identitás-görbe nem számít', () => {
    const a = createAdjustment('curves', { curves: { rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } });
    expect(flattenAdjustments([a])).toEqual({});
  });
});

describe('adjustmentStack — pipeline / scale / neutral', () => {
  it('resolvePipeline sorrendtartó, csak az aktívak', () => {
    const a = createAdjustment('exposure', { exposure: 0.4 });
    const b = { ...createAdjustment('contrast', { contrast: 0.2 }), enabled: false };
    const c = createAdjustment('vignette', { vignette: 0.5 });
    const p = resolvePipeline([a, b, c]);
    expect(p).toEqual([{ exposure: 0.4 }, { vignette: 0.5 }]);
  });

  it('scaleAdjust skalár·amt + tartomány', () => {
    expect(scaleAdjust({ exposure: 0.8, brightness: 0.3 }, 0.5)).toEqual({ exposure: 0.4, brightness: 0.15 });
    expect(scaleAdjust({ exposure: 0.8 }, 0)).toEqual({});
  });

  it('isNeutralAdjust', () => {
    expect(isNeutralAdjust({})).toBe(true);
    expect(isNeutralAdjust({ exposure: 0 })).toBe(true);
    expect(isNeutralAdjust({ exposure: 0.1 })).toBe(false);
    expect(isNeutralAdjust({ balance: { sh: { r: 0.1 } } })).toBe(false);
    expect(isNeutralAdjust({ curves: { rgb: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })).toBe(true);
  });

  it('isNeutralStack + summarizeStack', () => {
    const a = createAdjustment('exposure', { exposure: 0.4 });
    const b = { ...createAdjustment('contrast', { contrast: 0.2 }), enabled: false };
    const c = createAdjustment('vignette', {}); // üres → semleges
    expect(isNeutralStack([b, c])).toBe(true);
    expect(isNeutralStack([a])).toBe(false);
    const sum = summarizeStack([a, b, c]);
    expect(sum).toEqual({ total: 3, active: 1, kinds: ['exposure'] });
  });
});

import {
  applyBatchPatch,
  batchablePatch,
  describeStyle,
  duplicateOffset,
  extractStyle,
  styleTransferPatch,
} from '@/lib/batchEdit';
import type { Clip } from '@/types/project';

// 🧩 A több-kijelölés stílus-fanout (a store updateClip/pasteStyle/duplikálás
// magja) regressziós pajzsa: az ALLOWLIST szigorú — idő/geometria/identitás
// SOSEM másolódhat (különben a klipek egymásra csúsznának). Pure → tesztelhető.

// laza helper: a teszt a GENERIKUS fanout-mechanizmust nézi (bármely batchable
// kulcs), nem a valós FilterId-enumot → tetszőleges érték megengedett
const clip = (over: Record<string, unknown>): Clip =>
  ({ id: 'x', kind: 'video', start: 0, duration: 5, ...over } as unknown as Clip);

describe('batchablePatch — csak a stílus-mezők mennek át', () => {
  it('megtartja a kötegelhető mezőket, eldobja az idő/geometria/szöveg-mezőket', () => {
    const out = batchablePatch({
      filterId: 'vhs', opacity: 0.5, // batchable
      start: 3, duration: 2, position: { x: 0.1, y: 0.2 }, text: 'hi', // NEVER
    } as Partial<Clip>);
    expect(out).toEqual({ filterId: 'vhs', opacity: 0.5 });
  });

  it('csak nem-kötegelhető mezők → null', () => {
    expect(batchablePatch({ start: 1, duration: 2 } as Partial<Clip>)).toBeNull();
    expect(batchablePatch({})).toBeNull();
  });
});

describe('applyBatchPatch — csak az azonos fajtájú, kijelölt klipekre', () => {
  it('a kijelölt + azonos kind klipekre megy, a többi érintetlen; sorrend marad', () => {
    const clips: Clip[] = [
      clip({ id: 'a', kind: 'video' }),
      clip({ id: 'b', kind: 'video' }),
      clip({ id: 'c', kind: 'text' } as Partial<Clip>),
      clip({ id: 'd', kind: 'video' }),
    ];
    const ids = new Set(['a', 'b', 'c']); // c szöveg → kimarad (kind != video)
    const { clips: out, changed } = applyBatchPatch(clips, ids, { filterId: 'x' } as unknown as Partial<Clip>, 'video');
    expect(changed).toBe(2);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']); // sorrend
    expect((out[0] as { filterId?: string }).filterId).toBe('x');
    expect((out[1] as { filterId?: string }).filterId).toBe('x');
    expect((out[2] as { filterId?: string }).filterId).toBeUndefined(); // text — nem kapta
    expect((out[3] as { filterId?: string }).filterId).toBeUndefined(); // nincs a kijelölésben
  });
});

describe('extractStyle — csak a jelen lévő kötegelhető mezők', () => {
  it('a klipből a stílus-mezőket viszi, az idő/szöveg-mezőket nem', () => {
    const style = extractStyle(clip({ filterId: 'vhs', opacity: 0.7, start: 4, duration: 3 }));
    expect(style).toEqual({ filterId: 'vhs', opacity: 0.7 });
  });
});

describe('styleTransferPatch — „legyen PONTOSAN ilyen"', () => {
  it('a célon lévő, de a stílusban hiányzó kötegelhető mezőt explicit undefined-re állítja', () => {
    const patch = styleTransferPatch(
      { filterId: 'x' } as unknown as Partial<Clip>,
      clip({ filterId: 'y', opacity: 0.5 })
    );
    expect((patch as { filterId?: unknown }).filterId).toBe('x');
    expect('opacity' in patch).toBe(true);
    expect((patch as { opacity?: number }).opacity).toBeUndefined();
  });
});

describe('duplicateOffset — a másolatok a kijelölés UTÁN', () => {
  it('a kijelölés teljes szélessége (max vég − min kezdet)', () => {
    expect(duplicateOffset([clip({ start: 0, duration: 4 }), clip({ start: 4, duration: 4 })])).toBe(8);
    expect(duplicateOffset([clip({ start: 2, duration: 3 })])).toBe(3);
    expect(duplicateOffset([])).toBe(0);
  });
});

describe('describeStyle — ember-olvasható összefoglaló', () => {
  it('nem-üres stringet ad; üres stílusnál a basic-look fallback', () => {
    expect(typeof describeStyle({ filterId: 'vhs' } as unknown as Partial<Clip>)).toBe('string');
    expect(describeStyle({}).length).toBeGreaterThan(0);
  });
});

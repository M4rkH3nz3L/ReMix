import { TEXT_TEMPLATES } from '@/constants/textTemplates';
import {
  kineticStaggerDefault,
  mergeTextStyle,
  signedPercent,
  templatePatch,
  trackSegmentEnd,
} from '@/lib/textPanelOps';

describe('textPanelOps — sablon és szöveg-stílus', () => {
  it('a sablon minden look-mezőt explicit átír, a hiányzókat alapértékre nullázza', () => {
    const patch = templatePatch({ id: 'x', label: 'x', fields: { fontSize: 7, color: '#fff', position: { x: 0.5, y: 0.2 } } });
    expect(patch).toEqual({
      fontFamily: undefined,
      fontSize: 7,
      fontWeight: 'bold',
      color: '#fff',
      backgroundColor: null,
      stylePreset: 'plain',
      animation: 'none',
      text3d: undefined,
      position: { x: 0.5, y: 0.2 },
    });
    // a kulcsok akkor is jelen vannak, ha undefined értékűek (így törlik a régi stílust)
    expect(Object.keys(patch)).toHaveLength(9);
  });

  it('a megadott sablon-mezők változatlanul mennek át (a pozíció ugyanaz az objektum)', () => {
    const tpl = TEXT_TEMPLATES[0];
    const patch = templatePatch(tpl);
    expect(patch.fontSize).toBe(tpl.fields.fontSize);
    expect(patch.position).toBe(tpl.fields.position);
    expect(patch.fontWeight).toBe(tpl.fields.fontWeight ?? 'bold');
  });

  it('a stílus-patch ráfésül, az undefined mezőket törli, üresen undefined', () => {
    const glow = { color: '#fff', size: 0.4 };
    expect(mergeTextStyle({ glow }, { stroke: { color: '#000', width: 0.04 } })).toEqual({ glow, stroke: { color: '#000', width: 0.04 } });
    const off = mergeTextStyle({ glow }, { glow: undefined });
    expect(off).toBeUndefined();
    const partial = mergeTextStyle({ glow, stroke: { color: '#000', width: 0.04 } }, { glow: undefined });
    expect(partial).toEqual({ stroke: { color: '#000', width: 0.04 } });
    expect(Object.keys(partial!)).toEqual(['stroke']);
  });

  it('a bemenő stílust nem módosítja', () => {
    const ts = { glow: { color: '#fff', size: 0.4 } };
    mergeTextStyle(ts, { glow: undefined });
    expect(ts).toEqual({ glow: { color: '#fff', size: 0.4 } });
  });
});

describe('textPanelOps — kijelzés és követés', () => {
  it('előjeles százalék: pozitívnál „+", nullánál és negatívnál nincs', () => {
    expect(signedPercent(0.04)).toBe('+4');
    expect(signedPercent(0)).toBe('0');
    expect(signedPercent(-0.1)).toBe('-10');
    expect(signedPercent(0.004)).toBe('+0');
    expect(signedPercent(-0.004)).toBe('0');
  });

  it('a kinetikus lépésköz alapértéke bontásonként: betű 30, szó 80, egyéb 140 ms', () => {
    expect(kineticStaggerDefault('char')).toBe(0.03);
    expect(kineticStaggerDefault('word')).toBe(0.08);
    expect(kineticStaggerDefault('line')).toBe(0.14);
    expect(kineticStaggerDefault(undefined)).toBe(0.14);
  });

  it('a követési szakasz a szöveg vége, a videó vége és playhead+15 közül a legkorábbi', () => {
    expect(trackSegmentEnd({ start: 2, duration: 6 }, { start: 0, duration: 20 }, 3)).toBe(8);
    expect(trackSegmentEnd({ start: 2, duration: 60 }, { start: 0, duration: 40 }, 3)).toBe(18);
    expect(trackSegmentEnd({ start: 2, duration: 60 }, { start: 0, duration: 5 }, 3)).toBe(5);
  });
});

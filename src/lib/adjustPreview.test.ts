import { adjustTintLayers } from '@/lib/adjustPreview';
import type { ClipAdjust } from '@/types/project';

// 🎨 Képjavítás-ELŐNÉZET (ClipAdjust → féligátlátszó tint-rétegek; a preview ÉS
// a Kép Stúdió közös közelítése) pure pajzsa.

const adj = (o: Partial<ClipAdjust>): ClipAdjust => o as ClipAdjust;

describe('adjustTintLayers', () => {
  it('üres korrekció → nincs réteg', () => {
    expect(adjustTintLayers(adj({}))).toEqual([]);
  });

  it('világosítás → fehér, sötétítés → fekete tint', () => {
    expect(adjustTintLayers(adj({ brightness: 0.3 }))[0].color).toBe('#ffffff');
    expect(adjustTintLayers(adj({ brightness: -0.3 }))[0].color).toBe('#000000');
  });

  it('meleg/hideg hőmérséklet → narancs/kék tint', () => {
    expect(adjustTintLayers(adj({ temperature: 0.4 }))[0].color).toBe('#ff9d4d');
    expect(adjustTintLayers(adj({ temperature: -0.4 }))[0].color).toBe('#4d9dff');
  });

  it('deszaturáció (saturation<0) → szürke tint; saturation>0 önmagában → nincs', () => {
    expect(adjustTintLayers(adj({ saturation: -0.5 }))[0].color).toBe('#808080');
    expect(adjustTintLayers(adj({ saturation: 0.5 }))).toEqual([]);
  });

  it('az opacitás 0.6-ra van sapkázva (túlvezérlés ellen)', () => {
    expect(adjustTintLayers(adj({ brightness: 10 }))[0].opacity).toBe(0.6);
  });

  it('3-way color balance → nettó szín-tint, ha a magnitúdó érdemi', () => {
    const layers = adjustTintLayers(adj({ balance: { mid: { r: 0.5, g: 0, b: 0 } } } as Partial<ClipAdjust>));
    expect(layers.length).toBeGreaterThan(0);
    expect(layers[layers.length - 1].color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

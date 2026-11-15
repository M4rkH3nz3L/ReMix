import { applyCommand } from '@/lib/commands';
import { docMediaUris } from '@/lib/imageDoc';
import { createEmptyProject } from '@/lib/projectUtils';
import { fontDisplayName, fontFamilyKey, isFontHeader, projectFontOf, withoutProjectFont, withProjectFont } from '@/lib/projectFonts';
import type { ImageDoc } from '@/types/project';

describe('🔤 S10: a projekt saját betűtípusai', () => {
  it('a családnév egyedi és CSS-biztos (u_ + betű/szám), a felületi név a fájlnévből', () => {
    const k = fontFamilyKey('Árvíztűrő Sans-Bold.ttf', 'abc123xyz789');
    expect(k).toMatch(/^u_[A-Za-z0-9_]+$/);
    expect(k).toBe('u_ArvizturoSansBold_abc123xyz7');
    expect(fontFamilyKey("x'); } body{", 'k')).toMatch(/^u_[A-Za-z0-9_]+$/);
    expect(fontDisplayName('My_Font-Regular.otf')).toBe('My Font Regular');
  });

  it('TTF / OTF fejléc felismerése (a tartalom dönt, nem a kiterjesztés)', () => {
    expect(isFontHeader([0, 1, 0, 0])).toBe(true);
    expect(isFontHeader([0x4f, 0x54, 0x54, 0x4f])).toBe(true); // OTTO
    expect(isFontHeader([0x89, 0x50, 0x4e, 0x47])).toBe(false); // PNG
    expect(isFontHeader([0, 1])).toBe(false);
  });

  it('a lista: nem duplázódik, név szerint rendezett, eltávolítható', () => {
    const a = { family: 'u_A_1', name: 'Zeta', uri: 'file:///a.ttf' };
    const b = { family: 'u_B_2', name: 'Alfa', uri: 'file:///b.ttf' };
    const list = withProjectFont(withProjectFont(withProjectFont(undefined, a), b), a);
    expect(list.map((f) => f.name)).toEqual(['Alfa', 'Zeta']);
    expect(projectFontOf(list, 'u_A_1')?.uri).toBe('file:///a.ttf');
    expect(projectFontOf(list, 'Poppins')).toBeNull();
    expect(withoutProjectFont(list, 'u_A_1')).toEqual([b]);
  });

  it('a parancs a projekt fontjait írja (egy lépés), az üres lista leveszi a mezőt', () => {
    const p = createEmptyProject('k', '1:1', undefined, 'image');
    const font = { family: 'u_X_1', name: 'X', uri: 'file:///x.ttf' };
    const withFont = applyCommand(p, { type: 'SET_PROJECT_FONTS', fonts: [font] })!;
    expect(withFont.fonts).toEqual([font]);
    expect(applyCommand(withFont, { type: 'SET_PROJECT_FONTS', fonts: [font] })).toBeNull();
    expect(applyCommand(withFont, { type: 'SET_PROJECT_FONTS', fonts: [] })!.fonts).toBeUndefined();
  });

  it('a render-másolat szöveg-rétegének fontja feltöltendő média', () => {
    const doc = { id: 'd', name: 'd', aspectRatio: '1:1', layers: [{ id: 't', kind: 'text', text: 'A', fontUri: 'file:///f.ttf' }] } as unknown as ImageDoc;
    expect(docMediaUris(doc)).toEqual(['file:///f.ttf']);
  });
});

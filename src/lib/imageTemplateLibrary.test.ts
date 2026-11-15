import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import hu from '@/i18n/locales/hu.json';
import { updateLayer } from '@/lib/imageDoc';
import { categoryForSize, docFromTemplate, IMAGE_TEMPLATES, TEMPLATE_CATEGORIES, templateFromDoc, templatesIn } from '@/lib/imageTemplates';
import type { ImageDoc, PhotoLayer } from '@/types/project';

let n = 0;
const id = () => `x${++n}`;

describe('🧩 S9: sablon-könyvtár', () => {
  it('legalább 24 beépített sablon, mind a 7 kategóriában legalább 3, egyedi kulcsokkal', () => {
    expect(IMAGE_TEMPLATES.length).toBeGreaterThanOrEqual(24);
    expect(new Set(IMAGE_TEMPLATES.map((t) => t.key)).size).toBe(IMAGE_TEMPLATES.length);
    for (const c of TEMPLATE_CATEGORIES) expect(templatesIn(c).length).toBeGreaterThanOrEqual(3);
    expect(templatesIn('all')).toHaveLength(IMAGE_TEMPLATES.length);
  });

  it('minden sablonnak és kategóriának van neve mindhárom nyelven', () => {
    for (const dict of [hu, en, de]) {
      const tp = dict.studio.image.templates as Record<string, unknown> & { cat: Record<string, string> };
      for (const t of IMAGE_TEMPLATES) expect(tp[t.key]).toBeTruthy();
      for (const c of [...TEMPLATE_CATEGORIES, 'all']) expect(tp.cat[c]).toBeTruthy();
    }
  });

  it('a helyőrzős sablonból a lap helyőrzőt kap; kitöltve a kép a helyén és méretében marad (cover)', () => {
    const tpl = IMAGE_TEMPLATES.find((t) => t.key === 'postPhoto')!;
    const doc = docFromTemplate(tpl, 'P', id);
    const ph = doc.layers.find((l) => l.kind === 'photo') as PhotoLayer;
    expect(ph.placeholder).toBe(true);
    const filled = updateLayer<PhotoLayer>(doc, ph.id, { uri: 'file:///kep.jpg', placeholder: undefined, fit: 'cover' });
    const after = filled.layers.find((l) => l.id === ph.id) as PhotoLayer;
    expect(after).toMatchObject({ uri: 'file:///kep.jpg', position: ph.position, w: ph.w, h: ph.h, fit: 'cover' });
    expect(after.placeholder).toBeUndefined();
    expect(filled.layers.map((l) => l.kind)).toEqual(doc.layers.map((l) => l.kind));
  });

  it('saját sablon egy lapból: a fotóból helyőrző, a többi réteg megmarad, a háttér a lap saját rétege', () => {
    const doc = {
      id: 'd',
      name: 'Saját',
      aspectRatio: '16:9',
      width: 1280,
      height: 720,
      layers: [
        { id: 'f', kind: 'fill', fill: '#123456' },
        { id: 'p', kind: 'photo', uri: 'file:///a.jpg', position: { x: 0.3, y: 0.4 }, w: 0.5, h: 0.6, develop: { base: {}, detail: {} } },
        { id: 't', kind: 'text', text: 'Cím', position: { x: 0.5, y: 0.8 }, fontSize: 10, color: '#fff' },
      ],
    } as unknown as ImageDoc;
    const tpl = templateFromDoc(doc, 'tpl1', 'Saját');
    expect(tpl).toMatchObject({ key: 'tpl1', name: 'Saját', category: 'thumbnail', width: 1280, height: 720, background: 'transparent', custom: true });
    expect(tpl.layers.map((l) => l.kind)).toEqual(['fill', 'photo', 'text']);
    expect(tpl.layers[1]).toEqual({ kind: 'photo', uri: '', placeholder: true, position: { x: 0.3, y: 0.4 }, w: 0.5, h: 0.6, fit: 'cover' });
    expect(JSON.stringify(tpl)).not.toContain('a.jpg');
    // visszatöltve: nincs dupla háttér, friss azonosítók
    const again = docFromTemplate(tpl, 'Új', id);
    expect(again.layers.filter((l) => l.kind === 'fill')).toHaveLength(1);
    expect(again.layers.some((l) => l.id === 'p' || l.id === 't')).toBe(false);
    // a saját sablon a kategóriájában elöl
    expect(templatesIn('thumbnail', [tpl])[0].key).toBe('tpl1');
  });

  it('a lap méretéből a kategória', () => {
    expect(categoryForSize(1500, 500)).toBe('banner');
    expect(categoryForSize(1280, 720)).toBe('thumbnail');
    expect(categoryForSize(1080, 1920)).toBe('story');
    expect(categoryForSize(1240, 1754)).toBe('poster');
    expect(categoryForSize(1080, 1350)).toBe('invite');
    expect(categoryForSize(1080, 1080)).toBe('post');
  });
});

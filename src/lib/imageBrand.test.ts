import {
  addBrandColor,
  applyBrand,
  contrast,
  isNeutral,
  MAX_BRAND_COLORS,
  removeBrandColor,
} from '@/lib/imageBrand';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import type { ImageDoc, ShapeLayer, TextLayer } from '@/types/project';

const template = (key: string, brand?: Parameters<typeof applyBrand>[1]): ImageDoc => {
  let n = 0;
  return docFromTemplate(IMAGE_TEMPLATES.find((t) => t.key === key)!, key, () => `b${++n}`, brand);
};
const texts = (d: ImageDoc) => d.layers.filter((l): l is TextLayer => l.kind === 'text');

describe('márka-színek listája', () => {
  it('az új szín előre kerül, nincs duplikátum, kisbetűs', () => {
    const s = addBrandColor(addBrandColor({ colors: [] }, '#AABBCC'), '#112233');
    expect(addBrandColor(s, '#aabbcc').colors).toEqual(['#aabbcc', '#112233']);
  });

  it('a limit fölött a legrégebbi esik ki', () => {
    let s = { colors: [] as string[] };
    for (let i = 0; i < MAX_BRAND_COLORS + 2; i++) {
      s = addBrandColor(s, `#0000${i}${i}`);
    }
    expect(s.colors).toHaveLength(MAX_BRAND_COLORS);
    expect(s.colors).not.toContain('#000000');
  });

  it('törlés', () => {
    expect(removeBrandColor({ colors: ['#111111', '#222222'] }, '#111111').colors).toEqual(['#222222']);
  });
});

describe('applyBrand', () => {
  it('üres márkával a sablon érintetlen', () => {
    expect(template('story', { colors: [] }).layers.map(({ id: _id, ...l }) => l)).toEqual(
      template('story').layers.map(({ id: _id, ...l }) => l)
    );
  });

  it('a semleges színek maradnak, a színesek márka-színt kapnak', () => {
    expect(isNeutral('#101018')).toBe(true);
    expect(isNeutral('#ff2d55')).toBe(false);
    const doc = template('youtubeThumb', { colors: ['#00b894'] });
    expect(doc.layers[0]).toMatchObject({ kind: 'fill', fill: '#101018' });
    expect((doc.layers[1] as ShapeLayer).fill).toBe('#00b894');
  });

  it('a különböző színes elemek sorban kapják a márka-színeket', () => {
    const doc = template('story', { colors: ['#0a7d3e', '#ffd166'] });
    expect(doc.layers[0]).toMatchObject({ fill: '#0a7d3e' });
    expect(texts(doc).some((l) => l.color === '#ffd166')).toBe(true);
  });

  it('a márka-font minden szövegre rákerül', () => {
    const doc = template('banner', { colors: [], fontFamily: 'Bungee' });
    expect(texts(doc).length).toBeGreaterThan(0);
    expect(texts(doc).every((l) => l.fontFamily === 'Bungee')).toBe(true);
  });

  it.each(IMAGE_TEMPLATES.map((t) => t.key))('%s: világos márka-háttéren is olvasható a szöveg', (key) => {
    const doc = template(key, { colors: ['#ffd166', '#fff3b0'] });
    for (const l of texts(doc)) {
      const i = doc.layers.indexOf(l);
      const below = doc.layers.slice(0, i).reverse().find((b) => {
        if (b.kind === 'fill') {
          return true;
        }
        const s = b as ShapeLayer;
        return b.kind === 'shape' && Math.abs(l.position.x - s.position.x) <= s.w / 2 && Math.abs(l.position.y - s.position.y) <= s.h / 2;
      }) as ShapeLayer;
      expect(contrast(l.color, below.fill)).toBeGreaterThanOrEqual(3);
    }
  });

  it('a kontraszt-védelem tényleg változtat: fehér szöveg sárga háttéren feketére vált', () => {
    const doc = template('story', { colors: ['#ffd166'] });
    expect(texts(doc).some((l) => l.color === '#000000')).toBe(true);
  });
});

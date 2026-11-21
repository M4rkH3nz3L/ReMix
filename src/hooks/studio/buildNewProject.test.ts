import { BG_SWATCHES } from '@/lib/canvasPresets';
import { IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { buildNewProject, type NewProjectForm } from '@/hooks/studio/buildNewProject';

/** 🏗️ Az „Új projekt” űrlapból épített induló projekt (REFACTOR: a useStudio.ts `create`-jéből) — a mai viselkedés rögzítve. */

const t = ((k: string) => `T(${k})`) as never;
const form = (over: Partial<NewProjectForm> = {}): NewProjectForm => ({
  name: 'Projekt',
  seoDescription: '',
  seoHashtags: '',
  seoKeywords: '',
  aspect: '9:16',
  kind: 'video',
  designTemplate: IMAGE_TEMPLATES[0].key,
  imgW: '1080',
  imgH: '1080',
  imgFormat: 'raster',
  bg: BG_SWATCHES[0],
  audioTarget: 'music',
  model3dFormat: 'glb' as NewProjectForm['model3dFormat'],
  audioTemplate: 'blank',
  sources: [],
  ...over,
});

describe('buildNewProject', () => {
  it('név nélkül (csak szóköz) nincs projekt', () => {
    expect(buildNewProject(form({ name: '   ' }), t)).toBeNull();
  });

  it('videó: a trimmelt név a projekt neve ÉS a SEO-cím; a SEO-mezők feldolgozva; a választott arány marad', () => {
    const p = buildNewProject(
      form({ name: '  Első  ', seoDescription: ' leírás ', seoHashtags: '#a b', seoKeywords: 'x, y', aspect: '16:9' }),
      t
    )!;
    expect(p.name).toBe('Első');
    expect(p.kind).toBe('video');
    expect(p.aspectRatio).toBe('16:9');
    expect(p.seo).toMatchObject({ title: 'Első', description: 'leírás' });
    expect(p.seo?.hashtags.length).toBeGreaterThan(0);
    expect(p.seo?.keywords).toEqual(['x', 'y']);
    expect('assets' in p && p.assets?.length).toBeFalsy();
  });

  it('a források a projekt assetjei lesznek (ugyanaz a tömb)', () => {
    const sources = [{ id: 'a1' }] as unknown as NewProjectForm['sources'];
    expect(buildNewProject(form({ sources }), t)!.assets).toBe(sources);
  });

  it('kép: a W×H a vászon mérete (clamp-elve), az arány a legközelebbi enum, a formátum és a háttér átkerül', () => {
    const p = buildNewProject(form({ kind: 'image', imgW: '1920', imgH: '1080', imgFormat: 'vector', bg: '#abcdef' }), t)!;
    expect(p.aspectRatio).toBe('16:9');
    expect(p.imageDocs?.[0]).toMatchObject({ width: 1920, height: 1080, format: 'vector' });
    expect(p.imageDocs?.[0].layers).toEqual([expect.objectContaining({ kind: 'fill', fill: '#abcdef' })]);
  });

  it('kép háttér: érvénytelen hex → az alap sötét kitöltés', () => {
    const layers = buildNewProject(form({ kind: 'image', bg: 'zzz' }), t)!.imageDocs?.[0].layers;
    expect(layers).toEqual([expect.objectContaining({ kind: 'fill', fill: BG_SWATCHES[0] })]);
  });

  it('kép háttér: átlátszó → nincs kitöltő réteg', () => {
    expect(buildNewProject(form({ kind: 'image', bg: 'transparent' }), t)!.imageDocs?.[0].layers).toEqual([]);
  });

  it('kép: a túl nagy / nem szám méret a vászon-határra szorul', () => {
    const doc = buildNewProject(form({ kind: 'image', imgW: '999999', imgH: 'abc' }), t)!.imageDocs?.[0];
    expect(doc?.width).toBeGreaterThan(1080);
    expect(doc?.height).toBeGreaterThan(0);
    expect(doc?.height).toBeLessThan(1080);
  });

  it('design: ismeretlen sablon-kulcs → az első sablon vászna, egy lap (a sablon-lap felülírja a config „vector” formátumát)', () => {
    const tpl = IMAGE_TEMPLATES[0];
    const p = buildNewProject(form({ kind: 'design', designTemplate: 'nincs-ilyen' }), t)!;
    expect(p.imageDocs).toHaveLength(1);
    expect(p.imageDocs?.[0]).toMatchObject({ width: tpl.width, height: tpl.height });
    expect(p.imageDocs?.[0].format).toBeUndefined();
  });

  it('hang: a master-cél átkerül; podcast-sablonnal elindul a munkafolyamat', () => {
    const plain = buildNewProject(form({ kind: 'audio', audioTarget: 'podcast' }), t)!;
    expect(plain.audioMaster?.target).toBe('podcast');
    expect(plain.workflowRun).toBeUndefined();
    const pod = buildNewProject(form({ kind: 'audio', audioTemplate: 'podcast' }), t)!;
    expect(pod.workflowRun).toBeDefined();
  });

  it('zene „blank” sablonnal → a Zene-sablon szakasz-jelölői (a t() címkéivel)', () => {
    const p = buildNewProject(form({ kind: 'music' }), t)!;
    expect(p.markers?.map((m) => m.label)).toEqual([
      'T(studio.audio.template.intro)',
      'T(studio.audio.template.verse)',
      'T(studio.audio.template.chorus)',
      'T(studio.audio.template.outro)',
    ]);
    expect(p.workflowRun).toBeUndefined();
  });

  it('modell3d: a tárolási formátum a projekt-konfigba kerül', () => {
    const p = buildNewProject(form({ kind: 'model3d', model3dFormat: 'usdz' as NewProjectForm['model3dFormat'] }), t)!;
    expect(JSON.stringify(p)).toContain('usdz');
  });
});

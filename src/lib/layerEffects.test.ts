import {
  addEffect,
  createEffect,
  effectsToCssFilter,
  effectsToSvgFilter,
  effectsToTextShadow,
  hasEffects,
  removeEffect,
  reorderEffect,
  toggleEffect,
  toShapePrimitives,
  updateEffect,
  type LayerEffect,
} from '@/lib/layerEffects';

describe('layerEffects — verem-műveletek', () => {
  it('createEffect kind-specifikus alapok', () => {
    const d = createEffect('dropShadow');
    expect(d.kind).toBe('dropShadow');
    expect(d.enabled).toBe(true);
    expect(d).toMatchObject({ color: '#000000', dx: 0.6, dy: 0.6, blur: 1, opacity: 0.5 });
    expect(createEffect('stroke').position).toBe('outside');
    expect(createEffect('outerGlow', { color: '#ff0000' }).color).toBe('#ff0000');
  });

  it('add / remove / reorder / toggle / update', () => {
    const a = createEffect('dropShadow');
    const b = createEffect('stroke');
    let s = addEffect(addEffect([], a), b);
    expect(s).toHaveLength(2);
    expect(reorderEffect(s, b.id, -1).map((f) => f.id)).toEqual([b.id, a.id]);
    s = toggleEffect(s, a.id);
    expect(s[0].enabled).toBe(false);
    s = updateEffect(s, a.id, { color: '#123456' } as Partial<LayerEffect>);
    expect((s[0] as { color: string }).color).toBe('#123456');
    expect(s[0].kind).toBe('dropShadow'); // kind megmarad
    s = removeEffect(s, a.id);
    expect(s).toHaveLength(1);
    expect(hasEffects(s)).toBe(true);
  });
});

describe('layerEffects — CSS előnézet', () => {
  it('dropShadow → drop-shadow() px-ben', () => {
    const css = effectsToCssFilter([createEffect('dropShadow')], 1000);
    expect(css).toBe('drop-shadow(6px 6px 10px rgba(0, 0, 0, 0.5))');
  });

  it('outerGlow → ismételt, eltolás nélküli drop-shadow', () => {
    const css = effectsToCssFilter([createEffect('outerGlow', { color: '#ffffff', blur: 1.5, opacity: 0.75 })], 1000);
    expect(css).toBe(
      'drop-shadow(0 0 15px rgba(255, 255, 255, 0.75)) drop-shadow(0 0 15px rgba(255, 255, 255, 0.75))'
    );
  });

  it('rövidített hex (#f00) is feloldódik', () => {
    const css = effectsToCssFilter([createEffect('dropShadow', { color: '#f00', dx: 0, dy: 0, blur: 0, opacity: 1 })], 1000);
    expect(css).toBe('drop-shadow(0px 0px 0px rgba(255, 0, 0, 1))');
  });

  it('text-shadow lista', () => {
    const ts = effectsToTextShadow([createEffect('dropShadow', { dx: 0.2, dy: 0.2, blur: 0.4, opacity: 1, color: '#000000' })], 1000);
    expect(ts).toBe('2px 2px 4px rgba(0, 0, 0, 1)');
  });

  it('kikapcsolt effekt kimarad', () => {
    const d = { ...createEffect('dropShadow'), enabled: false };
    expect(effectsToCssFilter([d])).toBe('');
  });
});

describe('layerEffects — SVG filter', () => {
  it('drop-shadow filter: blur+offset+flood+composite, forrás mögé', () => {
    const svg = effectsToSvgFilter([createEffect('dropShadow')], 'e1', 1000);
    expect(svg).toContain('<filter id="e1"');
    expect(svg).toContain('feGaussianBlur');
    expect(svg).toContain('feOffset');
    expect(svg).toContain('operator="in"');
    // a merge sorrendben az árnyék a SourceGraphic ELŐTT van
    expect(svg.indexOf('in="fx0"')).toBeLessThan(svg.indexOf('in="SourceGraphic"'));
  });

  it('inner shadow: operator="out" (a sziluetten belül), forrás fölé', () => {
    const svg = effectsToSvgFilter([createEffect('innerShadow')], 'e2', 1000);
    expect(svg).toContain('operator="out"');
    expect(svg.indexOf('in="SourceGraphic"')).toBeLessThan(svg.lastIndexOf('in="fx0"'));
  });

  it('stroke: feMorphology (kívül=dilate, belül=erode)', () => {
    expect(effectsToSvgFilter([createEffect('stroke', { position: 'outside', width: 0.5 })], 'e3')).toContain('operator="dilate"');
    expect(effectsToSvgFilter([createEffect('stroke', { position: 'inside', width: 0.5 })], 'e4')).toContain('operator="erode"');
  });

  it('colorOverlay: feFlood + composite in', () => {
    const svg = effectsToSvgFilter([createEffect('colorOverlay', { color: '#00ff00', opacity: 0.8 })], 'e5');
    expect(svg).toContain('flood-color="#00ff00"');
    expect(svg).toContain('flood-opacity="0.8"');
  });

  it('több effekt egyedi result-id-t kap', () => {
    const svg = effectsToSvgFilter([createEffect('dropShadow'), createEffect('outerGlow')], 'e6');
    expect(svg).toContain('result="fx0"');
    expect(svg).toContain('result="fx1"');
  });
});

describe('layerEffects — le-map ShapeClip primitívekre', () => {
  it('első shadow/glow/stroke → shadow/glow/outline', () => {
    const stack = [
      createEffect('dropShadow'),
      createEffect('outerGlow', { color: '#ff00ff', blur: 2 }),
      createEffect('stroke', { color: '#00ff00', width: 1 }),
    ];
    expect(toShapePrimitives(stack)).toEqual({
      shadow: true,
      glow: { color: '#ff00ff', size: 2 },
      outline: { color: '#00ff00', width: 1 },
    });
  });

  it('kikapcsolt nem map-elődik', () => {
    const stack = [{ ...createEffect('dropShadow'), enabled: false }];
    expect(toShapePrimitives(stack)).toEqual({});
  });
});

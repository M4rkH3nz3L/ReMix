/**
 * 🎛️ A réteg-inspektor szerkesztési útjai valódi komponensen: melyik vezérlő milyen címkével
 * commitol, mikor hívja a szülőt (korrekció-lap, lasszó), és a saját font importja egy
 * visszavonható köteg. A REFACTOR (szekciók az inspector/ alatt) előtti viselkedést rögzíti.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { LayerInspector } from '@/components/studio/image/LayerInspector';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, ImageLayer } from '@/types/project';

// a vezérlők itt csak a propjaikat hordozzák (a valódiak Reanimated/Skia-alapúak)
jest.mock('@/components/ui/controls', () => ({ Chip: Object.assign(() => null, { mockName: 'Chip' }) }));
jest.mock('@/components/studio/audio/primitives', () => ({
  Slider: Object.assign(() => null, { mockName: 'Slider' }),
  ToggleRow: Object.assign(() => null, { mockName: 'ToggleRow' }),
}));
jest.mock('@/components/studio/image/ColorField', () => ({ ColorField: Object.assign(() => null, { mockName: 'ColorField' }) }));
jest.mock('@/components/studio/image/GradientEditor', () => ({ GradientEditor: Object.assign(() => null, { mockName: 'GradientEditor' }) }));
jest.mock('@/components/studio/image/GeometryFields', () => ({ GeometryFields: Object.assign(() => null, { mockName: 'GeometryFields' }) }));
jest.mock('@/lib/projectFontsClient', () => ({
  loadProjectFonts: async () => {},
  pickAndImportFont: async () => ({ ok: true, font: { family: 'Imp', name: 'Imp', uri: 'file:///imp.ttf' } }),
}));
jest.mock('@/lib/media', () => ({ pickCubeLut: async () => ({ uri: 'file:///new.cube', name: 'New.cube' }) }));
jest.mock('@/lib/id', () => ({ makeId: (p: string) => `${p}_1` }));

type Node = ReactTestRenderer['root'];

const doc = (layers: unknown[]) =>
  ({ id: 'd1', name: 'D', aspectRatio: '1:1', layers, groups: [{ id: 'g1', name: 'Mappa A' }] }) as unknown as ImageDoc;
const base = { kind: 'shape', id: 'base', shape: 'rectangle', x: 0.5, y: 0.5, w: 0.4, h: 0.4, fill: '#ff0000' };

async function mount(d: ImageDoc, layerId: string, withDraw = true) {
  const commits: [ImageDoc, string | undefined][] = [];
  const parent: string[] = [];
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(
      <LayerInspector
        doc={d}
        layer={d.layers.find((l) => l.id === layerId) as ImageLayer}
        commit={(next, label) => commits.push([next, label])}
        onOpenAdjust={() => parent.push('adjust')}
        onDrawMask={withDraw ? (id, target) => parent.push(`${id}:${target}`) : undefined}
      />
    );
  });
  const of = (mock: string) => view.root.findAll((n: Node) => (n.type as { mockName?: string }).mockName === mock);
  const byLabel = (mock: string, label: string) => {
    const hit = of(mock).filter((n: Node) => n.props.label === label);
    expect(hit).toHaveLength(1);
    return hit[0];
  };
  const layerOf = (i: number) => commits[i][0].layers.find((l) => l.id === layerId) as unknown as Record<string, unknown>;
  return { view, commits, parent, of, byLabel, layerOf };
}

describe('LayerInspector — szerkesztési utak', () => {
  it('átnevezés: a vágott név commitol undo-címkével, az üres törli, a változatlan nem commitol', async () => {
    const m = await mount(doc([{ kind: 'fill', id: 'f1', fill: '#111111', name: 'Háttér' }]), 'f1');
    const input = m.view.root.find((n: Node) => n.props.accessibilityLabel === 'studio.image.layerName' && typeof n.props.onEndEditing === 'function');
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: ' Új ' } }));
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: '   ' } }));
    await act(async () => input.props.onEndEditing({ nativeEvent: { text: 'Háttér' } }));
    expect(m.commits.map(([, l]) => l)).toEqual(['studio.image.undoRename', 'studio.image.undoRename']);
    expect(m.layerOf(0).name).toBe('Új');
    expect(m.layerOf(1).name).toBeUndefined();
  });

  it('a fill-réteg: csak szín + színátmenet + a közös rész — maszk és effektek nélkül', async () => {
    const m = await mount(doc([{ kind: 'fill', id: 'f1', fill: '#111111' }]), 'f1');
    expect(m.of('GeometryFields')).toHaveLength(0);
    expect(m.of('ColorField').map((n: Node) => n.props.label)).toEqual(['studio.image.fill']);
    expect(m.of('GradientEditor')).toHaveLength(1);
    expect(m.of('Slider').map((n: Node) => n.props.label)).toEqual(['studio.image.opacity']);
    const chips = m.of('Chip').map((n: Node) => n.props.label);
    expect(chips).not.toContain('Ellipszis');
    expect(chips).not.toContain('Vetett árnyék');
    expect(chips.slice(-5)).toEqual(['none', 'left', 'right', 'up', 'down']);
  });

  it('szöveg: a tartalom és a font címkézett commit, a saját font importja EGY köteg (fontlista + dokumentum)', async () => {
    const applyBatch = jest.fn();
    const d = doc([{ kind: 'text', id: 't1', text: 'Hi', x: 0.5, y: 0.5, fontSize: 10, color: '#fff' }]);
    useEditorStore.setState({ project: { fonts: [{ family: 'Mine', name: 'Mine Font', uri: 'f.ttf' }], imageDocs: [d] } as never, applyBatch });
    const m = await mount(d, 't1');
    const text = m.view.root.find((n: Node) => n.props.accessibilityLabel === 'studio.image.a11y.textContent' && typeof n.props.onChangeText === 'function');
    await act(async () => text.props.onChangeText('Szia'));
    const mine = m.view.root.find((n: Node) => n.props.accessibilityLabel === 'Mine Font' && typeof n.props.onPress === 'function');
    await act(async () => mine.props.onPress());
    expect(m.commits.map(([, l]) => l)).toEqual(['studio.image.undoText', 'studio.image.font']);
    expect(m.layerOf(1).fontFamily).toBe('Mine');

    const importBtn = m.view.root.find((n: Node) => n.props.testID === 'font-import' && typeof n.props.onPress === 'function');
    await act(async () => importBtn.props.onPress());
    expect(applyBatch).toHaveBeenCalledTimes(1);
    const [cmds, actor] = applyBatch.mock.calls[0];
    expect(actor).toBe('user');
    expect(cmds.map((c: { type: string }) => c.type)).toEqual(['SET_PROJECT_FONTS', 'UPSERT_IMAGE_DOC']);
    expect(cmds[0].fonts.map((f: { family: string }) => f.family)).toEqual(['Imp', 'Mine']);
    expect(cmds[1].label).toBe('studio.image.font');
    expect(cmds[1].doc.layers[0].fontFamily).toBe('Imp');
  });

  it('fotó: korrekció-lap, a LUT-import, a lasszók célpontjai és a kiegyenesítés holtsávja', async () => {
    const photo = { kind: 'photo', id: 'p1', uri: 'a.jpg', x: 0.5, y: 0.5, w: 1, h: 1, localAdjust: { mask: { shape: 'ellipse', x: 0.5, y: 0.5, w: 0.6, h: 0.6 } } };
    const m = await mount(doc([base, photo]), 'p1');
    expect(m.of('GeometryFields')).toHaveLength(1);
    await act(async () => m.byLabel('Chip', 'studio.image.corrections').props.onPress());
    await act(async () => m.byLabel('Chip', 'LUT import').props.onPress());
    for (const l of ['✏️ Folt lasszó', 'studio.image.maskPaint']) await act(async () => m.byLabel('Chip', l).props.onPress());
    for (const n of m.of('Chip').filter((c: Node) => c.props.label === '✏️ Lasszó')) await act(async () => n.props.onPress());
    expect(m.parent).toEqual(['adjust', 'p1:heal', 'p1:paint', 'p1:local', 'p1:clip']);
    expect(m.layerOf(0)).toMatchObject({ lut: 'file:///new.cube', lutName: 'New.cube' });

    const straighten = m.byLabel('Slider', 'studio.image.straighten');
    await act(async () => straighten.props.onChange(0.04));
    await act(async () => straighten.props.onChange(1.26));
    expect(m.commits.slice(1).map(([, l]) => l)).toEqual(['straighten', 'straighten']);
    expect(m.layerOf(1).straighten).toBeUndefined();
    expect(m.layerOf(2).straighten).toBe(1.3);

    await act(async () => m.byLabel('Chip', 'studio.image.clipToShape').props.onPress());
    expect(m.commits[3][1]).toBe('studio.image.clipToShape');
    expect(m.layerOf(3).clipTo).toBe('base');
  });

  it('fotó lasszó nélkül (nincs onDrawMask): a lasszó-chipek eltűnnek', async () => {
    const m = await mount(doc([{ kind: 'photo', id: 'p1', uri: 'a.jpg', x: 0.5, y: 0.5, w: 1, h: 1 }]), 'p1', false);
    const chips = m.of('Chip').map((n: Node) => n.props.label);
    expect(chips).not.toContain('✏️ Lasszó');
    expect(chips).not.toContain('✏️ Folt lasszó');
    expect(chips).not.toContain('studio.image.maskPaint');
  });

  it('korrekció-réteg: a HSL-chip a korrekció-lapot nyitja, a grade címke nélkül commitol', async () => {
    const m = await mount(doc([{ kind: 'adjust', id: 'a1' }]), 'a1');
    await act(async () => m.byLabel('Chip', 'studio.image.hsl.title').props.onPress());
    expect(m.parent).toEqual(['adjust']);
    expect(m.of('GeometryFields')).toHaveLength(0);
  });

  it('forma: a sokszög/csillag/vonal-címkék és a körvonal alap-igazítása', async () => {
    const m = await mount(doc([{ ...base, id: 's1', shape: 'rectangle', borderWidth: 1 }]), 's1');
    const align = m.of('Chip').filter((n: Node) => String(n.props.label).startsWith('studio.image.borderAlign.'));
    expect(align.map((n: Node) => [n.props.label, n.props.active])).toEqual([
      ['studio.image.borderAlign.inside', true],
      ['studio.image.borderAlign.center', false],
      ['studio.image.borderAlign.outside', false],
    ]);
    await act(async () => align[2].props.onPress());
    await act(async () => m.byLabel('Slider', 'studio.image.strokeWidth').props.onChange(0.5));
    await act(async () => m.byLabel('Chip', 'studio.image.stroke.dashed').props.onPress());
    expect(m.commits.map(([, l]) => l)).toEqual(['border-align', 'border-width', 'studio.image.stroke.style']);
    expect(m.layerOf(2).strokeDash).toBe(3);
  });

  it('közös rész: csoport, új mappa, maszk, keverés, effektek, belső stílus, gradient-maszk', async () => {
    const m = await mount(doc([{ ...base, id: 's1', groupId: 'g1', dropShadow: { dx: 0.05 } }]), 's1');
    // két „Nincs” van (csoport, maszk) — a csoporté az első
    await act(async () => m.of('Chip').filter((n: Node) => n.props.label === 'Nincs')[0].props.onPress());
    await act(async () => m.byLabel('Chip', '➕ Új').props.onPress());
    await act(async () => m.byLabel('Chip', 'Ellipszis').props.onPress());
    await act(async () => m.byLabel('Chip', 'screen').props.onPress());
    await act(async () => m.byLabel('Slider', 'Árnyék Y').props.onChange(0.04));
    await act(async () => m.byLabel('Chip', 'studio.image.inner.overlay').props.onPress());
    await act(async () => m.byLabel('Chip', 'down').props.onPress());
    expect(m.commits.map(([, l]) => l)).toEqual(['group', 'group-new', 'mask', undefined, 'shadow', 'studio.image.inner.overlay', undefined]);
    expect(m.layerOf(0).groupId).toBeUndefined();
    expect(m.commits[1][0].groups?.map((g) => g.id)).toEqual(['g1', 'grp_1']);
    expect(m.layerOf(2).mask).toEqual({ shape: 'ellipse', x: 0.5, y: 0.5, w: 0.8, h: 0.8, feather: 0.05 });
    expect(m.layerOf(3).blendMode).toBe('screen');
    expect(m.layerOf(4).dropShadow).toEqual({ dx: 0.05, dy: 0.04 });
    expect(m.layerOf(6).maskGradient).toBe('down');
  });
});

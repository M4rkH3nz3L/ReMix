/** 🎨 A Márkám rész valódi komponensen: a koppintás a boltba és a tárolóba is eljut. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { TemplatesSheet } from '@/components/studio/image/TemplatesSheet';
import { loadBrandStyle } from '@/lib/brandStore';
import { useBrandStyle } from '@/store/brandStyleStore';

jest.mock('@/components/studio/image/StudioSheet', () => ({
  StudioSheet: ({ children }: { children: unknown }) => children,
}));
// a kicsinyített sablon-előnézet a vászon réteg-komponenseit rajzolja (Reanimated/Skia) — a paritását az
// eszközös `templib` füstteszt méri, itt a lap logikája számít
jest.mock('@/components/studio/image/StageLayers', () => ({ StageLayers: () => null }));
// a kategória-chip animált (Reanimated) — itt egy sima gomb is elég
jest.mock('@/components/ui/controls', () => {
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    Chip: ({ label, onPress }: { label: string; onPress: () => void }) => (
      <Pressable onPress={onPress} accessibilityRole="button">
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

const mount = async () => {
  let view!: ReactTestRenderer;
  await act(async () => {
    view = create(<TemplatesSheet onPick={() => {}} onClose={() => {}} />);
  });
  return view;
};
const byId = (view: ReactTestRenderer, testID: string) =>
  view.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function');

describe('TemplatesSheet márka', () => {
  it('a + a márkába menti a színt, a tárolóba is kiírja, és megjelenik', async () => {
    const view = await mount();
    await act(async () => byId(view, 'brand-add-color')[0].props.onPress());
    expect(useBrandStyle.getState().colors).toContain('#ff2d95');
    expect((await loadBrandStyle()).colors).toContain('#ff2d95');
    expect(byId(view, 'brand-color-#ff2d95').length).toBeGreaterThan(0);
  });

  it('a font koppintásra márka lesz, újabb koppintásra lekerül', async () => {
    const view = await mount();
    await act(async () => byId(view, 'brand-font-bungee')[0].props.onPress());
    expect(useBrandStyle.getState().fontFamily).toBe('Bungee');
    expect((await loadBrandStyle()).fontFamily).toBe('Bungee');
    await act(async () => byId(view, 'brand-font-bungee')[0].props.onPress());
    expect(useBrandStyle.getState().fontFamily).toBeUndefined();
  });

  it('hosszú nyomás törli a márka-színt', async () => {
    await act(async () => useBrandStyle.getState().addColor('#123abc'));
    const view = await mount();
    await act(async () => byId(view, 'brand-color-#123abc')[0].props.onLongPress());
    expect(byId(view, 'brand-color-#123abc')).toHaveLength(0);
  });
});

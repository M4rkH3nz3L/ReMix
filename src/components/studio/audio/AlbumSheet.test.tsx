/** 🎧 A45: a szám átnevezése minden platformon (az Alert.prompt csak iOS-en van). */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, TextInput } from 'react-native';

import { AlbumSheet } from '@/components/studio/audio/AlbumSheet';
import { initAlbum, makeSong } from '@/lib/albumDoc';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';

jest.mock('react-native-worklets', () => ({ runOnJS: (fn: unknown) => fn, scheduleOnRN: (fn: (...a: unknown[]) => void, ...a: unknown[]) => fn(...a) }));
jest.mock('react-native-reanimated', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (c: unknown) => c },
    runOnJS: (fn: unknown) => fn,
    // a design-rendszer modul-szinten olvassa a görbéket és az animáció-építőket
    Easing: new Proxy({}, { get: () => () => () => 0 }),
    withTiming: (v: unknown) => v,
    withSpring: (v: unknown) => v,
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (fn: () => object) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useEvent: () => () => {},
    useComposedEventHandler: () => undefined,
    setGestureState: () => {},
  };
});

jest.mock('@/lib/media', () => ({ pickAudio: jest.fn(), pickImage: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: unknown }) => children }));

const songName = () => useEditorStore.getState().project!.album!.songs[0].name;

function mount() {
  const base = createEmptyProject('album', '1:1', undefined, 'audio');
  useEditorStore.getState().loadProject({ ...base, album: initAlbum(makeSong('s1', 'Első', base.tracks)) }, []);
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<AlbumSheet onClose={() => {}} onShareAlbum={() => {}} />);
  });
  return r;
}
const pencil = (r: ReactTestRenderer) => r.root.findAll((n) => n.props.testID === 'album-rename-s1')[0];

describe('AlbumSheet — átnevezés (A45)', () => {
  it('a ceruzára szövegmező nyílik, a beküldés átnevez, az Alert.prompt nem kell', () => {
    const prompt = jest.spyOn(Alert, 'prompt');
    const r = mount();
    act(() => pencil(r).props.onPress());
    const input = r.root.findByType(TextInput);
    act(() => input.props.onChangeText('  Új név  '));
    act(() => r.root.findByType(TextInput).props.onSubmitEditing());
    expect(songName()).toBe('Új név');
    expect(prompt).not.toHaveBeenCalled();
    expect(r.root.findAllByType(TextInput)).toHaveLength(0);
  });

  it('üres névvel nem nevez át', () => {
    const r = mount();
    act(() => pencil(r).props.onPress());
    act(() => r.root.findByType(TextInput).props.onChangeText('   '));
    act(() => r.root.findByType(TextInput).props.onSubmitEditing());
    expect(songName()).toBe('Első');
  });

  it('a mező elhagyása is ment (a billentyűzet bezárása)', () => {
    const r = mount();
    act(() => pencil(r).props.onPress());
    act(() => r.root.findByType(TextInput).props.onChangeText('Harmadik'));
    act(() => r.root.findByType(TextInput).props.onBlur());
    expect(songName()).toBe('Harmadik');
  });
});

/** 🎧 A27/A31: a hangexport-lap minden formátumot és minőséget elér, Alert-korlát nélkül. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { AudioExportSheet } from '@/components/studio/audio/AudioExportSheet';
import { Chip } from '@/components/ui/controls';

jest.mock('react-native-worklets', () => ({ runOnJS: (fn: unknown) => fn, scheduleOnRN: (fn: (...a: unknown[]) => void, ...a: unknown[]) => fn(...a) }));
jest.mock('react-native-reanimated', () => {
  const RN = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (c: unknown) => c },
    runOnJS: (fn: unknown) => fn,
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

const chip = (r: ReactTestRenderer, label: string) => r.root.findAll((n) => n.type === Chip && n.props.label === label)[0];
const press = (r: ReactTestRenderer, label: string) => act(() => chip(r, label).props.onPress());
const texts = (r: ReactTestRenderer) => r.root.findAllByType(Text).map((n) => String(n.props.children));

function mount() {
  const onDownload = jest.fn();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<AudioExportSheet onClose={() => {}} onPreview={() => {}} onUseInVideo={() => {}} onDownload={onDownload} />);
  });
  return { r, onDownload };
}
const save = (r: ReactTestRenderer) =>
  act(() => r.root.findAll((n) => typeof n.props.label === 'string' && n.props.icon === 'download-outline')[0].props.onPress());

describe('AudioExportSheet', () => {
  it('mind az öt formátum választható', () => {
    const { r } = mount();
    for (const label of ['MP3', 'WAV', 'FLAC', 'AAC (M4A)', 'Opus']) {
      expect(chip(r, label)).toBeDefined();
    }
  });

  it('WAV 24 bit 48 kHz mono a kért beállítással exportál', () => {
    const { r, onDownload } = mount();
    press(r, 'WAV');
    press(r, '24 bit');
    press(r, '48 kHz');
    press(r, 'studio.audio.exportSheet.mono');
    save(r);
    expect(onDownload).toHaveBeenCalledWith('wav', expect.objectContaining({ bitDepth: 24, sampleRate: 48000, channels: 1 }));
  });

  it('veszteséges formátumnál bitráta-választó van, bitmélység nincs', () => {
    const { r, onDownload } = mount();
    press(r, 'MP3');
    expect(chip(r, '24 bit')).toBeUndefined();
    press(r, '320 kbps');
    save(r);
    expect(onDownload).toHaveBeenCalledWith('mp3', expect.objectContaining({ bitrateKbps: 320 }));
  });

  it('formátumváltáskor a bitráta a kínálathoz igazodik', () => {
    const { r, onDownload } = mount();
    press(r, '320 kbps');
    press(r, 'AAC (M4A)');
    save(r);
    expect(onDownload).toHaveBeenCalledWith('aac', expect.objectContaining({ bitrateKbps: 256 }));
    expect(texts(r).some((x) => x.includes('studio.audio.exportSheet.lossyHint'))).toBe(true);
  });
});

describe('AudioExportSheet — telefonos export (A26)', () => {
  it('Free módban a WAV az alap, a többi formátum a Pro-ajánlatot nyitja, minőség-választó nincs', () => {
    const onDownload = jest.fn();
    const onProRequired = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AudioExportSheet onClose={() => {}} onPreview={() => {}} onUseInVideo={() => {}} onDownload={onDownload} onDevice onProRequired={onProRequired} />);
    });
    act(() => chip(r, 'MP3 · PRO').props.onPress());
    expect(onProRequired).toHaveBeenCalledTimes(1);
    expect(chip(r, '24 bit')).toBeUndefined();
    expect(chip(r, '48 kHz')).toBeUndefined();
    save(r);
    expect(onDownload).toHaveBeenCalledWith('wav', expect.anything());
  });
});


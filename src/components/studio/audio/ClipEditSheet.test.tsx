/** 🎧 A11: a klip beállítása bezáráskor is megmarad, bárhogy zárul a lap. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ClipEditSheet } from '@/components/studio/audio/ClipEditSheet';
import { useEditorStore } from '@/store/editorStore';
import { useEntitlement } from '@/store/entitlementStore';
import { usePaywall } from '@/store/paywallStore';
import { createEmptyProject } from '@/lib/projectUtils';
import type { AudioClip } from '@/types/project';

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

let frameClose: () => void = () => {};
jest.mock('@/components/studio/audio/AudioSheetFrame', () => ({
  AudioSheetFrame: ({ onClose, children }: { onClose: () => void; children: unknown }) => {
    frameClose = onClose;
    return children;
  },
}));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: unknown }) => children,
}));

const clip = { kind: 'audio', id: 'c', uri: 'file:///a.m4a', label: 'a', start: 0, duration: 4, volume: 1, fadeIn: 0, fadeOut: 0 } as AudioClip;

describe('ClipEditSheet', () => {
  it('módosítás után a lap bezárása ment, nem dob el semmit', async () => {
    const p = createEmptyProject('t', '9:16', undefined, 'audio');
    useEditorStore.getState().loadProject({ ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) }, []);
    const onClose = jest.fn();
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<ClipEditSheet clip={clip} fps={30} onClose={onClose} />);
    });
    // a hangerő-csúszka dB-ben (0 dB = 1); −12,04 dB = 0,25
    const slider = view.root.findAll((n) => typeof n.props.onChange === 'function' && n.props.label === 'studio.audio.volume')[0];
    expect(slider.props.value).toBe(0);
    await act(async () => slider.props.onChange(20 * Math.log10(0.25)));
    await act(async () => frameClose());
    expect(onClose).toHaveBeenCalledTimes(1);
    const saved = useEditorStore.getState().project?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip;
    expect(saved.volume).toBeCloseTo(0.25, 9);
  });

  it('🔊 0 dB fölé is erősíthető (+6 dB = ×1,995), és a hangerő-állítás nem kerekíti el a késés-kompenzált vágást', async () => {
    const p = createEmptyProject('t', '9:16', undefined, 'audio');
    const precise = { ...clip, trimIn: 0.2731 };
    useEditorStore.getState().loadProject({ ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [precise] } : t)) }, []);
    let view!: ReactTestRenderer;
    await act(async () => {
      view = create(<ClipEditSheet clip={precise} fps={30} onClose={() => {}} />);
    });
    const slider = view.root.findAll((n) => typeof n.props.onChange === 'function' && n.props.label === 'studio.audio.volume')[0];
    expect(slider.props.max).toBe(12);
    await act(async () => slider.props.onChange(6));
    await act(async () => frameClose());
    const saved = useEditorStore.getState().project?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip;
    expect(saved.volume).toBeCloseTo(1.99526, 4);
    expect(saved.trimIn).toBe(0.2731);
  });

  describe('PRO effektek (A48)', () => {
    const presetChip = (view: ReactTestRenderer) => view.root.findAll((n) => n.props.testID === 'audio-fx-preset-podcast')[0];
    const mount = async () => {
      const p = createEmptyProject('t', '9:16', undefined, 'audio');
      useEditorStore.getState().loadProject({ ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) }, []);
      let view!: ReactTestRenderer;
      await act(async () => {
        view = create(<ClipEditSheet clip={clip} fps={30} onClose={() => {}} />);
      });
      return view;
    };
    const savedFx = () => (useEditorStore.getState().project?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip).audioFx;

    it('Free felhasználónál az effekt a paywallt nyitja, és nem kerül a klipre', async () => {
      useEntitlement.setState({ tier: 'free', devPro: false });
      usePaywall.setState({ visible: false });
      const view = await mount();
      await act(async () => presetChip(view).props.onPress());
      await act(async () => frameClose());
      expect(usePaywall.getState().visible).toBe(true);
      expect(savedFx()).toBeUndefined();
    });

    it('Pro felhasználónál az effekt a klipre kerül', async () => {
      useEntitlement.setState({ tier: 'pro', proUntil: null, devPro: false });
      usePaywall.setState({ visible: false });
      const view = await mount();
      await act(async () => presetChip(view).props.onPress());
      await act(async () => frameClose());
      expect(usePaywall.getState().visible).toBe(false);
      expect(savedFx()).toBeDefined();
    });
  });
});


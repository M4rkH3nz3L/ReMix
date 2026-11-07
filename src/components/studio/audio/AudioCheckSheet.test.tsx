/** 🩺 A hangellenőrzés eredmény-lapja: a hibára koppintva a lejátszófej oda ugrik, a lap bezárul. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';

import { AudioCheckSheet } from '@/components/studio/audio/AudioCheckSheet';
import { useEditorStore } from '@/store/editorStore';

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

describe('AudioCheckSheet', () => {
  it('a hibára koppintva a lejátszófej a hiba elejére ugrik, a lap bezárul; a hely nélküli nem koppintható', () => {
    const setPlayhead = jest.spyOn(useEditorStore.getState(), 'setPlayhead');
    const onClose = jest.fn();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <AudioCheckSheet
          issues={[{ kind: 'clipping', severity: 'error', start: 2, end: 3 }, { kind: 'muted', severity: 'warn', params: { track: 'music' } }]}
          stats={{ duration: 10, peak: 1.2, lufs: -14.2, clipping: [], silence: [], phase: [] }}
          onClose={onClose}
        />
      );
    });
    const items = r.root.findAll((n) => typeof n.props.onPress === 'function' && 'disabled' in n.props && typeof n.type !== 'string');
    expect(items[1].props.disabled).toBe(true);
    act(() => items[0].props.onPress());
    expect(setPlayhead).toHaveBeenCalledWith(2);
    expect(onClose).toHaveBeenCalled();
    expect(r.root.findAllByType(Text).some((t) => String(t.props.children).includes('studio.audio.check.summary'))).toBe(true);
  });
  it('hiba nélkül: „rendben” üzenet', () => {
    let r!: ReactTestRenderer;
    act(() => {
      r = create(<AudioCheckSheet issues={[]} stats={null} onClose={() => {}} />);
    });
    expect(r.root.findAllByType(Text).some((t) => t.props.children === 'studio.audio.check.ok')).toBe(true);
  });
});

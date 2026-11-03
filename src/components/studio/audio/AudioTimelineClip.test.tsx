/** 🖐️ Hang-klip: hosszú nyomás menüt ad, a „Több kijelölése” után a koppintás hozzáad, a törlés egy undo. */
import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { AudioTimelineClip } from '@/components/studio/audio/AudioTimelineClip';
import { createEmptyProject } from '@/lib/projectUtils';
import { useActionMenu } from '@/store/actionMenuStore';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';

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
jest.mock('@/components/editor/ClipWaveform', () => ({ ClipWaveform: () => null }));

const clip = (id: string, start: number) => ({ kind: 'audio', id, label: id, uri: 'file:///a.m4a', start, duration: 2, trimIn: 0, sourceDuration: 10, volume: 1, speed: 1 }) as unknown as AudioClip;
const make = (): Project => {
  const p = createEmptyProject('t', '9:16');
  return { ...p, tracks: p.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip('a', 0), clip('b', 3), clip('c', 6)] } : t)) };
};
const mount = (id: string, start: number) => {
  act(() => {
    create(
      <AudioTimelineClip clip={clip(id, start)} pxPerSec={60} laneColor="#fff" laneH={60} laneType="music" laneTypes={['music']} selected={false} snap={(s) => s} />
    );
  });
};
const press = (id: string, translationX = 0) =>
  act(async () => {
    fireGestureHandler(getByGestureTestId(`audio-clip-move-${id}`) as never, [
      { state: State.BEGAN, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX: 0, translationY: 0 },
      { state: State.ACTIVE, translationX, translationY: 0 },
      { state: State.END, translationX, translationY: 0 },
    ]);
  });
const tap = (id: string) =>
  act(async () => {
    fireGestureHandler(getByGestureTestId(`audio-clip-tap-${id}`) as never, [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: State.END }]);
  });

describe('hang-klip hosszú nyomása', () => {
  const menu = () => useActionMenu.getState().items;
  beforeEach(() => {
    useEditorStore.getState().loadProject(make(), []);
    useActionMenu.getState().close();
  });

  it('mozgás nélkül menüt ad, a klip marad a helyén', async () => {
    mount('b', 3);
    await press('b');
    expect(menu()).toHaveLength(4);
    expect(useEditorStore.getState().project?.tracks.find((t) => t.type === 'music')?.clips.find((c) => c.id === 'b')?.start).toBe(3);
  });

  it('húzásnál nincs menü, a klip mozog', async () => {
    mount('b', 3);
    await press('b', 60);
    expect(menu()).toBeNull();
    expect(useEditorStore.getState().project?.tracks.find((t) => t.type === 'music')?.clips.find((c) => c.id === 'b')?.start).toBe(4);
  });

  it('a Több kijelölése után a koppintás hozzáad, a törlés egy visszavonás', async () => {
    mount('a', 0);
    mount('c', 6);
    await press('a');
    act(() => menu()?.[0].onPress());
    expect(useEditorStore.getState().multiSelectMode).toBe(true);
    await tap('c');
    expect(useEditorStore.getState().allSelectedIds()).toEqual(['a', 'c']);
    act(() => useEditorStore.getState().removeSelectedClips());
    const left = () => useEditorStore.getState().project?.tracks.find((t) => t.type === 'music')?.clips.map((c) => c.id);
    expect(left()).toEqual(['b']);
    expect(useEditorStore.getState().multiSelectMode).toBe(false);
    act(() => useEditorStore.getState().undo());
    expect(left()).toEqual(['a', 'b', 'c']);
  });
});

describe('zárolt sáv a Hang Stúdióban (A47)', () => {
  const startOf = (id: string) => useEditorStore.getState().project?.tracks.find((t) => t.type === 'music')?.clips.find((c) => c.id === id)?.start;
  beforeEach(() => {
    useEditorStore.getState().loadProject(make(), []);
    useActionMenu.getState().close();
    if (!useEditorStore.getState().lockedTracks.includes('music')) {
      useEditorStore.getState().toggleTrackFlag('music', 'lock');
    }
  });

  it('a koppintás elmondja, hogy a sáv zárolt, és egy gombbal feloldható', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mount('b', 3);
    await tap('b');
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    act(() => buttons[buttons.length - 1].onPress?.());
    expect(useEditorStore.getState().lockedTracks).not.toContain('music');
    alert.mockRestore();
  });

  it('a húzás nem mozgatja, és menü sem nyílik (nincs látszólagos szerkesztés)', async () => {
    mount('b', 3);
    await press('b', 60);
    expect(startOf('b')).toBe(3);
    expect(useActionMenu.getState().items).toBeNull();
  });
});


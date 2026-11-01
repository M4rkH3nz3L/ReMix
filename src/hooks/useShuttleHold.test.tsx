/** ⏩ Nyomva tartás: gyorsul, elengedésre megáll; a sima koppintás nem indítja. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';

import { useShuttleHold } from '@/hooks/useShuttleHold';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';

function Button({ dir }: { dir: 1 | -1 }) {
  const hold = useShuttleHold(dir);
  return (
    <Pressable {...hold}>
      <Text>x</Text>
    </Pressable>
  );
}

describe('useShuttleHold', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    useEditorStore.getState().loadProject(createEmptyProject('t', '9:16'), []);
  });
  afterEach(() => jest.useRealTimers());
  const mount = (dir: 1 | -1) => {
    let view!: ReactTestRenderer;
    act(() => {
      view = create(<Button dir={dir} />);
    });
    return view.root.findAll((n) => typeof n.props.onLongPress === 'function')[0].props as { onLongPress: () => void; onPressOut: () => void };
  };
  const state = () => useEditorStore.getState();

  it('előre: 2×, majd 4×, elengedésre megáll és visszaáll 1×-re', () => {
    const p = mount(1);
    act(() => p.onLongPress());
    expect([state().isPlaying, state().playbackRate]).toEqual([true, 2]);
    act(() => jest.advanceTimersByTime(1300));
    expect(state().playbackRate).toBe(4);
    act(() => p.onPressOut());
    expect([state().isPlaying, state().playbackRate]).toEqual([false, 1]);
  });

  it('vissza: negatív sebesség', () => {
    const p = mount(-1);
    act(() => p.onLongPress());
    expect(state().playbackRate).toBe(-2);
  });

  it('sima koppintás után az elengedés nem állítja meg a futó lejátszást', () => {
    const p = mount(1);
    act(() => state().setPlaying(true));
    act(() => p.onPressOut());
    expect(state().isPlaying).toBe(true);
  });

  it('korai elengedés után nem gyorsul tovább', () => {
    const p = mount(1);
    act(() => p.onLongPress());
    act(() => p.onPressOut());
    act(() => jest.advanceTimersByTime(2000));
    expect(state().playbackRate).toBe(1);
  });
});

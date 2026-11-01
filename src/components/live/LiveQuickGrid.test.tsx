/** 🎛️ A gombrács: minden forrásnak van gombja, az állapot látszik, a koppintás a saját forrását kapcsolja. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { LiveQuickGrid } from '@/components/live/LiveQuickGrid';
import { adjacentSceneId, sceneAfterSwipe, SCENE_SWIPE_MIN } from '@/lib/liveDoc';

describe('LiveQuickGrid', () => {
  const sources = [
    { id: 'cam', kind: 'camera', label: 'Kamera', visible: true },
    { id: 'logo', kind: 'logo', label: 'Logó', visible: false },
  ] as const;
  const byId = (view: ReactTestRenderer, id: string) => view.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0];

  it('a forrás gombja a forrását kapcsolja és mutatja az állapotát', () => {
    const onToggle = jest.fn();
    let view!: ReactTestRenderer;
    act(() => {
      view = create(<LiveQuickGrid sources={[...sources]} micMuted={false} onToggle={onToggle} onMic={() => {}} onFlip={() => {}} />);
    });
    expect(byId(view, 'quick-cam').props.accessibilityState).toEqual({ checked: true });
    expect(byId(view, 'quick-logo').props.accessibilityState).toEqual({ checked: false });
    act(() => byId(view, 'quick-logo').props.onPress());
    expect(onToggle).toHaveBeenCalledWith('logo');
  });
});

describe('adjacentSceneId', () => {
  const scenes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('a következő és az előző jelenet', () => {
    expect(adjacentSceneId(scenes, 'b', 1)).toBe('c');
    expect(adjacentSceneId(scenes, 'b', -1)).toBe('a');
  });

  it('a szélén megáll, nem ugrik körbe élő adásban', () => {
    expect(adjacentSceneId(scenes, 'c', 1)).toBeNull();
    expect(adjacentSceneId(scenes, 'a', -1)).toBeNull();
  });

  it('ismeretlen vagy üres jelenetnél nincs váltás', () => {
    expect(adjacentSceneId(scenes, 'x', 1)).toBeNull();
    expect(adjacentSceneId(scenes, undefined, 1)).toBeNull();
  });
});

describe('sceneAfterSwipe', () => {
  const scenes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('balra a következő, jobbra az előző', () => {
    expect(sceneAfterSwipe(scenes, 'b', -SCENE_SWIPE_MIN)).toBe('c');
    expect(sceneAfterSwipe(scenes, 'b', SCENE_SWIPE_MIN)).toBe('a');
  });

  it('a rövid húzás nem vált', () => {
    expect(sceneAfterSwipe(scenes, 'b', SCENE_SWIPE_MIN - 1)).toBeNull();
  });
});

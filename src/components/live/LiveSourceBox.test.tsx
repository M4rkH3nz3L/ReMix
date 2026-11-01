/** 🖐️ A forrás valódi ujj-útvonala: húzás, csippentés, sarokfogó, és egy mentés a végén. */
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { LiveSourceBox } from '@/components/live/LiveSourceBox';
import type { LiveTransform } from '@/types/live';

const t = { x: 0.1, y: 0.1, w: 0.2, h: 0.2, z: 0 } as LiveTransform;
const mount = (selected = true) => {
  const fns = { onSelect: jest.fn(), onDraft: jest.fn(), onCommit: jest.fn(), onPress: jest.fn() };
  act(() => {
    create(
      <LiveSourceBox id="s" transform={t} canvas={{ w: 100, h: 200 }} selected={selected} style={{}} {...fns}>
        <Text>x</Text>
      </LiveSourceBox>
    );
  });
  return fns;
};
const fire = (id: string, events: object[]) =>
  act(async () => {
    fireGestureHandler(getByGestureTestId(id) as never, [{ state: State.BEGAN }, { state: State.ACTIVE, ...events[0] }, ...events.map((e) => ({ state: State.ACTIVE, ...e })), { state: State.END, ...events[events.length - 1] }]);
  });

describe('LiveSourceBox', () => {
  it('a húzás kijelöl, követi az ujjat és egyszer ment', async () => {
    const f = mount();
    await fire('live-source-move-s', [{ translationX: 0, translationY: 0 }, { translationX: 10, translationY: 40 }]);
    expect(f.onSelect).toHaveBeenCalled();
    expect(f.onCommit).toHaveBeenCalledTimes(1);
    const out = f.onCommit.mock.calls[0][0] as LiveTransform;
    expect(out.x).toBeCloseTo(0.2);
    expect(out.y).toBeCloseTo(0.3);
  });

  it('a sarokfogó méretez, a sarok áll', async () => {
    const f = mount();
    await fire('live-source-resize-s', [{ translationX: 0, translationY: 0 }, { translationX: 10, translationY: 20 }]);
    const out = f.onCommit.mock.calls[0][0] as LiveTransform;
    expect(out.x).toBe(0.1);
    expect(out.w).toBeCloseTo(0.3);
    expect(out.h).toBeCloseTo(0.3);
  });

  it('a csippentés a közepe körül nagyít', async () => {
    const f = mount();
    await fire('live-source-pinch-s', [{ scale: 1 }, { scale: 2 }]);
    const out = f.onCommit.mock.calls[0][0] as LiveTransform;
    expect(out.w).toBeCloseTo(0.4);
    expect(out.x + out.w / 2).toBeCloseTo(0.2);
  });
});

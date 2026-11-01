/** 🧩 Panel átrendezése a valódi húzással: a magasságok a mért értékek, a sorrend a szülőhöz jut. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { LivePanelList } from '@/components/live/LivePanelList';
import type { LivePanelId } from '@/lib/livePanels';

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

const order: LivePanelId[] = ['scenes', 'sources', 'record'];
const mount = (panels: Partial<Record<LivePanelId, unknown>> = { scenes: 1, sources: 2, record: 3 }) => {
  const onOrder = jest.fn();
  let view!: ReactTestRenderer;
  const nodes = Object.fromEntries(Object.keys(panels).map((k) => [k, <Text key={k}>{k}</Text>]));
  act(() => {
    view = create(<LivePanelList order={order} panels={nodes} onOrder={onOrder} />);
  });
  for (const id of Object.keys(panels)) {
    const row = view.root.findAll((n) => n.props.testID === `live-panel-${id}` && typeof n.props.onLayout === 'function')[0];
    act(() => row.props.onLayout({ nativeEvent: { layout: { height: 100 } } }));
  }
  return onOrder;
};
const drag = (id: string, translationY: number) =>
  act(async () => {
    fireGestureHandler(getByGestureTestId(`live-panel-drag-${id}`) as never, [
      { state: State.BEGAN, translationY: 0 },
      { state: State.ACTIVE, translationY: 0 },
      { state: State.ACTIVE, translationY },
      { state: State.END, translationY },
    ]);
  });

describe('LivePanelList', () => {
  it('a húzott panel új helyre kerül', async () => {
    const onOrder = mount();
    await drag('scenes', 160);
    expect(onOrder).toHaveBeenCalledWith(['sources', 'scenes', 'record']);
  });

  it('rövid húzásnál nincs változás', async () => {
    const onOrder = mount();
    await drag('sources', 10);
    expect(onOrder).not.toHaveBeenCalled();
  });

  it('a rejtett panel nem számít a helyeknél', async () => {
    const onOrder = mount({ scenes: 1, record: 3 });
    await drag('scenes', 160);
    expect(onOrder).toHaveBeenCalledWith(['sources', 'record', 'scenes']);
  });
});

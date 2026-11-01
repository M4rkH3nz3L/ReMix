/** 📼 A kapcsoló valódi állapota: kikapcsolva false, bekapcsolva true, nem csak a szín változik. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Switch } from 'react-native';

import { RecordToggle } from '@/components/live/RecordToggle';

const mount = (value: boolean, onToggle: () => void) => {
  let view!: ReactTestRenderer;
  act(() => {
    view = create(<RecordToggle value={value} onToggle={onToggle} />);
  });
  return view;
};

describe('RecordToggle', () => {
  it.each([[false], [true]])('a kapcsoló a %s állapotot mutatja', (value) => {
    expect(mount(value, () => {}).root.findByType(Switch).props.value).toBe(value);
  });

  it('a kapcsoló és a sor is vált', () => {
    const toggle = jest.fn();
    const view = mount(false, toggle);
    act(() => view.root.findByType(Switch).props.onValueChange(true));
    act(() => view.root.findAll((n) => n.props.testID === 'live-record-row' && typeof n.props.onPress === 'function')[0].props.onPress());
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});

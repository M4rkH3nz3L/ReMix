/** 👥 A válasz eljut a hívóhoz, a hiba látszik és naplózódik. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Alert } from 'react-native';

import { InviteResponseCard } from '@/components/collab/InviteResponseCard';

const press = async (view: ReactTestRenderer, id: string) => {
  await act(async () => view.root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0].props.onPress());
};
const mount = (onRespond: (accept: boolean) => Promise<void>) => {
  let view!: ReactTestRenderer;
  act(() => {
    view = create(<InviteResponseCard projectName="P" role="editor" onRespond={onRespond} />);
  });
  return view;
};

describe('InviteResponseCard', () => {
  it('elfogadás és elutasítás', async () => {
    const respond = jest.fn(async () => {});
    const view = mount(respond);
    await press(view, 'invite-accept');
    await press(view, 'invite-decline');
    expect(respond.mock.calls).toEqual([[true], [false]]);
  });

  it('a hiba nem marad néma', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const view = mount(async () => {
      throw new Error('nincs meghívó');
    });
    await press(view, 'invite-accept');
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });
});

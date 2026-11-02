/** 🖐️ A menü minden eleme megjelenik (az Alert három után vágna), a koppintás zár és lefut. */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ActionMenuHost } from '@/components/ActionMenuHost';
import { useActionMenu } from '@/store/actionMenuStore';

jest.mock('@/components/studio/image/StudioSheet', () => ({
  StudioSheet: ({ children }: { children: unknown }) => children,
}));

describe('ActionMenuHost', () => {
  const item = (view: ReactTestRenderer, i: number) => view.root.findAll((n) => n.props.testID === `action-menu-${i}` && typeof n.props.onPress === 'function');
  it('öt elemet is mutat, a koppintás bezár és végrehajt', () => {
    const run = jest.fn();
    const items = ['a', 'b', 'c', 'd', 'e'].map((label) => ({ label, onPress: run }));
    let view!: ReactTestRenderer;
    act(() => {
      view = create(<ActionMenuHost />);
    });
    act(() => useActionMenu.getState().open('t', items));
    expect(item(view, 4)).not.toHaveLength(0);
    act(() => item(view, 4)[0].props.onPress());
    expect(run).toHaveBeenCalledTimes(1);
    expect(useActionMenu.getState().items).toBeNull();
    expect(item(view, 0)).toHaveLength(0);
  });
});

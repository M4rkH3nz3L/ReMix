/** 🖐️ A koppintások valódi RNGH-úton: két ujj visszavon, három újrát kér, a megszakított nem csinál semmit. */
import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { UndoGestureArea } from '@/components/UndoGestureArea';
import { useEditorStore } from '@/store/editorStore';

const tap = (id: string, end: (typeof State)[keyof typeof State] = State.END) =>
  act(async () => {
    fireGestureHandler(getByGestureTestId(id) as never, [{ state: State.BEGAN }, { state: State.ACTIVE }, { state: end }]);
  });

describe('UndoGestureArea', () => {
  const undo = jest.fn();
  const redo = jest.fn();
  beforeEach(() => {
    undo.mockClear();
    redo.mockClear();
    useEditorStore.setState({ undo, redo });
  });
  const mount = (enabled = true) =>
    act(async () => {
      create(<UndoGestureArea enabled={enabled}><Text>x</Text></UndoGestureArea>);
    });

  it('kétujjas koppintás visszavon', async () => {
    await mount();
    await tap('undo-tap');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).not.toHaveBeenCalled();
  });

  it('háromujjas koppintás újra', async () => {
    await mount();
    await tap('redo-tap');
    expect(redo).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it('a megszakított koppintás nem csinál semmit', async () => {
    await mount();
    await tap('undo-tap', State.FAILED);
    expect(undo).not.toHaveBeenCalled();
  });

  it('adás alatt letiltható', async () => {
    await mount(false);
    await tap('undo-tap');
    await tap('redo-tap');
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});

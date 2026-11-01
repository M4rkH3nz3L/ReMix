/** ▭ A kijelölő húzás a valódi callback-láncon: gyűrű lesz belőle, a megszakított húzás nyomtalan. */
import { act, create } from 'react-test-renderer';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { MarqueeOverlay } from '@/components/studio/image/MarqueeOverlay';
import { applyRing, type Point, selectionContains } from '@/lib/selection';

const box = { w: 200, h: 100 };

function drag(shape: 'rect' | 'ellipse', end: State, to = { x: 150, y: 80 }) {
  const rings: Point[][] = [];
  act(() => {
    create(<MarqueeOverlay box={box} shape={shape} onRing={(r) => rings.push(r)} gestureTestId={`m-${shape}-${end}`} />);
  });
  act(() => {
    fireGestureHandler(getByGestureTestId(`m-${shape}-${end}`), [
      { state: State.BEGAN, x: 50, y: 20 },
      { state: State.ACTIVE, x: to.x, y: to.y },
      { state: end, x: to.x, y: to.y },
    ]);
  });
  return rings;
}

describe('kijelölő húzás', () => {
  it('a téglalap a vászon arányában jön létre', () => {
    const [ring] = drag('rect', State.END);
    expect(ring[0]).toEqual({ x: 0.25, y: 0.2 });
    expect(ring[2]).toEqual({ x: 0.75, y: 0.8 });
  });
  it('az ellipszis sarka nincs benne', () => {
    const [ring] = drag('ellipse', State.END);
    const sel = applyRing(null, ring, 'new')!;
    expect(selectionContains(sel, { x: 0.5, y: 0.5 })).toBe(true);
    expect(selectionContains(sel, { x: 0.26, y: 0.21 })).toBe(false);
  });
  it('a vásznon túlra húzva a szélen áll meg', () => {
    const [ring] = drag('rect', State.END, { x: 500, y: 500 });
    expect(ring[2]).toEqual({ x: 1, y: 1 });
  });
  it('a megszakított húzás nem változtat a kijelölésen', () => {
    expect(drag('rect', State.CANCELLED)).toHaveLength(0);
  });
});

/** ✏️ A toll a valódi callback-láncon: koppintás sarok, húzás görbe, az első pont zár. */
import { act, create } from 'react-test-renderer';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { PenOverlay } from '@/components/studio/image/PenOverlay';
import type { CanvasPoint } from '@/lib/penPath';

const box = { w: 200, h: 100 };

function run(points: CanvasPoint[], moves: { x: number; y: number }[], end: typeof State.END | typeof State.CANCELLED = State.END) {
  const added: CanvasPoint[] = [];
  let closed = 0;
  const id = `pen-${Math.random()}`;
  act(() => {
    create(<PenOverlay box={box} points={points} onAddPoint={(p) => added.push(p)} onClosePath={() => (closed += 1)} gestureTestId={id} />);
  });
  const [first, ...rest] = moves;
  act(() => {
    fireGestureHandler(getByGestureTestId(id), [
      { state: State.BEGAN, ...first },
      { state: State.ACTIVE, ...first },
      ...rest.map((m) => ({ state: State.ACTIVE, ...m })),
      { state: end, ...moves[moves.length - 1] },
    ]);
  });
  return { added, closed };
}

const tri = [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.5, y: 0.8 }];

describe('toll', () => {
  it('a koppintás sarokpont', () => {
    expect(run([], [{ x: 100, y: 50 }]).added).toEqual([{ x: 0.5, y: 0.5 }]);
  });
  it('a húzás görbe csomópont: a kezdőponton marad, fogantyút kap', () => {
    const [p] = run([], [{ x: 100, y: 50 }, { x: 140, y: 50 }, { x: 160, y: 70 }]).added;
    expect([p.x, p.y]).toEqual([0.5, 0.5]);
    expect(p.h2).toEqual({ x: 0.8, y: 0.7 });
    expect(p.h1!.x).toBeCloseTo(0.2);
  });
  it('az első pontra koppintva zár', () => {
    const r = run(tri, [{ x: 22, y: 12 }]);
    expect(r.closed).toBe(1);
    expect(r.added).toHaveLength(0);
  });
  it('az első pontról induló húzás új görbe pont, nem zárás', () => {
    expect(run(tri, [{ x: 22, y: 12 }, { x: 80, y: 60 }]).closed).toBe(0);
  });
  it('a megszakított húzás nem tesz pontot', () => {
    expect(run([], [{ x: 100, y: 50 }, { x: 150, y: 60 }], State.CANCELLED).added).toHaveLength(0);
  });
});

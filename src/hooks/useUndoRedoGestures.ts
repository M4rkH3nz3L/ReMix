import { useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

/** a csippentés és a húzás kezdete nem számít koppintásnak */
const MAX_TAP_MS = 250;
const MAX_TAP_DISTANCE = 12;

/**
 * 🖐️ Közös gesztusnyelv: kétujjas koppintás = visszavonás, háromujjas = újra. A háromujjas az első:
 * a kétujjas csak akkor fut, ha nem lett belőle három ujj. A gesztus egyszer jön létre, a friss
 * műveletet refből olvassa.
 */
export function useUndoRedoGestures(onUndo: () => void, onRedo: () => void) {
  const latest = useRef({ onUndo, onRedo });
  latest.current = { onUndo, onRedo };
  const tap = (pointers: number, id: string, run: () => void) =>
    Gesture.Tap()
      .withTestId(id)
      .runOnJS(true)
      .minPointers(pointers)
      .maxDuration(MAX_TAP_MS)
      .maxDistance(MAX_TAP_DISTANCE)
      .onEnd((_e, success) => {
        if (success) {
          run();
        }
      });
  return useRef(
    Gesture.Exclusive(
      tap(3, 'redo-tap', () => latest.current.onRedo()),
      tap(2, 'undo-tap', () => latest.current.onUndo())
    )
  ).current;
}

import { type Dispatch, type SetStateAction } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import { gestures } from '@/design';
import { clampPan, pinchAt } from '@/lib/canvasZoom';

/**
 * 🔍 A vászon munkaterület-nézetének gesztusai (RNGH) — hook nélküli gyárak. A hívó EGYSZER
 * tartja meg őket (useRef), ezért a friss értékeket refből olvassák. Mind JS-szálon fut
 * (`runOnJS(true)`).
 */
type Box = { w: number; h: number };
type Pt = { x: number; y: number };
type Ref<T> = { current: T };

/** kétujjas húzás: a teljes nézet tolása (csippentés közben a csippentés tolja) */
export function createPanGesture({
  panStart,
  panRef,
  pinching,
  setPan,
  zoomRef,
  fitRef,
}: {
  panStart: Ref<Pt>;
  panRef: Ref<Pt>;
  pinching: Ref<boolean>;
  setPan: Dispatch<SetStateAction<Pt>>;
  zoomRef: Ref<number>;
  fitRef: Ref<Box>;
}) {
  return Gesture.Pan()
    .runOnJS(true)
    .minPointers(2)
    .onStart(() => {
      panStart.current = panRef.current;
    })
    .onUpdate((e) => {
      if (pinching.current) {
        return; // a csippentés a fókuszponttal maga tolja a nézetet
      }
      setPan(
        clampPan(
          { x: panStart.current.x + e.translationX, y: panStart.current.y + e.translationY },
          zoomRef.current,
          fitRef.current
        )
      );
    });
}

/** csippentés: a fókuszpontja körül nagyít */
export function createPinchGesture({
  pinching,
  pinchStart,
  zoomRef,
  panRef,
  fromCenter,
  fitRef,
  setZoom,
  setPan,
}: {
  pinching: Ref<boolean>;
  pinchStart: Ref<{ zoom: number; pan: Pt; focal: Pt }>;
  zoomRef: Ref<number>;
  panRef: Ref<Pt>;
  fromCenter: (e: { focalX: number; focalY: number }) => Pt;
  fitRef: Ref<Box>;
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<Pt>>;
}) {
  return Gesture.Pinch()
    .runOnJS(true)
    .onStart((e) => {
      pinching.current = true;
      pinchStart.current = { zoom: zoomRef.current, pan: panRef.current, focal: fromCenter(e) };
    })
    .onUpdate((e) => {
      const next = pinchAt(pinchStart.current, e.scale, fromCenter(e), fitRef.current);
      setZoom(next.zoom);
      setPan(next.pan);
    })
    .onFinalize(() => {
      pinching.current = false;
    });
}

// koppintás a vásznon kívüli üres területre: kijelölés megszüntetése
export function createBackdropTap({
  setZoom,
  setPan,
  onSelectRef,
}: {
  setZoom: Dispatch<SetStateAction<number>>;
  setPan: Dispatch<SetStateAction<Pt>>;
  onSelectRef: Ref<(id: string | null) => void>;
}) {
  return Gesture.Exclusive(
    // dupla koppintás a szabad területre: a teljes vászon vissza a nézetbe
    Gesture.Tap()
      .withTestId('canvas-fit-tap')
      .runOnJS(true)
      .numberOfTaps(2)
      .onEnd((_e, success) => {
        if (success) {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }
      }),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => onSelectRef.current(null))
  );
}

// hosszú nyomás a rétegen: a menü; a pontot a nézet aktuális állása szerint váltjuk vászon-arányra
export function createLayerLongPress({ longPress }: { longPress: Ref<{ run: (x: number, y: number) => void }> }) {
  return Gesture.LongPress()
    .withTestId('canvas-long-press')
    .runOnJS(true)
    .minDuration(gestures.longPress.context)
    .maxDistance(gestures.slop.tap)
    .onStart((e) => longPress.current.run(e.x, e.y));
}

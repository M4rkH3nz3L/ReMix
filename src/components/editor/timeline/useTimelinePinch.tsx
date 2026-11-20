import { useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import type { EditorState } from '@/store/editorState';
import { useEditorStore } from '@/store/editorStore';

/** 🔍 kétujjas csippentés = zoom (a Timeline-ból kiemelt gesztus-bekötés) */
export function useTimelinePinch(zoom: number, setZoom: EditorState['setZoom']) {
  const zoomStart = useRef(zoom);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      zoomStart.current = useEditorStore.getState().zoom;
    })
    .onUpdate((e) => {
      // 🔍 KVANTÁLT commit: a store-t (és így a teljes Timeline re-rendert) csak
      // érdemi (~4%) skálaváltozásnál írjuk — a pontos érték a pinch végén jön.
      // Így csippentés közben a re-renderek száma töredékére esik; a 2.1 klip-
      // virtualizációval együtt a hosszú idővonal csippentése is folyamatos marad.
      const next = zoomStart.current * e.scale;
      const cur = useEditorStore.getState().zoom;
      if (cur <= 0 || Math.abs(next - cur) / cur >= 0.04) {
        setZoom(next);
      }
    })
    .onEnd((e, success) => {
      // csak SIKERES gesztusnál commitolunk — megszakított/elbukott pinch ne
      // ugrasson egy nem szándékos zoomra (az onEnd success=false-szal is fut)
      if (success) {
        setZoom(zoomStart.current * e.scale);
      }
    })
    .runOnJS(true);

  return pinch;
}

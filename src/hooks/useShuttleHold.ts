import { useEffect, useRef } from 'react';

import { useEditorStore } from '@/store/editorStore';

/** ennyi nyomva tartás után vált 2×-ről 4×-re */
const RAMP_MS = 1200;
export const SHUTTLE_HOLD_DELAY_MS = 300;

/**
 * ⏩ Nyomva tartott gomb = gyors vissza vagy előre, elengedésre megáll a jelenlegi helyen. A sima
 * koppintás a gomb saját művelete marad. A mesteróra mozgatja a lejátszófejet (`shuttle`).
 */
export function useShuttleHold(dir: 1 | -1) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const start = () => {
    const store = useEditorStore.getState();
    held.current = true;
    // az ellentétes irány a létrán 1×-re váltana: a nyomva tartás azonnal 2×-rel induljon
    store.setPlaybackRate(dir);
    store.shuttle(dir);
    timer.current = setTimeout(() => useEditorStore.getState().shuttle(dir), RAMP_MS);
  };
  const stop = () => {
    clear();
    if (held.current) {
      held.current = false;
      const store = useEditorStore.getState();
      store.setPlaying(false);
      store.setPlaybackRate(1);
    }
  };
  useEffect(() => clear, []);
  return { onLongPress: start, onPressOut: stop, delayLongPress: SHUTTLE_HOLD_DELAY_MS };
}

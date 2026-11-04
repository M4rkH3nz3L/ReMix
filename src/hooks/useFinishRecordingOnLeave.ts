import type { AudioRecorder } from 'expo-audio';
import { type MutableRefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { mustStopRecording } from '@/lib/diskSpace';
import { freeDiskBytes } from '@/lib/diskSpaceClient';
import { recordingPhase } from '@/lib/interruption';
import { logCaught } from '@/lib/logCaught';

/** 📞 a rendszer-szüneteltetés figyelése (a JS nem kap eseményt) */
const INTERRUPT_POLL_MS = 250;
/** 💾 a szabad hely ellenőrzése felvétel közben (minden 4. figyelés ≈ 1 mp) */
const SPACE_EVERY = 4;

/**
 * 🎙️ A10/A43: a futó felvétel klip lesz, ha az app háttérbe megy vagy a felület bezárul. A
 * bezáráskori ág layout-effekt, mert a `useAudioRecorder` sima effektje addigra felszabadítja
 * a recordert. A `finish` ref, mert a hívó a befejező függvényt később (render közben) állítja be.
 *
 * 📞 PRO-AUDIO 17/18: hívás vagy Siri alatt az iOS natívan SZÜNETELTETI a felvevőt (az
 * `isRecording` hamis lesz, a felvett rész megmarad) — ezt is lezárjuk klipnek, különben a take
 * a gomb szerint „nem fut”, és a következő felvétel felülírná.
 *
 * 💾 Fogyó tárhelynél (`mustStopRecording`) a take MAGÁTÓL lezárul, mielőtt a lemez betelne;
 * az `onLowSpace` a felhasználónak szól (a felvett rész megmaradt).
 */
export function useFinishRecordingOnLeave(
  recorder: AudioRecorder,
  finish: MutableRefObject<() => Promise<void>>,
  onLowSpace?: () => void
): void {
  const lowSpaceRef = useRef(onLowSpace);
  useEffect(() => {
    lowSpaceRef.current = onLowSpace;
  }, [onLowSpace]);

  // egy take-et egyszer zárunk le (háttér, megszakítás és bezárás egyszerre is jöhet)
  const busy = useRef(false);
  useEffect(() => {
    const close = (where: string) => {
      if (busy.current) {
        return;
      }
      busy.current = true;
      void finish
        .current()
        .catch((caught) => { logCaught(`hooks/useFinishRecordingOnLeave.ts:${where}`, caught); })
        .finally(() => { busy.current = false; });
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && recordingPhase(recorder.getStatus()) !== 'idle') {
        close('background');
      }
    });
    let tick = 0;
    const timer = setInterval(() => {
      try {
        const phase = recordingPhase(recorder.getStatus());
        if (phase === 'interrupted') {
          close('interrupted');
        } else if (phase === 'recording' && ++tick % SPACE_EVERY === 0 && !busy.current && mustStopRecording(freeDiskBytes())) {
          close('lowSpace');
          lowSpaceRef.current?.();
        }
      } catch (caught) {
        logCaught('hooks/useFinishRecordingOnLeave.ts:interrupted', caught);
      }
    }, INTERRUPT_POLL_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [recorder, finish]);

  useLayoutEffect(
    () => () => {
      try {
        if (!busy.current && recordingPhase(recorder.getStatus()) !== 'idle') {
          busy.current = true;
          void finish
            .current()
            .catch((caught) => { logCaught('hooks/useFinishRecordingOnLeave.ts:unmount', caught); })
            .finally(() => { busy.current = false; });
        }
      } catch (caught) {
        logCaught('hooks/useFinishRecordingOnLeave.ts:unmount', caught);
      }
    },
    [recorder, finish]
  );
}

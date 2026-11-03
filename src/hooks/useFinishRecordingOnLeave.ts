import type { AudioRecorder } from 'expo-audio';
import { type MutableRefObject, useEffect, useLayoutEffect } from 'react';
import { AppState } from 'react-native';

import { logCaught } from '@/lib/logCaught';

/**
 * 🎙️ A10/A43: a futó felvétel klip lesz, ha az app háttérbe megy vagy a felület bezárul. A
 * bezáráskori ág layout-effekt, mert a `useAudioRecorder` sima effektje addigra felszabadítja
 * a recordert. A `finish` ref, mert a hívó a befejező függvényt később (render közben) állítja be.
 */
export function useFinishRecordingOnLeave(recorder: AudioRecorder, finish: MutableRefObject<() => Promise<void>>): void {
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && recorder.getStatus().isRecording) {
        void finish.current().catch((caught) => { logCaught('hooks/useFinishRecordingOnLeave.ts:background', caught); });
      }
    });
    return () => sub.remove();
  }, [recorder, finish]);

  useLayoutEffect(
    () => () => {
      try {
        if (recorder.getStatus().isRecording) {
          void finish.current().catch((caught) => { logCaught('hooks/useFinishRecordingOnLeave.ts:unmount', caught); });
        }
      } catch (caught) {
        logCaught('hooks/useFinishRecordingOnLeave.ts:unmount', caught);
      }
    },
    [recorder, finish]
  );
}

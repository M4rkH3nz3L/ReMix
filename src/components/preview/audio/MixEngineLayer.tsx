import { useEffect } from 'react';

import { DEFAULT_METER, projectTiming } from '@/lib/audioTransport';
import { logCaught } from '@/lib/logCaught';
import type { OfflineMixPlan } from '@/lib/offlineMix';
import { previewEngine } from '@/lib/previewEngine';
import { useEditorStore } from '@/store/editorStore';
import { useRecordPrefs } from '@/store/recordPrefsStore';

/**
 * 🎧 „Azt kapod, amit hallasz”: az előre renderelt előnézet (`previewEngine`) bekötése. A terv
 * változására (szerkesztés, mute/solo, fader) a még el nem indult szeletek újrakeverődnek; a
 * lejátszófej a hangórából jön (`usePlaybackClock`); a videók saját hangja néma, mert azt is a
 * motor keveri (`videoVoiceActive`).
 */
export function MixEngineLayer({ plan }: { plan: OfflineMixPlan | null }) {
  const isPlaying = useEditorStore((s) => s.isPlaying && s.playbackRate === 1);
  const setVideoVoiceActive = useEditorStore((s) => s.setVideoVoiceActive);

  useEffect(() => {
    previewEngine.arm(true);
    setVideoVoiceActive(true);
    // 📞 hívás / Siri: a felfüggesztett motorral a transzport is megáll (nem fut tovább némán)
    previewEngine.onInterrupted = () => useEditorStore.getState().setPlaying(false);
    return () => {
      previewEngine.onInterrupted = null;
      previewEngine.arm(false);
      setVideoVoiceActive(false);
    };
  }, [setVideoVoiceActive]);

  useEffect(() => {
    void previewEngine.setPlan(plan).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:MixEngineLayer', caught); });
  }, [plan]);

  // ⏱️ metronóm: a projekt tempóján és ütemjelzésén (csak hallható — az exportba nem kerül)
  const isAudio = useEditorStore((s) => s.project?.kind === 'audio');
  const metronomeOn = useRecordPrefs((s) => s.metronome) && isAudio;
  const metronomeGain = useRecordPrefs((s) => s.metronomeGain);
  const bpm = useEditorStore((s) => s.project?.bpm);
  const beatsPerBar = useEditorStore((s) => (s.project?.timeSignature ?? DEFAULT_METER).beatsPerBar);
  const beatUnit = useEditorStore((s) => (s.project?.timeSignature ?? DEFAULT_METER).beatUnit);
  // 🎼 S13: tempóváltásokkal a klikk a tempo-mapen ül (a tárolt lista referenciája stabil, amíg nem változik)
  const tempoMap = useEditorStore((s) => s.project?.tempoMap);
  useEffect(() => {
    previewEngine.setMetronome(
      metronomeOn
        ? { bpm, meter: { beatsPerBar, beatUnit }, gain: metronomeGain, timing: projectTiming({ bpm, timeSignature: { beatsPerBar, beatUnit }, tempoMap }) }
        : null
    );
  }, [metronomeOn, metronomeGain, bpm, beatsPerBar, beatUnit, tempoMap]);
  useEffect(() => () => previewEngine.setMetronome(null), []);

  useEffect(() => {
    if (isPlaying) {
      void previewEngine.play(useEditorStore.getState().playhead).catch((caught) => { logCaught('components/preview/AudioLayer.tsx:MixEngineLayer', caught); });
    } else {
      previewEngine.pause();
    }
  }, [isPlaying]);

  // ugrás lejátszás közben (scrub, hurok, kattintás a vonalzón): a motor onnan folytatja
  useEffect(
    () =>
      useEditorStore.subscribe((st, prev) => {
        if (st.playhead !== prev.playhead && previewEngine.isPlaying() && Math.abs(st.playhead - previewEngine.position()) > 0.15) {
          previewEngine.seek(st.playhead);
        }
      }),
    []
  );
  return null;
}

import { AudioModule, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import type { TFunction } from 'i18next';
import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { MIN_CLIP_DURATION } from '@/constants/editor';
import { useFinishRecordingOnLeave } from '@/hooks/useFinishRecordingOnLeave';
import { nextCountInBars, nextMetronomeLevel } from '@/lib/audioStudioOps';
import { DEFAULT_BPM, DEFAULT_METER, type Meter } from '@/lib/audioTransport';
import { editGridRate } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { recordingPhase } from '@/lib/interruption';
import { logCaught } from '@/lib/logCaught';
import { metronomeWindow, openTakePlacement, punchCommands, punchWindow } from '@/lib/punchRecord';
import { nextHot } from '@/lib/recordingMeter';
import { alignCountInTake, alignPunchTake, PunchSession, runCountIn } from '@/lib/recordTakeClient';
import { pauseVoiceRecording, prepareVoiceRecording, resumeVoiceRecording, startVoiceRecording, stopVoiceRecording, VOICE_RECORDING_OPTIONS, voiceoverClip } from '@/lib/voiceRecording';
import { useEditorStore } from '@/store/editorStore';
import { METRONOME_LEVELS, useRecordPrefs } from '@/store/recordPrefsStore';
import type { Project } from '@/types/project';

/**
 * 🎙️ A hang-stúdió felvétele a voiceover sávra (a playheadnél kezd, a hosszt a felvevő adja): szünet/folytatás,
 * előszámlálás, metronómos és punch-in felvétel, „túl hangos” jelzés. A10: a felvétel akkor is klip lesz, ha az
 * app háttérbe megy vagy a képernyő bezárul. A `project`/`playhead` a hívó renderjéből jön (a rács, a tempó és az
 * ütemjelzés ebből számol, mint a törzsben).
 */
export function useStudioRecording({ t, project, playhead }: { t: TFunction; project: Project | null; playhead: number }) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 100);
  // ⏸️ a felhasználói szünet (a felvevő ilyenkor nem „isRecording”, de a take él és folytatható)
  const [recPaused, setRecPaused] = useState(false);
  const recPausedRef = useRef(false);
  recPausedRef.current = recPaused;
  // ⏱️🎯 count-in / punch-in: élesítve (a punch preroll-ja alatt a felvevő még nem fut), és a módok állapota
  const [recArmed, setRecArmed] = useState(false);
  const [recCountingIn, setRecCountingIn] = useState(false);
  const punchRef = useRef<PunchSession | null>(null);
  const countInRef = useRef<{ trim: number | null; alive: boolean; bars: number; bpm: number | undefined; meter: Meter } | null>(null);
  const recActive = recorderState.isRecording || recPaused || recArmed;
  // 🔴 „túl hangos”: egyszer bekapcsol, a take végéig marad
  const recHotRef = useRef(false);
  if (recorderState.isRecording) recHotRef.current = nextHot(recHotRef.current, recorderState.metering);
  const recHot = recHotRef.current;
  const recordStartPlayhead = useRef(0);

  const finishRecordingRef = useRef<() => Promise<void>>(async () => {});
  useFinishRecordingOnLeave(
    recorder,
    finishRecordingRef,
    () => Alert.alert(t('panels.audio.noSpaceTitle'), t('panels.audio.lowSpaceStopped')),
    recPausedRef
  );

  // 🎧 V6: a szerkesztési rács (a felvétel helye ezen), a tempó és az ütemjelzés — mint a törzsben
  const grid = editGridRate(project);
  const bpm = project?.bpm ?? DEFAULT_BPM;
  const meter = project?.timeSignature ?? DEFAULT_METER;

  // 🎙️ felvétel a voiceover sávra — a playheadnél kezd, a hosszt a felvevő adja
  // 🎙️ A10: a felvétel akkor is klip lesz, ha az app háttérbe megy vagy a képernyő bezárul
  const finishRecording = async () => {
    setRecPaused(false);
    recPausedRef.current = false;
    recHotRef.current = false;
    setRecArmed(false);
    setRecCountingIn(false);
    const punch = punchRef.current;
    punchRef.current = null;
    punch?.halt();
    const countIn = countInRef.current;
    countInRef.current = null;
    if (countIn) countIn.alive = false;
    const { uri, seconds } = await stopVoiceRecording(recorder);
    if (!uri) return;
    const label = t('panels.audio.voiceoverLabel');
    const st = useEditorStore.getState();
    if (punch?.open) {
      // ⏱️ metronómos felvétel: a take a lejátszófejtől (In) szól, a felvevő idejéből igazítva — kivágás nélkül
      const clockStart = punch.recording ? punch.startAt() : null;
      if (clockStart === null || !st.project) return;
      const end = clockStart + seconds;
      const startAt = await alignPunchTake(st.project, 'voiceover', uri, clockStart, { ...punch.win, out: end, stopAt: end }, st.isTrackAudible);
      const place = openTakePlacement({ seconds, startAt }, punch.win.in);
      if (!place) return;
      const { clip, asset } = voiceoverClip(uri, seconds, place.start, grid, label, makeId);
      st.addClip('voiceover', { ...clip, start: place.start, trimIn: place.trimIn, duration: place.duration }, asset);
      return;
    }
    if (punch) {
      // 🎯 punch: a klip pontosan In-től Out-ig (a felvevő idejéből), alatta kivágva — egy undo
      const clockStart = punch.recording ? punch.startAt() : null;
      if (clockStart === null || !st.project) return;
      // a take oda, amihez a felhasználó énekelt: a közben szóló klip áthallásához igazítva
      const startAt = await alignPunchTake(st.project, 'voiceover', uri, clockStart, punch.win, st.isTrackAudible);
      const cmds = punchCommands(st.project, 'voiceover', { uri, seconds, startAt, label }, punch.win, makeId);
      if (cmds.length > 0) st.applyBatch(cmds, 'user');
      return;
    }
    const { clip, asset } = voiceoverClip(uri, seconds, recordStartPlayhead.current, grid, label, makeId);
    if (countIn) {
      // ⏱️ az előszámlálás kimarad: a take ott kezdődik, ahol a következő ütés lenne (a felvevő idejében)
      if (countIn.trim === null) return;
      // a levágás a ténylegesen hallott kattanásokhoz igazítva (a lejátszó és a hangszóró késése)
      const trim = await alignCountInTake(uri, countIn.bars, countIn.bpm, countIn.meter, countIn.trim);
      if (seconds - trim < MIN_CLIP_DURATION) return;
      st.addClip('voiceover', { ...clip, trimIn: trim, duration: seconds - trim }, asset);
      return;
    }
    st.addClip('voiceover', clip, asset);
  };
  // a projekt nélküli (még töltődő) renderben a törzs sem állította be — ugyanígy
  if (project) finishRecordingRef.current = finishRecording;

  /** kilépéskor a futó felvétel klip lesz, nem vész el: a lezárás ígérete (nem futó felvételnél azonnal kész) */
  const finishIfRecording = () =>
    recordingPhase(recorder.getStatus(), recPausedRef.current) !== 'idle' ? finishRecording() : Promise.resolve();

  const toggleRecord = async () => {
    // a szüneteltetett take is fut: a gomb leállítja (nem indít újat, ami felülírná)
    if (recActive) {
      await finishRecording();
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('panels.audio.micPermissionTitle'), t('panels.audio.micPermissionMessage'));
      return;
    }
    const prefs = useRecordPrefs.getState();
    const st = useEditorStore.getState();
    try {
      if (prefs.punch) {
        const win = punchWindow(st.rangeIn, st.rangeOut);
        if (!win) {
          Alert.alert(t('studio.audio.rec.options'), t('studio.audio.rec.noRange'));
          return;
        }
        await prepareVoiceRecording(recorder);
        const session = new PunchSession(recorder, win, () => void finishRecordingRef.current());
        punchRef.current = session;
        setRecArmed(true);
        session.start();
        return;
      }
      if (prefs.metronome) {
        // ⏱️ metronómmal: a lejátszás (a többi sávval és a klikkel) a lejátszófej előtt az előszámlálásnyival
        // indul, a felvevő a lejátszófejnél — a take a punch-mérés szerint igazodik, nyitott véggel
        await prepareVoiceRecording(recorder);
        const session = new PunchSession(recorder, metronomeWindow(playhead, prefs.countInBars, bpm, meter), () => void finishRecordingRef.current(), true);
        punchRef.current = session;
        setRecArmed(true);
        session.start();
        return;
      }
      recordStartPlayhead.current = playhead;
      await startVoiceRecording(recorder);
      if (prefs.countInBars > 0) {
        const ci = { trim: null as number | null, alive: true, bars: prefs.countInBars, bpm, meter };
        countInRef.current = ci;
        setRecCountingIn(true);
        void runCountIn(recorder, prefs.countInBars, bpm, meter, () => ci.alive)
          .then((trim) => {
            if (ci.alive) ci.trim = trim;
          })
          .catch((caught) => logCaught('components/studio/audio/AudioStudioBody.tsx:countIn', caught))
          .finally(() => setRecCountingIn(false));
      }
    } catch (caught) {
      // 💾 kevés hely / foglalt mikrofon: érthető üzenet, a felvétel nem indul
      logCaught('components/studio/audio/AudioStudioBody.tsx:toggleRecord', caught);
      Alert.alert(t('panels.audio.recordFailedTitle'), caught instanceof Error ? caught.message : String(caught));
    }
  };

  // 🎙️ hosszú nyomás a felvétel-gombon: előszámlálás (ki / 1 / 2 ütem) és punch-in
  const recordOptions = () => {
    const p = useRecordPrefs.getState();
    const ci = p.countInBars === 0 ? t('studio.audio.rec.off') : t('studio.audio.rec.bars', { count: p.countInBars });
    Alert.alert(t('studio.audio.rec.options'), undefined, [
      { text: t('studio.audio.rec.countIn', { v: ci }), onPress: () => { p.setCountIn(nextCountInBars(p.countInBars)); recordOptions(); } },
      { text: t('studio.audio.rec.punch', { v: t(p.punch ? 'studio.audio.rec.on' : 'studio.audio.rec.off') }), onPress: () => { p.setPunch(!p.punch); recordOptions(); } },
      {
        text: t('studio.audio.rec.metronomeLevel', { v: Math.round(p.metronomeGain * 100) }),
        onPress: () => {
          p.setMetronomeGain(nextMetronomeLevel(METRONOME_LEVELS, p.metronomeGain) as (typeof METRONOME_LEVELS)[number]);
          recordOptions();
        },
      },
      { text: t('studio.audio.rec.done'), style: 'cancel' },
    ]);
  };

  const pauseResumeRecording = () => {
    if (recorderState.isRecording) {
      pauseVoiceRecording(recorder);
      recPausedRef.current = true;
      setRecPaused(true);
    } else if (recPaused) {
      resumeVoiceRecording(recorder);
      recPausedRef.current = false;
      setRecPaused(false);
    }
  };

  /** 🧪 füstteszt: a felvételi sáv állapota */
  const recordState = () => ({ active: recActive, recording: recorderState.isRecording, paused: recPaused, metering: recorderState.metering, hot: recHot, durationMillis: recorderState.durationMillis });

  return {
    recorderState,
    recActive,
    recPaused,
    recArmed,
    recCountingIn,
    recHot,
    punchRef,
    finishIfRecording,
    toggleRecord,
    recordOptions,
    pauseResumeRecording,
    recordState,
  };
}

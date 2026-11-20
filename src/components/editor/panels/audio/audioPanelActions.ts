import { AudioModule, type AudioRecorder } from 'expo-audio';
import type { TFunction } from 'i18next';
import type { MutableRefObject } from 'react';
import { Alert } from 'react-native';

import type { useTtsEngine } from '@/hooks/useTtsEngine';
import { audioIntakeText } from '@/lib/audioIntake';
import { beatSourceClip, dubCaptions, dubText } from '@/lib/audioPanelOps';
import { detectBeats, timelineBeats } from '@/lib/beats';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { pickAudio } from '@/lib/media';
import { downloadTrack, type LibraryTrack } from '@/lib/render';
import { startVoiceRecording, stopVoiceRecording, voiceoverClip } from '@/lib/voiceRecording';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import type { AudioClip } from '@/types/project';

/**
 * A hang-panel hook nélküli akció-gyárai (REFACTOR: az AudioPanel.tsx-ből): a
 * gyökér állapotát és settereit kapják, a store-t a hívás pillanatában olvassák.
 */

export interface BeatActionDeps {
  clip: AudioClip | null;
  beatMode: 'beat' | 'downbeat';
  setBeatBusy: (busy: boolean) => void;
  t: TFunction;
}

/** 🥁 beat → marker / vágás */
export function createBeatActions({ clip, beatMode, setBeatBusy, t }: BeatActionDeps) {
  /**
   * A beat-rács forrása: a zenesáv első klipje (vagy a kijelölt hangklip). A
   * detektálás fájlonként cache-elt; ha még nincs rács a store-ban, itt kérjük le.
   */
  const beatSource = (): AudioClip | null => beatSourceClip(useEditorStore.getState().project, clip);
  const ensureBeats = async (): Promise<boolean> => {
    const st = useEditorStore.getState();
    if (st.beatTimes.length > 0) {
      return true;
    }
    const src = beatSource();
    if (!src) {
      return false;
    }
    setBeatBusy(true);
    try {
      const grid = await detectBeats(src.uri);
      if (!grid || grid.beats.length === 0) {
        return false;
      }
      st.setBeatGrid(timelineBeats(src, grid.beats), timelineBeats(src, grid.downbeats));
      return true;
    } finally {
      setBeatBusy(false);
    }
  };
  const runBeatMarkers = async () => {
    if (!(await ensureBeats())) {
      Alert.alert(t('panels.audio.beatTitle'), t('panels.audio.beatNone'));
      return;
    }
    const n = useEditorStore.getState().markersFromBeats(beatMode);
    Alert.alert(t('panels.audio.beatTitle'), t('panels.audio.beatMarkersDone', { count: n }));
  };
  const runBeatCuts = async () => {
    if (!(await ensureBeats())) {
      Alert.alert(t('panels.audio.beatTitle'), t('panels.audio.beatNone'));
      return;
    }
    useEditorStore.getState().cutsFromBeats(beatMode);
  };
  return { runBeatMarkers, runBeatCuts };
}

export interface RecordActionDeps {
  recorder: AudioRecorder;
  isRecording: boolean;
  recordStartPlayhead: MutableRefObject<number>;
  finishRecordingRef: MutableRefObject<() => Promise<void>>;
  t: TFunction;
}

/** 🎙️ voiceover-felvétel (A43: ugyanaz az út, mint a Hang Stúdióban) */
export function createRecordActions({ recorder, isRecording, recordStartPlayhead, finishRecordingRef, t }: RecordActionDeps) {
  const finishRecording = async () => {
    const { uri, seconds } = await stopVoiceRecording(recorder);
    if (uri) {
      const st = useEditorStore.getState();
      const { clip, asset } = voiceoverClip(uri, seconds, recordStartPlayhead.current, st.project?.fps ?? 30, t('panels.audio.voiceoverLabel'), makeId);
      st.addClip('voiceover', clip, asset);
    }
  };

  const toggleRecord = async () => {
    if (isRecording) {
      await finishRecordingRef.current();
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('panels.audio.micPermissionTitle'), t('panels.audio.micPermissionMessage'));
      return;
    }
    recordStartPlayhead.current = useEditorStore.getState().playhead;
    try {
      await startVoiceRecording(recorder);
    } catch (caught) {
      // 💾 kevés hely / foglalt mikrofon: érthető üzenet, a felvétel nem indul
      logCaught('components/editor/panels/AudioPanel.tsx:toggleRecord', caught);
      Alert.alert(t('panels.audio.recordFailedTitle'), caught instanceof Error ? caught.message : String(caught));
    }
  };
  return { finishRecording, toggleRecord };
}

export interface AddAudioActionDeps {
  addClip: EditorState['addClip'];
  busyTrack: string | null;
  setBusyTrack: (id: string | null) => void;
  t: TFunction;
}

/** 🎵 hangklip hozzáadása: könyvtárból, saját fájlból, generált hangból */
export function createAddAudioActions({ addClip, busyTrack, setBusyTrack, t }: AddAudioActionDeps) {
  const addAudioClip = (
    uri: string,
    label: string,
    duration: number,
    provider: 'local' | 'library' = 'local',
    trackType: 'music' | 'voiceover' | 'sfx' = 'music'
  ) => {
    addClip(
      trackType,
      {
        kind: 'audio',
        id: makeId('clip'),
        start: useEditorStore.getState().playhead,
        duration: Math.max(duration, 0.3),
        uri,
        label,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        source: 'imported',
      },
      {
        id: makeId('ast'),
        kind: 'audio',
        uri,
        provider,
        name: label,
        duration: Math.max(duration, 0.3),
      }
    );
  };

  const addFromLibrary = (track: LibraryTrack) => {
    if (busyTrack) {
      return;
    }
    setBusyTrack(track.id);
    // 🔁 2026-11-14: a szerveres könyvtár letöltése Pro → Free-ben a Pro-ajánlat nyílik (guardPro)
    void guardPro(
      () =>
        downloadTrack(track).then((uri) =>
          addAudioClip(
            uri,
            track.name,
            track.duration,
            'library',
            // az SFX-ek a saját sávjukra kerülnek, a zenék a zenesávra
            track.kind === 'sfx' ? 'sfx' : 'music'
          )
        ),
      (caught) => {
        logCaught('components/editor/panels/AudioPanel.tsx:addFromLibrary', caught);
        Alert.alert(t('common.error'), t('panels.audio.downloadFailed'));
      }
    ).finally(() => setBusyTrack(null));
  };

  const importOwn = async () => {
    const picked = await pickAudio();
    if (picked) {
      if (!picked.intake.ok) {
        Alert.alert(t('studio.audio.intake.unreadableTitle'), audioIntakeText(picked.intake, t));
        return;
      }
      // a TELJES fájlt importáljuk a valós hosszával (a user utólag trimmelheti)
      addAudioClip(picked.uri, picked.name, picked.duration);
    }
  };
  return { addAudioClip, addFromLibrary, importOwn };
}

export interface TtsActionDeps {
  tts: ReturnType<typeof useTtsEngine>;
  ttsText: string;
  setTtsText: (text: string) => void;
  ttsBusy: boolean;
  setTtsBusy: (busy: boolean) => void;
  addAudioClip: ReturnType<typeof createAddAudioActions>['addAudioClip'];
  t: TFunction;
}

/** 🗣️ AI-hang (TTS) és dub feliratokból */
export function createTtsActions({ tts, ttsText, setTtsText, ttsBusy, setTtsBusy, addAudioClip, t }: TtsActionDeps) {
  const generateVoice = () => {
    const text = ttsText.trim();
    if (!text || ttsBusy) {
      return;
    }
    setTtsBusy(true);
    const run = async () => {
      const { uri, duration } = await tts.generate(text);
      addAudioClip(uri, t('panels.audio.aiVoiceLabel'), duration, 'local', 'voiceover');
      setTtsText('');
    };
    (tts.needsPro ? guardPro(run, (err) => Alert.alert(t('panels.audio.aiVoiceLabel'), err.message)) : run())
      .catch((err: Error) => { logCaught('components/editor/panels/AudioPanel.tsx:generateVoice', err); return Alert.alert(t('panels.audio.aiVoiceLabel'), err.message); })
      .finally(() => setTtsBusy(false));
  };

  /**
   * 🎙️ Dub feliratokból (Phase 4.3): a felirat-sáv szövegéből (ami a 4.2-vel
   * akár lefordított is lehet) AI-narrációt generál a kiválasztott hanggal, és a
   * beszéd kezdetéhez időzítve a voiceover-sávra teszi. EGY narrációs sáv (nem
   * per-szegmens lip-sync); az eredeti hang halkítása a mixerből. Pro (TTS).
   */
  const runDub = async () => {
    if (ttsBusy) {
      return;
    }
    const state = useEditorStore.getState();
    const caps = dubCaptions(state.project);
    if (caps.length === 0) {
      Alert.alert(t('panels.audio.dubTitle'), t('panels.audio.dubNoCaptions'));
      return;
    }
    const text = dubText(caps);
    setTtsBusy(true);
    try {
      const run = async () => {
        const { uri, duration } = await tts.generate(text);
        state.setPlayhead(Math.max(0, caps[0].start));
        addAudioClip(uri, t('panels.audio.dubLabel'), duration, 'local', 'voiceover');
        Alert.alert(t('panels.audio.dubTitle'), t('panels.audio.dubDone'));
      };
      if (tts.needsPro) await guardPro(run, (e) => Alert.alert(t('panels.audio.dubTitle'), e.message));
      else await run();
    } finally {
      setTtsBusy(false);
    }
  };
  return { generateVoice, runDub };
}

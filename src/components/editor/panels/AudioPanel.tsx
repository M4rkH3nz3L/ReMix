import { RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Text, View } from 'react-native';

import { AudioFxSection } from '@/components/editor/panels/audio/AudioFxSection';
import { OwnFileSection, VoiceoverSection } from '@/components/editor/panels/audio/AudioSourceSections';
import { BeatSection } from '@/components/editor/panels/audio/BeatSection';
import { ClipMixSection } from '@/components/editor/panels/audio/ClipMixSection';
import { LibrarySection } from '@/components/editor/panels/audio/LibrarySection';
import { TtsSection } from '@/components/editor/panels/audio/TtsSection';
import {
  createAddAudioActions,
  createBeatActions,
  createRecordActions,
  createTtsActions,
} from '@/components/editor/panels/audio/audioPanelActions';
import { styles } from '@/components/editor/panels/audio/audioStyles';
import { useFinishRecordingOnLeave } from '@/hooks/useFinishRecordingOnLeave';
import { useTtsEngine } from '@/hooks/useTtsEngine';
import { logCaught } from '@/lib/logCaught';
import { fetchSoundLibrary } from '@/lib/render';
import type { LibraryTrack } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

/**
 * Hang-panel: voiceover-felvétel közvetlenül az appból + a kijelölt hangklip
 * keverése (hangerő, fade in/out).
 */
export function AudioPanel({ clip }: { clip: AudioClip | null }) {
  const { t, i18n } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const addClip = useEditorStore((s) => s.addClip);
  // 🔗 a klip assetjének forrása (linked asset); az asset-objektum referenciája stabil, amíg a projekt nem változik
  const linkedSource = useEditorStore((s) => (clip?.assetId ? s.project?.assets.find((a) => a.id === clip.assetId)?.source : undefined));
  // 🥁 beat → marker / vágás
  const suggestedCuts = useEditorStore((s) => s.suggestedCuts);
  const hasAudio = useEditorStore((s) =>
    (s.project?.tracks ?? []).some(
      (tk) => (tk.type === 'music' || tk.type === 'voiceover' || tk.type === 'sfx') && tk.clips.length > 0
    )
  );
  const [beatMode, setBeatMode] = useState<'beat' | 'downbeat'>('downbeat');
  const [beatBusy, setBeatBusy] = useState(false);
  const playhead = useEditorStore((s) => s.playhead);

  const { runBeatMarkers, runBeatCuts } = createBeatActions({ clip, beatMode, setBeatBusy, t });

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder);
  const recordStartPlayhead = useRef(0);
  // A43: ugyanaz a felvétel-út, mint a Hang Stúdióban (mód-visszaállítás, frame-rács, megmaradás)
  const finishRecordingRef = useRef<() => Promise<void>>(async () => {});
  useFinishRecordingOnLeave(recorder, finishRecordingRef, () =>
    Alert.alert(t('panels.audio.noSpaceTitle'), t('panels.audio.lowSpaceStopped'))
  );
  const { finishRecording, toggleRecord } = createRecordActions({
    recorder,
    isRecording: recorderState.isRecording,
    recordStartPlayhead,
    finishRecordingRef,
    t,
  });
  finishRecordingRef.current = finishRecording;

  const [library, setLibrary] = useState<LibraryTrack[] | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  // 🎵 videóhoz-illesztés: a könyvtár rangsorolása a projekt energiájához
  const [matchMode, setMatchMode] = useState(false);

  // 🗣️ AI-hang (TTS)
  const [ttsText, setTtsText] = useState('');
  const [ttsBusy, setTtsBusy] = useState(false);
  // 📱 a telefon hangja (offline, minden szinten); szerveres hang csak tartalékként (Pro)
  const tts = useTtsEngine(i18n.language);
  const ttsAvailable = tts.available;

  useEffect(() => {
    fetchSoundLibrary()
      .then(setLibrary)
      .catch((caught) => { logCaught('components/editor/panels/AudioPanel.tsx:AudioPanel', caught); return setLibraryError(true); });
  }, []);

  const { addAudioClip, addFromLibrary, importOwn } = createAddAudioActions({ addClip, busyTrack, setBusyTrack, t });
  const { generateVoice, runDub } = createTtsActions({ tts, ttsText, setTtsText, ttsBusy, setTtsBusy, addAudioClip, t });

  return (
    <View>
      <LibrarySection
        library={library}
        libraryError={libraryError}
        project={useEditorStore.getState().project}
        matchMode={matchMode}
        setMatchMode={setMatchMode}
        busyTrack={busyTrack}
        addFromLibrary={addFromLibrary}
      />

      <OwnFileSection importOwn={importOwn} />

      <VoiceoverSection
        isRecording={recorderState.isRecording}
        durationMillis={recorderState.durationMillis}
        toggleRecord={toggleRecord}
      />

      <TtsSection
        ttsAvailable={ttsAvailable}
        ttsText={ttsText}
        setTtsText={setTtsText}
        choices={tts.choices}
        selected={tts.selected}
        setSelected={tts.setSelected}
        ttsBusy={ttsBusy}
        generateVoice={generateVoice}
        runDub={runDub}
      />

      {hasAudio ? (
        <BeatSection
          beatMode={beatMode}
          setBeatMode={setBeatMode}
          beatBusy={beatBusy}
          suggestedCutCount={suggestedCuts.length}
          runBeatMarkers={runBeatMarkers}
          runBeatCuts={runBeatCuts}
        />
      ) : null}

      {clip ? (
        <>
          <ClipMixSection clip={clip} linkedSource={linkedSource} playhead={playhead} updateClip={updateClip} />
          <AudioFxSection clip={clip} updateClip={updateClip} />
        </>
      ) : (
        <Text style={styles.note}>
          {t('panels.audio.emptyHint')}
        </Text>
      )}
    </View>
  );
}

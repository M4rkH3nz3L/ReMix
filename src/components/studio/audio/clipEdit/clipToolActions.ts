import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { startSilenceSearch } from '@/components/studio/audio/SilenceReview';
import { startSpeechEdit } from '@/components/studio/audio/SpeechEditBar';
import { startAudioSync } from '@/components/studio/audio/audioSyncAction';
import { renderClipSpectrum } from '@/lib/audioSpectrum';
import { stemSeparationCommands } from '@/lib/clipEditOps';
import { makeId } from '@/lib/id';
import { separateStems } from '@/lib/stems';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import type { AudioClip } from '@/types/project';

/** a lap eszközei: spektrum, csend-keresés, szöveges vágás, szinkron, stem-szeparáció */
export interface ClipToolDeps {
  clip: AudioClip;
  fps: number;
  t: TFunction;
  onClose: () => void;
  applyBatch: EditorState['applyBatch'];
  setSeparating: (v: boolean) => void;
  specBusy: boolean;
  setSpecBusy: (v: boolean) => void;
  setSpectrumUri: (uri: string | null) => void;
}

export function createClipToolActions({ clip, fps, t, onClose, applyBatch, setSeparating, specBusy, setSpecBusy, setSpectrumUri }: ClipToolDeps) {
  // 🎚️ AI stem-szeparáció (Pro): a klip hangját vocals/drums/bass/other klipekre
  // bontja (voiceover/sfx sávra), és az eredetit elnémítja — EGY undo.
  const onSeparate = () =>
    guardPro(
      () =>
        withProgress(t('studio.audio.stemsWorking'), () => {
          setSeparating(true);
          return separateStems(clip.uri).then((stems) => {
            const commands = stemSeparationCommands(clip, stems, () => makeId('clip'));
            applyBatch(commands, 'user');
            onClose();
          });
        }),
      (e) => Alert.alert(t('studio.audio.stems'), e.message)
    ).finally(() => setSeparating(false));

  const showSpectrum = async () => {
    if (specBusy) {
      return;
    }
    setSpecBusy(true);
    try {
      const uri = await renderClipSpectrum(clip.uri);
      setSpectrumUri(uri);
      if (!uri) {
        Alert.alert(t('studio.audio.spectrum', { defaultValue: 'Spektrum' }), t('studio.pianoRoll.failed', { defaultValue: 'A render nem sikerült (fut a render-worker?).' }));
      }
    } finally {
      setSpecBusy(false);
    }
  };

  // 🔇 csendek keresése → jóváhagyás az idővonalon
  const findSilence = () => {
    const track = useEditorStore.getState().project?.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id));
    if (!track) return;
    onClose();
    void startSilenceSearch(clip, track.type, fps, t);
  };

  // ✂️💬 szöveges vágás: a sáv átirata az idővonal alatt
  const openSpeechEdit = () => {
    const track = useEditorStore.getState().project?.tracks.find((tr) => tr.clips.some((c) => c.id === clip.id));
    if (!track) return;
    onClose();
    void startSpeechEdit(track.type, t);
  };

  // 🔗 külső hang szinkronja a hangja alapján
  const openAudioSync = () => {
    onClose();
    startAudioSync(clip, fps, t);
  };

  return { onSeparate, showSpectrum, findSilence, openSpeechEdit, openAudioSync };
}

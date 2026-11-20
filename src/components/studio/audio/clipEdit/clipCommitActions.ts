import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { clipDonePatch, pendingSettingsPatch, type ClipEditSettings } from '@/lib/clipEditOps';
import { selectTakeCommand } from '@/lib/punchRecord';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

/** a lap helyi állapotának mentése (take-választás, tempó-illesztés, „Kész”) — a command buson */
export interface ClipCommitDeps {
  clip: AudioClip;
  fps: number;
  t: TFunction;
  settings: ClipEditSettings;
  dirty: boolean;
  sourceDuration: number;
  updateClip: EditorState['updateClip'];
  onClose: () => void;
}

export function createClipCommitActions({ clip, fps, t, settings, dirty, sourceDuration, updateClip, onClose }: ClipCommitDeps) {
  // 🎙️🔁 take-választás: a függő (nem vágási) beállítások előbb mentődnek, aztán a take — a lap az
  // új take adataival épül újra (a kulcsa az aktív take)
  const pickTake = (takeId: string) => {
    if (dirty) {
      updateClip(clip.id, pendingSettingsPatch(clip, settings));
    }
    const cmd = selectTakeCommand(clip, takeId);
    if (cmd) useEditorStore.getState().dispatch(cmd);
  };

  // 🥁↔️ ütemhez nyújtás: a forrás-tempó → sebesség (hangmagasság-tartással), a forrás-szakasz marad
  const applyTempo = (patch: Partial<AudioClip> | null) => {
    if (!patch) {
      Alert.alert(t('studio.audio.tempo.title'), t('studio.audio.tempo.outOfRange'));
      return;
    }
    if (dirty) {
      updateClip(clip.id, pendingSettingsPatch(clip, settings));
    }
    useEditorStore.getState().dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch });
  };

  const onDone = () => {
    if (dirty) {
      updateClip(clip.id, clipDonePatch(clip, settings, fps, sourceDuration));
    }
    onClose();
  };

  return { pickTake, applyTempo, onDone };
}

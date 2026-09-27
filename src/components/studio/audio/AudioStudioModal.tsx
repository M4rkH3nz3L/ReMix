import { useEffect } from 'react';
import { Modal } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AudioStudioBody } from '@/components/studio/audio/AudioStudioBody';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Clip } from '@/types/project';

/**
 * 🎧 A KÖZÖS hang-stúdió a videó-editorból (scoped mód). A régi `HangStudio`
 * helyére lép: ugyanaz az `AudioStudioBody` fut, csak Modalként a JELENLEGI videó-
 * projekt hang-sávjain (music/voiceover/sfx) — NEM tölt újra, ugyanaz a store, így
 * a szerkesztés azonnal visszahat a videó-timeline-ra és undo-zható. A lejátszó
 * (`AudioLayer`) + a rAF-óra a videó-editor előnézetéből jön — itt NEM duplázzuk.
 *
 * A `audioStudioClipId` a fókusz-klip (az `openAudioStudio` állítja). Csak
 * HANGKLIPRE nyílik; videóklip hangját előbb le kell választani (detach → új
 * AudioClip), és arra fókuszálva nyílik.
 */
export function AudioStudioModal() {
  const clipId = useEditorStore((s) => s.audioStudioClipId);
  const project = useEditorStore((s) => s.project);
  const close = useEditorStore((s) => s.closeAudioStudio);

  let clip: Clip | null = null;
  if (clipId && project) {
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        clip = found;
        break;
      }
    }
  }
  const open = clip?.kind === 'audio';

  // nyitáskor a fókusz-klipre ugrunk + kijelöljük (a szerkesztő-lapot a felhasználó
  // a „Szerkeszt" gombbal nyitja); a store-akciók nem React-setState-ek
  useEffect(() => {
    if (open && clip) {
      const audio = clip as AudioClip;
      useEditorStore.getState().selectClip(audio.id);
      useEditorStore.getState().setPlayhead(audio.start);
    }
  }, [open, clipId]);

  return (
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      {open ? (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <SafeAreaView style={{ flex: 1, backgroundColor: '#05060a' }} edges={['top', 'bottom']}>
            <AudioStudioBody mode="scoped" title={project?.name ?? ''} onExit={close} />
          </SafeAreaView>
        </SafeAreaProvider>
      ) : null}
    </Modal>
  );
}

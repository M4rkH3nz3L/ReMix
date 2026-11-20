import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ToggleRow } from '@/components/studio/audio/primitives';
import { clipEditStyles as styles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { loopTogglePatch } from '@/lib/clipEditOps';
import type { EditorState } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

/** 🔁 loop-klip (élőben a klipre) + a beszéd-javítók kapcsolói (a lap helyi állapotán) */
export function ClipToggleSection({
  clip,
  updateClip,
  voiceEnhance,
  setVoiceEnhance,
  deReverb,
  setDeReverb,
  autoDuck,
  setAutoDuck,
}: {
  clip: AudioClip;
  updateClip: EditorState['updateClip'];
  voiceEnhance: boolean;
  setVoiceEnhance: (v: boolean) => void;
  deReverb: boolean;
  setDeReverb: (v: boolean) => void;
  autoDuck: boolean;
  setAutoDuck: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🔁 loop-klip: a jelenlegi szakasz ismétlődik, a jobb él a forrás végén túl is húzható */}
      {(clip.speed ?? 1) === 1 && !clip.reversed ? (
        <ToggleRow
          icon="repeat-outline"
          label={t('studio.audio.loopClip')}
          value={!!clip.loopLength}
          onValueChange={(on) => updateClip(clip.id, loopTogglePatch(clip, on))}
        />
      ) : null}

      <View style={styles.divider} />
      <ToggleRow icon="sparkles-outline" label={t('studio.audio.enhance')} value={voiceEnhance} onValueChange={setVoiceEnhance} />
      <ToggleRow icon="mic-outline" label={t('studio.audio.deReverb')} value={deReverb} onValueChange={setDeReverb} />
      <ToggleRow icon="volume-low-outline" label={t('studio.audio.autoDuck')} value={autoDuck} onValueChange={setAutoDuck} />
    </>
  );
}

import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { styles } from '@/components/editor/panels/audio/audioStyles';
import { Chip, PanelSection, PrimaryButton, Stepper } from '@/components/ui/controls';
import { panLabel, stepFade, stepPan } from '@/lib/audioPanelOps';
import { formatDb, stepClipVolume } from '@/lib/clipGain';
import { clamp } from '@/lib/time';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import type { AssetSource, AudioClip } from '@/types/project';

export interface ClipMixSectionProps {
  clip: AudioClip;
  linkedSource: AssetSource | undefined;
  playhead: number;
  updateClip: EditorState['updateClip'];
}

/** 🔗 a kijelölt hangklip forrása + keverése (hangerő, fade, pásztázás, hangerő-automáció) */
export function ClipMixSection({ clip, linkedSource, playhead, updateClip }: ClipMixSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🔗 C2: a klip egy másik (hang-)projekt mixdownjára hivatkozik → a forrás szerkesztése a Hang Stúdióban */}
      {linkedSource ? (
        <PanelSection title={t('panels.audio.source.linked', { name: linkedSource.name ?? '' })}>
          <PrimaryButton
            icon="link-outline"
            label={t('panels.audio.source.edit')}
            onPress={() => router.push(`/studio/audio/${linkedSource.projectId}`)}
          />
        </PanelSection>
      ) : null}
      <PanelSection title={t('panels.audio.mixTitle', { label: clip.label })}>
        <PrimaryButton
          icon="options-outline"
          label={t('panels.audio.openHangStudio')}
          onPress={() => useEditorStore.getState().openAudioStudio(clip.id)}
        />
        {/* a Hang Stúdió klipszerkesztőjével azonos szabályok: dB-skála (+12 dB-ig), a fade a klip feléig */}
        <Stepper
          label={t('panels.audio.volume')}
          value={formatDb(clip.volume)}
          onDec={() => updateClip(clip.id, { volume: stepClipVolume(clip.volume, -1) })}
          onInc={() => updateClip(clip.id, { volume: stepClipVolume(clip.volume, 1) })}
        />
        <Stepper
          label="Fade in"
          value={t('panels.audio.seconds', { value: clip.fadeIn.toFixed(1) })}
          onDec={() => updateClip(clip.id, { fadeIn: stepFade(clip.fadeIn, clip.duration, -1) })}
          onInc={() => updateClip(clip.id, { fadeIn: stepFade(clip.fadeIn, clip.duration, 1) })}
        />
        <Stepper
          label="Fade out"
          value={t('panels.audio.seconds', { value: clip.fadeOut.toFixed(1) })}
          onDec={() => updateClip(clip.id, { fadeOut: stepFade(clip.fadeOut, clip.duration, -1) })}
          onInc={() => updateClip(clip.id, { fadeOut: stepFade(clip.fadeOut, clip.duration, 1) })}
        />
        {/* 🎚️ sztereó pásztázás (bal ↔ jobb) — a renderben */}
        <Stepper
          label={t('panels.audio.pan')}
          value={panLabel(clip.pan ?? 0, t)}
          onDec={() => updateClip(clip.id, { pan: stepPan(clip.pan, -1) })}
          onInc={() => updateClip(clip.id, { pan: stepPan(clip.pan, 1) })}
        />
        <View style={styles.chipRow}>
          {clip.source === 'voiceover' ? (
            <>
              <Chip
                label={t('panels.audio.enhanceVoice')}
                active={clip.voiceEnhance === true}
                onPress={() => updateClip(clip.id, { voiceEnhance: !clip.voiceEnhance })}
              />
              <Chip
                label={t('panels.audio.deReverb')}
                active={clip.deReverb === true}
                onPress={() => updateClip(clip.id, { deReverb: !clip.deReverb })}
              />
            </>
          ) : (
            <Chip
              label={t('panels.audio.autoDuck')}
              active={clip.autoDuck === true}
              onPress={() => updateClip(clip.id, { autoDuck: !clip.autoDuck })}
            />
          )}
        </View>
        {/* 🎚️ hangerő-automáció Graph Editorral (value/time görbe, bezier) */}
        <Text style={styles.note}>{t('panels.audio.volumeAutomation')}</Text>
        <KeyframeGraphEditor
          keyframes={clip.keyframes?.volume ?? []}
          duration={clip.duration}
          min={0}
          max={1}
          fallback={clip.volume}
          playhead={clamp(playhead - clip.start, 0, clip.duration)}
          onChange={(next) =>
            updateClip(clip.id, {
              keyframes: { ...clip.keyframes, volume: next.length > 0 ? next : undefined },
            })
          }
          onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
          formatValue={(v) => `${Math.round(v * 100)}%`}
        />
        <Text style={styles.note}>
          {t('panels.audio.mixHint')}
        </Text>
      </PanelSection>
    </>
  );
}

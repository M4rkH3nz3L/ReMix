import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { clipEditStyles as styles } from '@/components/studio/audio/clipEdit/clipEditStyles';
import { CLIP_VOLUME_MAX, formatDb } from '@/lib/clipGain';
import { FX_AUTO, type FxAutoKey } from '@/lib/clipEditOps';
import { clamp } from '@/lib/time';
import { useEditorStore, type EditorState } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';

/** 🎚️ automáció: hangerő-, pásztázás- és effekt-görbék — élőben a klipre (minden módosítás egy updateClip) */
export function ClipAutomationSection({
  clip,
  kfRate,
  playhead,
  autoChannel,
  setAutoChannel,
  updateClip,
}: {
  clip: AudioClip;
  kfRate: number;
  playhead: number;
  autoChannel: FxAutoKey;
  setAutoChannel: (key: FxAutoKey) => void;
  updateClip: EditorState['updateClip'];
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🎚️ hangerő-automáció (value/time görbe) — élő, mint az AudioPanelben */}
      <Text style={styles.autoLabel}>{t('panels.audio.volumeAutomation')}</Text>
      <KeyframeGraphEditor
        timeRate={kfRate}
        keyframes={clip.keyframes?.volume ?? []}
        duration={clip.duration}
        min={0}
        max={CLIP_VOLUME_MAX}
        fallback={clip.volume}
        playhead={clamp(playhead - clip.start, 0, clip.duration)}
        onChange={(next) =>
          updateClip(clip.id, {
            keyframes: { ...clip.keyframes, volume: next.length > 0 ? next : undefined },
          })
        }
        onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
        formatValue={formatDb}
      />

      {/* 🎚️ pásztázás-automáció (−1…1 görbe) — a render per-frame aeval-lal égeti be */}
      <Text style={styles.autoLabel}>{t('studio.audio.panAutomation', { defaultValue: 'Pásztázás-automáció' })}</Text>
      <KeyframeGraphEditor
        timeRate={kfRate}
        keyframes={clip.keyframes?.pan ?? []}
        duration={clip.duration}
        min={-1}
        max={1}
        fallback={clip.pan ?? 0}
        playhead={clamp(playhead - clip.start, 0, clip.duration)}
        onChange={(next) =>
          updateClip(clip.id, {
            keyframes: { ...clip.keyframes, pan: next.length > 0 ? next : undefined },
          })
        }
        onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
        formatValue={(v) => (Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}`)}
      />

      {/* 🎛️ effekt-automáció: a kiválasztott paraméter görbéje (szűrő-söprés, zengés, EQ…) */}
      <Text style={styles.autoLabel}>{t('studio.audio.fxAutomation.title')}</Text>
      <View style={styles.autoChips}>
        {FX_AUTO.map((ch) => {
          const active = autoChannel === ch.key;
          const used = (clip.keyframes?.[ch.key]?.length ?? 0) > 0;
          return (
            <Pressable
              key={ch.key}
              testID={`fx-auto-${ch.key}`}
              onPress={() => setAutoChannel(ch.key)}
              style={[styles.autoChip, active && styles.autoChipActive]}
            >
              <Text style={[styles.autoChipText, active && styles.autoChipTextActive]}>
                {t(`studio.audio.fxAutomation.${ch.key}`)}
                {used ? ' •' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {(() => {
        const ch = FX_AUTO.find((c) => c.key === autoChannel)!;
        return (
          <KeyframeGraphEditor
            timeRate={kfRate}
            keyframes={clip.keyframes?.[ch.key] ?? []}
            duration={clip.duration}
            min={ch.min}
            max={ch.max}
            fallback={ch.fallback(clip.audioFx)}
            playhead={clamp(playhead - clip.start, 0, clip.duration)}
            onChange={(next) =>
              updateClip(clip.id, {
                keyframes: { ...clip.keyframes, [ch.key]: next.length > 0 ? next : undefined },
              })
            }
            onSeek={(tt) => useEditorStore.getState().setPlayhead(clip.start + tt)}
            formatValue={ch.format}
          />
        );
      })()}
    </>
  );
}

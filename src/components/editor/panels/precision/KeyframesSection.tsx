import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { KeyframeGraphEditor } from '@/components/editor/KeyframeGraphEditor';
import { styles } from '@/components/editor/panels/precision/precisionStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import { TRANSFORM_CHANNELS, type ChannelCfg } from '@/lib/precisionPanelOps';
import { clamp } from '@/lib/time';
import type { EditorState } from '@/store/editorStore';
import type { Clip, ImageClip, VideoClip } from '@/types/project';

/** a transzform-csatornák kulcskocka-görbéje (Graph Editor) — videó/kép */
export function KeyframesSection({
  clip,
  kfChannel,
  setKfChannel,
  playhead,
  updateClip,
  setPlayhead,
}: {
  clip: Clip;
  kfChannel: ChannelCfg['id'];
  setKfChannel: (id: ChannelCfg['id']) => void;
  playhead: number;
  updateClip: EditorState['updateClip'];
  setPlayhead: EditorState['setPlayhead'];
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.precision.keyframesTitle')}>
      <View style={styles.row}>
        {TRANSFORM_CHANNELS.map((c) => (
          <Chip
            key={c.id}
            label={t(c.label)}
            active={kfChannel === c.id}
            onPress={() => setKfChannel(c.id)}
          />
        ))}
      </View>
      {(() => {
        const cfg = TRANSFORM_CHANNELS.find((c) => c.id === kfChannel) ?? TRANSFORM_CHANNELS[0];
        const media = clip as VideoClip | ImageClip;
        return (
          <KeyframeGraphEditor
            keyframes={media.keyframes?.[cfg.id] ?? []}
            duration={clip.duration}
            min={cfg.min}
            max={cfg.max}
            fallback={cfg.fallback(media)}
            playhead={clamp(playhead - clip.start, 0, clip.duration)}
            onChange={(next) =>
              updateClip(clip.id, {
                keyframes: { ...media.keyframes, [cfg.id]: next.length > 0 ? next : undefined },
              })
            }
            onSeek={(tt) => setPlayhead(clip.start + tt)}
            formatValue={cfg.fmt}
          />
        );
      })()}
      <Text style={styles.range}>{t('panels.precision.keyframeHint')}</Text>
    </PanelSection>
  );
}

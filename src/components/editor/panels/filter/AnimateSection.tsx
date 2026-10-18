import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { PHOTO_ANIM_PRESETS, buildPhotoAnimation } from '@/lib/photoAnimate';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/** 🎬 Fotó-animáció presetek (Ken Burns stb.). Önálló szekció — a klip keyframe-jeit írja. */
export function AnimateSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  return (
    <PanelSection title={t('panels.filter.sectionAnimate')}>
      <View style={styles.row}>
        {PHOTO_ANIM_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            label={t(preset.label)}
            active={false}
            onPress={() =>
              updateClip(clip.id, {
                keyframes: buildPhotoAnimation(preset.id, clip.duration),
              })
            }
          />
        ))}
        {clip.keyframes ? (
          <Chip
            label={t('panels.filter.chipNoneX')}
            active={false}
            onPress={() => updateClip(clip.id, { keyframes: undefined })}
          />
        ) : null}
      </View>
      <Text style={styles.note}>
        {t('panels.filter.noteAnimate')}
      </Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});

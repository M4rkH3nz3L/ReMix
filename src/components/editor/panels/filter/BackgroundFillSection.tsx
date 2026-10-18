import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/** 🎨 Háttér-kitöltés (fekete / életlen). Önálló szekció. */
export function BackgroundFillSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  return (
    <PanelSection title={t('panels.filter.sectionBackgroundFill')}>
      <View style={styles.row}>
        <Chip
          label={t('panels.filter.chipBlack')}
          active={(clip.backgroundFill ?? 'black') === 'black'}
          onPress={() => updateClip(clip.id, { backgroundFill: 'black' })}
        />
        <Chip
          label={t('panels.filter.chipBlurred')}
          active={clip.backgroundFill === 'blur'}
          onPress={() => updateClip(clip.id, { backgroundFill: 'blur' })}
        />
      </View>
      <Text style={styles.note}>
        {t('panels.filter.noteBackgroundFill')}
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

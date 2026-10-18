import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, LightingPreset, VideoClip } from '@/types/project';

const LIGHTING_PRESETS: { id: LightingPreset; label: string }[] = [
  { id: 'studio', label: '💡 Studio' },
  { id: 'sunset', label: '🌅 Sunset' },
  { id: 'neon', label: '🟣 Neon' },
  { id: 'cyberpunk', label: '🌃 Cyberpunk' },
];

/** 💡 Fény-presetek. Önálló szekció — a klip lighting-mezőjét írja. */
export function LightingSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  return (
    <PanelSection title={t('panels.filter.sectionLighting')}>
      <View style={styles.row}>
        <Chip
          label={t('common.none')}
          active={!clip.lighting}
          onPress={() => updateClip(clip.id, { lighting: undefined })}
        />
        {LIGHTING_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            label={preset.label}
            active={clip.lighting === preset.id}
            onPress={() => updateClip(clip.id, { lighting: preset.id })}
          />
        ))}
      </View>
      <Text style={styles.note}>
        {t('panels.filter.noteLighting')}
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

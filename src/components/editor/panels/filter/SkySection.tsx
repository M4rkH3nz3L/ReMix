import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { SKY_PRESETS, replaceSky } from '@/lib/skyClient';
import type { SkyPreset } from '@/lib/skyClient';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip } from '@/types/project';

/**
 * 🌅 Égbolt-csere (csak fotó): a klip forrása a kompozit képre vált. Önálló
 * szekció — saját busy-állapot + handler, a klip uri-ját írja a command-buson.
 */
export function SkySection({ clip }: { clip: ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const [skyBusy, setSkyBusy] = useState<string | null>(null);

  // 🌅 égbolt-csere: a klip forrása a kompozit képre vált
  const applySky = async (preset: SkyPreset) => {
    if (skyBusy) {
      return;
    }
    setSkyBusy(preset);
    const uri = await replaceSky(clip.uri, preset);
    setSkyBusy(null);
    if (!uri) {
      Alert.alert(t('panels.filter.skyTitle'), t('panels.filter.skyUnavailable'));
      return;
    }
    updateClip(clip.id, { uri });
  };

  return (
    <PanelSection title={t('panels.filter.sectionSky')}>
      <View style={styles.row}>
        {SKY_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            label={skyBusy === preset.id ? '⏳…' : t(preset.label)}
            active={false}
            onPress={() => {
              void applySky(preset.id);
            }}
          />
        ))}
      </View>
      <Text style={styles.note}>
        {t('panels.filter.noteSky')}
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

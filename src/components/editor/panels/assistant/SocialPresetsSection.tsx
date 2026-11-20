import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { SOCIAL_PRESETS } from '@/lib/assistantPanelOps';

/** 📱 közösségi platform-presetek: arányváltás + safe-zone + reframe egy gombbal */
export function SocialPresetsSection({
  applySocialPreset,
}: {
  applySocialPreset: (aspect: '16:9' | '9:16' | '1:1') => void;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.assistant.sectionSocial')}>
      <View style={styles.row}>
        {SOCIAL_PRESETS.map((p) => (
          <Chip
            key={p.id}
            label={`${p.label} · ${p.aspect}`}
            active={false}
            onPress={() => applySocialPreset(p.aspect)}
          />
        ))}
      </View>
      <Text style={styles.note}>{t('panels.assistant.socialNote')}</Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});

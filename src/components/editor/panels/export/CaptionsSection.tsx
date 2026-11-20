import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/export/exportStyles';
import { Chip, PanelSection } from '@/components/ui/controls';

/** felirat-export formátumonként (SRT / WebVTT / ASS) */
export function CaptionsSection({ exportCaptions }: { exportCaptions: (fmt: 'srt' | 'vtt' | 'ass') => void }) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.export.captionsSection')}>
      <View style={styles.row}>
        <Chip label="SRT" active={false} onPress={() => exportCaptions('srt')} />
        <Chip label="WebVTT" active={false} onPress={() => exportCaptions('vtt')} />
        <Chip label="ASS" active={false} onPress={() => exportCaptions('ass')} />
      </View>
      <Text style={styles.note}>
        {t('panels.export.captionsNote')}
      </Text>
      <Text style={styles.note}>{t('panels.export.captionsFormatsNote')}</Text>
    </PanelSection>
  );
}

import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/precision/precisionStyles';
import { Chip, PanelSection } from '@/components/ui/controls';
import { logCaught } from '@/lib/logCaught';
import type { VideoClip } from '@/types/project';

/** compound clip: a beágyazott kompozíció proxy-renderének indítása */
export function CompoundSection({
  comp,
  proxyBusy,
  renderCompoundProxy,
}: {
  comp: NonNullable<VideoClip['comp']>;
  proxyBusy: boolean;
  renderCompoundProxy: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.precision.compoundTitle')}>
      <Text style={styles.range}>
        {t('panels.precision.compoundInfo', { tracks: comp.tracks.length })}
      </Text>
      <View style={styles.row}>
        <Chip
          label={proxyBusy ? t('panels.precision.compoundRendering') : t('panels.precision.compoundRender')}
          active={proxyBusy}
          onPress={() => {
            renderCompoundProxy().catch((caught) => { logCaught('components/editor/panels/PrecisionPanel.tsx:PrecisionPanel', caught); });
          }}
        />
      </View>
      <Text style={styles.range}>{t('panels.precision.compoundNote')}</Text>
    </PanelSection>
  );
}

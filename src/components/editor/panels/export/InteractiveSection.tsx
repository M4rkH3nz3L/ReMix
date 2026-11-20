import { useTranslation } from 'react-i18next';
import { Text } from 'react-native';

import { styles } from '@/components/editor/panels/export/exportStyles';
import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { shareInteractiveMetadata } from '@/lib/export';
import type { Project } from '@/types/project';

/** az interaktív (hotspot) metaadat JSON-megosztása */
export function InteractiveSection({
  project,
  guard,
}: {
  project: Project;
  guard: (fn: () => Promise<void>) => () => void;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.export.interactiveSection')}>
      <PrimaryButton
        icon="code-download-outline"
        label={t('panels.export.shareHotspotJson')}
        onPress={guard(() => shareInteractiveMetadata(project))}
      />
      <Text style={styles.note}>
        {t('panels.export.interactiveNote')}
      </Text>
    </PanelSection>
  );
}

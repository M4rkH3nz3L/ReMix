import { useTranslation } from 'react-i18next';
import { Alert, Text } from 'react-native';

import { styles } from '@/components/editor/panels/export/exportStyles';
import { PanelSection, PrimaryButton } from '@/components/ui/controls';
import { logCaught } from '@/lib/logCaught';
import { collectAndShareProject } from '@/lib/render';
import { shareRpFile } from '@/lib/rpFile';
import { shareVidedFile } from '@/lib/videdFile';
import { withProgress } from '@/store/progressStore';
import type { Project } from '@/types/project';

/** projektfájl-megosztás (.remix / .rp) és a terv felhő-mentése / -visszaállítása */
export function ProjectFileSection({
  project,
  guard,
  collectStatus,
  setCollectStatus,
  cloudStatus,
  cloudBackup,
  cloudRestore,
}: {
  project: Project;
  guard: (fn: () => Promise<void>) => () => void;
  collectStatus: string | null;
  setCollectStatus: (status: string | null) => void;
  cloudStatus: string | null;
  cloudBackup: () => Promise<void>;
  cloudRestore: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.export.projectFileSection')}>
      <PrimaryButton
        icon="document-outline"
        label={t('panels.export.shareRemixFile')}
        onPress={guard(() => shareVidedFile(project))}
      />
      <PrimaryButton
        icon="archive-outline"
        label={collectStatus ?? t('panels.export.shareRpFile')}
        onPress={() => {
          if (collectStatus) {
            return; // már fut
          }
          // 📦 a szabványos teljes-projekt csomag (.rp) — ESZKÖZÖN készül
          // (ingyen, offline); a worker /collect útja fallbackként él tovább
          setCollectStatus(t('common.processing'));
          withProgress(t('panels.export.collectPackaging'), (report) =>
            shareRpFile(project, report).catch((caught) => { logCaught('components/editor/panels/ExportPanel.tsx:ExportPanel', caught); return collectAndShareProject(project, report); })
          )
            .catch((err: Error) => { logCaught('components/editor/panels/ExportPanel.tsx:ExportPanel', err); return Alert.alert('.rp', err.message); })
            .finally(() => setCollectStatus(null));
        }}
      />
      <PrimaryButton
        icon="cloud-upload-outline"
        label={cloudStatus ?? t('panels.export.cloudBackupBtn')}
        onPress={() => {
          cloudBackup().catch((err: Error) => { logCaught('components/editor/panels/ExportPanel.tsx:ExportPanel', err); return Alert.alert(t('panels.export.cloudTitle'), err.message); });
        }}
      />
      <PrimaryButton
        icon="cloud-download-outline"
        label={t('panels.export.cloudRestoreBtn')}
        onPress={() => {
          cloudRestore().catch((err: Error) => { logCaught('components/editor/panels/ExportPanel.tsx:ExportPanel', err); return Alert.alert(t('panels.export.cloudTitle'), err.message); });
        }}
      />
      <Text style={styles.note}>
        {t('panels.export.projectFileNote')}
      </Text>
      <Text style={styles.note}>{t('panels.export.cloudSyncNote')}</Text>
    </PanelSection>
  );
}

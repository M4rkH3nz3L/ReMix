import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { pullProject, pushProject } from '@/lib/cloudSync';
import { shareCaptionsAss, shareCaptionsSrt, shareCaptionsVtt } from '@/lib/export';
import { logCaught } from '@/lib/logCaught';
import { guardPro } from '@/store/paywallStore';
import type { Project } from '@/types/project';

export interface ProjectFileDeps {
  project: Project;
  t: TFunction;
  cloudStatus: string | null;
  setCloudStatus: (status: string | null) => void;
  restoreProject: (project: Project) => void;
}

/** fájl-alapú exportok (felirat, megosztás-őr) és a projekt-terv felhő-mentése/visszaállítása */
export function createProjectFileActions(deps: ProjectFileDeps) {
  const { project, t, cloudStatus, setCloudStatus, restoreProject } = deps;

  const guard = (fn: () => Promise<void>) => () => {
    fn().catch((caught) => { logCaught('components/editor/panels/ExportPanel.tsx:guard', caught); return Alert.alert(t('common.error'), t('panels.export.shareFailed')); });
  };

  // felirat-export a választott formátumban (SRT / WebVTT / ASS)
  const exportCaptions = (fmt: 'srt' | 'vtt' | 'ass') => {
    const share =
      fmt === 'vtt' ? shareCaptionsVtt : fmt === 'ass' ? shareCaptionsAss : shareCaptionsSrt;
    share(project)
      .then((had) => {
        if (!had) {
          Alert.alert(t('panels.export.noCaptionsTitle'), t('panels.export.noCaptionsMessage'));
        }
      })
      .catch((caught) => { logCaught('components/editor/panels/ExportPanel.tsx:exportCaptions', caught); return Alert.alert(t('common.error'), t('panels.export.shareFailed')); });
  };

  // ☁️ projekt-terv felhő-mentése (Pro; a médiafájlok külön, későbbi lépés)
  const cloudBackup = async () => {
    if (cloudStatus) {
      return;
    }
    setCloudStatus(t('panels.export.cloudBackingUp'));
    try {
      await guardPro(
        async () => {
          await pushProject(project);
          Alert.alert(t('panels.export.cloudTitle'), t('panels.export.cloudBackupDone'));
        },
        (e) => Alert.alert(t('panels.export.cloudTitle'), e.message)
      );
    } finally {
      setCloudStatus(null);
    }
  };

  // ☁️ a felhő-mentett terv visszaállítása (undo-zható; a helyi restoreProject-en át)
  const cloudRestore = async () => {
    if (cloudStatus) {
      return;
    }
    setCloudStatus(t('panels.export.cloudRestoring'));
    try {
      await guardPro(
        async () => {
          const cloud = await pullProject(project.id);
          if (!cloud) {
            Alert.alert(t('panels.export.cloudTitle'), t('panels.export.cloudRestoreNone'));
            return;
          }
          restoreProject(cloud);
          Alert.alert(t('panels.export.cloudTitle'), t('panels.export.cloudRestoreDone'));
        },
        (e) => Alert.alert(t('panels.export.cloudTitle'), e.message)
      );
    } finally {
      setCloudStatus(null);
    }
  };

  return { guard, exportCaptions, cloudBackup, cloudRestore };
}

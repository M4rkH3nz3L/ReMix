import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { createProjectFromTemplate } from '@/constants/templates';
import type { VideoTemplate } from '@/constants/templates';
import { backupProjectToCloud } from '@/lib/cloudSync';
import { studioRoute } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import { buildNewProject, type NewProjectForm } from '@/hooks/studio/buildNewProject';
import { logCaught } from '@/lib/logCaught';

/**
 * ➕ Projekt-létrehozás: az űrlapból és sablonból (REFACTOR: a useStudio-ból) — hook-mentes
 * csoport, minden renderben újra létrehozva.
 */
export function createProjectCreateActions({
  form,
  setCreating,
  resetCreateForm,
  t,
}: {
  form: NewProjectForm;
  setCreating: Dispatch<SetStateAction<boolean>>;
  resetCreateForm: () => void;
  t: TFunction;
}) {
  const { kind } = form;
  const create = async () => {
    const project = buildNewProject(form, t);
    if (!project) {
      return;
    }
    await saveProject(project);
    backupProjectToCloud(project); // 🗄️ azonnal a userhez a felhőbe is (best-effort)
    setCreating(false);
    resetCreateForm();
    // 🎛️ a fajtának megfelelő stúdióba nyitunk (videó → editor, kép/hang → saját)
    router.push(studioRoute(kind, project.id) as Href);
  };

  const createFromTemplate = (template: VideoTemplate) => {
    const project = createProjectFromTemplate(template);
    saveProject(project)
      .then(() => {
        backupProjectToCloud(project); // 🗄️ felhő-backup (best-effort)
        router.push(`/editor/${project.id}`);
      })
      .catch((caught) => { logCaught('hooks/useStudio.ts:createFromTemplate', caught); return Alert.alert(t('common.error'), t('home.createFailed')); });
  };

  return { create, createFromTemplate };
}

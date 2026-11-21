import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { studioRoute } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import { pickAndParseVided, relinkInteractive } from '@/lib/videdFile';
import type { Project, ProjectMeta } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 📥 Projekt-import (.vided) és az „AI eszközök” belépő (REFACTOR: a useStudio-ból) — hook-mentes
 * csoport, minden renderben újra létrehozva.
 */
export function createStudioImportActions({
  t,
  refresh,
  projects,
  setCreating,
}: {
  t: TFunction;
  refresh: () => void;
  projects: ProjectMeta[];
  setCreating: Dispatch<SetStateAction<boolean>>;
}) {
  const importVided = () => {
    pickAndParseVided()
      .then((result) => {
        if (!result) {
          return;
        }
        const finish = (p: Project) => {
          saveProject(p)
            .then(() => {
              refresh();
              router.push(studioRoute(p.kind, p.id) as Href);
            })
            .catch((caught) => { logCaught('hooks/useStudio.ts:finish', caught); return Alert.alert(t('common.import'), t('home.saveFailed')); });
        };
        if (result.missing.length === 0) {
          if (result.relinked > 0) {
            Alert.alert(
              t('home.importDoneTitle'),
              t('home.importRelinked', { count: result.relinked })
            );
          }
          finish(result.project);
          return;
        }
        Alert.alert(
          t('home.missingMediaTitle'),
          t('home.missingMediaCount', { count: result.missing.length }) +
            (result.relinked > 0
              ? ' ' + t('home.missingMediaRelinkedNote', { count: result.relinked })
              : '') +
            '. ' +
            t('home.missingMediaAsk'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.later'), onPress: () => finish(result.project) },
            {
              text: t('home.relink'),
              onPress: () => {
                relinkInteractive(result.project, result.missing).then(finish);
              },
            },
          ]
        );
      })
      .catch((err: Error) => { logCaught('hooks/useStudio.ts:importVided', err); return Alert.alert(t('common.import'), err.message); });
  };

  // 🤖 „AI eszközök": az AI a szerkesztőben él → a legutóbbi projektet nyitjuk
  // meg egyből az AI-panellel; ha még nincs projekt, előbb létrehozunk egyet
  const openAiTools = () => {
    // az AI-panel a videó-editorban él → a legutóbbi VIDEÓ-projektet nyitjuk;
    // ha csak kép/hang van (vagy semmi), az új-projekt lapot kínáljuk
    const recent = projects.find((p) => (p.kind ?? 'video') === 'video');
    if (recent) {
      router.push(`/editor/${recent.id}?panel=assistant`);
    } else {
      setCreating(true);
    }
  };

  return { importVided, openAiTools };
}

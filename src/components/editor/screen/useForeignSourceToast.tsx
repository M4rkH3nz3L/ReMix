import type { TFunction } from 'i18next';
import { useEffect, useRef } from 'react';

import { sourcePlatformOf } from '@/lib/sourceWatermark';
import { useToast } from '@/store/toastStore';
import type { Project } from '@/types/project';

/**
 * 🏷️ Más platformról letöltött forrás (vízjel, idegen jog) — IMPORTKOR egyszer szólunk (D11).
 * A betöltéskor már meglévő assetek nem jeleznek (azokról már döntött a user).
 * A szerkesztő-képernyőből kiemelve.
 */
export function useForeignSourceToast(project: Project | null, id: string, t: TFunction) {
  const knownAssetIds = useRef<{ projectId: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!project || project.id !== id) {
      return;
    }
    const known = knownAssetIds.current;
    if (!known || known.projectId !== id) {
      knownAssetIds.current = { projectId: id, ids: new Set(project.assets.map((a) => a.id)) };
      return;
    }
    for (const a of project.assets) {
      if (known.ids.has(a.id)) continue;
      known.ids.add(a.id);
      const platform = a.kind === 'video' || a.kind === 'image' ? sourcePlatformOf(a.name ?? a.uri) : null;
      if (platform) {
        useToast.getState().show(t('editorScreen.foreignSource', { platform: t(`editorScreen.platform_${platform}`) }));
      }
    }
  }, [project, id, t]);
}

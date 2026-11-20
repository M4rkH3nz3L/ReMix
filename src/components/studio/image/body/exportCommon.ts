import { logCswcr, studioKindOf } from '@/lib/cswcrClient';
import { imageDocContentKey } from '@/lib/imageExport';
import { useEditorStore } from '@/store/editorStore';
import type { Project } from '@/types/project';

/**
 * 🖨️ Az export-akciók közös lépései (REFACTOR: a `useImageExport`-ból kiemelve): a kész kép a
 * store-ba, és a CSWCR export-esemény.
 */

// 💾 I4: a kész renderelt kép a store FRISS doc-jára kerül — a render alatt tett
// szerkesztések nem állnak vissza az `await` előtt elkapott állapotra
export const commitRendered = (docIdToUpdate: string, renderedUri: string) => {
  const s = useEditorStore.getState();
  const fresh = s.project?.imageDocs?.find((d) => d.id === docIdToUpdate);
  if (fresh) {
    s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: { ...fresh, renderedUri, renderedKey: imageDocContentKey(fresh) }, label: 'render' });
  }
};

/** 📊 CSWCR (CORE K4): a Kép Stúdió exportja befejezi a láncot (export / poszt / csomag) */
export const markExported = (project: Project | null) => {
  if (project) logCswcr({ type: 'export', projectId: project.id, kind: studioKindOf(project.kind) });
};

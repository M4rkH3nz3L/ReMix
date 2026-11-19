import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { effectiveCanvas } from '@/lib/canvasPresets';
import { createImageDoc } from '@/lib/imageDoc';
import { canRemovePage, duplicatePage, pageIndexAfterRemoval, reorderPages } from '@/lib/imageProjectPages';
import { makeId } from '@/lib/id';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc } from '@/types/project';

/**
 * 🖼️📄 A galéria-lapok műveletei (project mód): új / sablonból / duplikál / töröl / mozgat. VISELKEDÉS-
 * MEGŐRZŐ kiemelés az `ImageStudioBody`-ból — minden írás a command-buson (`dispatch`). `.tsx`: a
 * fordítás-paritás őr (`imageLocaleParity`) innen is gyűjti a `t()`-kulcsokat.
 */
export function useImagePages({
  doc,
  pages,
  setActivePageId,
  setSelectedId,
}: {
  doc: ImageDoc | null;
  pages: ImageDoc[];
  setActivePageId: Dispatch<SetStateAction<string | null>>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}) {
  const { t } = useTranslation();
  // ── 🖼️📄 Galéria-lapok (project mód): új/duplikál/töröl/mozgat az aktív lapon ──
  const addDocPage = (nd: ImageDoc) => {
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: nd });
    setActivePageId(nd.id);
    setSelectedId(null);
  };
  const addPage = () => {
    const s = useEditorStore.getState();
    if (!s.project) {
      return;
    }
    const size = effectiveCanvas({ aspectRatio: s.project.aspectRatio });
    const nd = createImageDoc(t('studio.image.pageName', { n: pages.length + 1 }), s.project.aspectRatio, () => makeId('lyr'), {
      width: size.width,
      height: size.height,
    });
    s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: nd });
    setActivePageId(nd.id);
    setSelectedId(null);
  };

  const duplicateActivePage = () => {
    if (!doc) {
      return;
    }
    const dup = duplicatePage(doc, makeId('img'));
    useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: dup, label: t('studio.image.pageDuplicated', { name: dup.name }) });
    setActivePageId(dup.id);
    setSelectedId(null);
  };

  const deleteActivePage = () => {
    if (!doc || !canRemovePage({ imageDocs: pages })) {
      return;
    }
    const idx = pages.findIndex((d) => d.id === doc.id);
    const remaining = pages.filter((d) => d.id !== doc.id);
    const nextIdx = pageIndexAfterRemoval(idx, pages.length);
    Alert.alert(t('common.delete'), t('studio.image.pageDeleteConfirm', { name: doc.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          useEditorStore.getState().dispatch({ type: 'REMOVE_IMAGE_DOC', docId: doc.id });
          setActivePageId(remaining[nextIdx]?.id ?? null);
          setSelectedId(null);
        },
      },
    ]);
  };

  const movePage = (dir: -1 | 1) => {
    if (!doc) {
      return;
    }
    const idx = pages.findIndex((d) => d.id === doc.id);
    const reordered = reorderPages(pages, idx, idx + dir);
    if (reordered === pages) {
      return;
    }
    useEditorStore.getState().dispatch({ type: 'REORDER_IMAGE_DOCS', order: reordered.map((d) => d.id) });
  };

  const activeIdx = doc ? pages.findIndex((d) => d.id === doc.id) : -1;

  return { addDocPage, addPage, duplicateActivePage, deleteActivePage, movePage, activeIdx };
}

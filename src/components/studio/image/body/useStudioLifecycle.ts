import { File } from 'expo-file-system';
import { type RefObject, useEffect, useState } from 'react';

import { keepRenderedInProject, type RenderStageHandle } from '@/components/studio/image/RenderStage';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { createImageDoc } from '@/lib/imageDoc';
import { imageDocContentKey } from '@/lib/imageExport';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { loadProjectFonts } from '@/lib/projectFontsClient';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc } from '@/types/project';

/**
 * 🔁 A stúdió életciklus-effektjei: a projekt saját fontjai, az induló kép-dokumentum (project mód)
 * és az aktív lap élő bélyegképe. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból — a gyökér a
 * hookokat az eredeti helyükön hívja, így az effektek sorrendje azonos.
 */

/** ecset-színek + -méretek (px) a sávban */
/** ennyi tétlenség után frissül a lap bélyegképe */
const THUMB_IDLE_MS = 2000;

function deleteLocalFile(uri: string) {
  try {
    new File(uri).delete();
  } catch (caught) {
    logCaught('components/studio/image/ImageStudioBody.tsx:deleteLocalFile', caught);
    /* takarítás — best-effort */
  }
}

/** 🔤 S10: a projekt saját fontjai betöltve a megnyitáskor; a betöltés után a vászon újrarajzol */
export function useProjectFonts() {
  const projectFonts = useEditorStore((st) => st.project?.fonts);
  const [fontsVersion, setFontsVersion] = useState(0);
  useEffect(() => {
    if (!projectFonts?.length) return;
    let alive = true;
    void loadProjectFonts(projectFonts).then(() => alive && setFontsVersion((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [projectFonts]);
  return fontsVersion;
}

/** project módban gondoskodunk róla, hogy legyen legalább egy kép-dokumentum */
export function useEnsureImageDoc(mode: 'project' | 'scoped') {
  useEffect(() => {
    if (mode !== 'project') {
      return;
    }
    const s = useEditorStore.getState();
    if (s.project && !(s.project.imageDocs && s.project.imageDocs.length > 0)) {
      // a fallback-doc is EXPLICIT vászonméretet kap (a projekt arányából) → a
      // dokumentumnak mindig van W×H-ja, amit a vászon-lap megmutat/szerkeszt
      const size = effectiveCanvas({ aspectRatio: s.project.aspectRatio });
      const nd = createImageDoc(s.project.name, s.project.aspectRatio, () => makeId('lyr'), {
        width: size.width,
        height: size.height,
      });
      s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: nd });
    }
  }, [mode]);
}

/** 🖼️ I41: élő bélyegkép az aktív lapról, szerkesztési szünetben (a régi fájl törlődik) */
export function usePageThumbnail({
  doc,
  mode,
  renderStageRef,
}: {
  doc: ImageDoc | null;
  mode: 'project' | 'scoped';
  renderStageRef: RefObject<RenderStageHandle | null>;
}) {
  const activeThumbKey = doc && mode === 'project' ? imageDocContentKey(doc) : null;
  useEffect(() => {
    if (!doc || !activeThumbKey || doc.thumbKey === activeThumbKey || doc.layers.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      // offline first: a bélyegkép is a telefonon készül (CORE K1)
      void (renderStageRef.current?.render(doc, 256) ?? Promise.resolve(null))
        .then((rendered) => {
          if (!rendered) {
            return;
          }
          const uri = keepRenderedInProject(rendered, `thumb_${doc.id}_${activeThumbKey}`);
          const previous = doc.thumbUri;
          useEditorStore.getState().setDocThumb(doc.id, uri, activeThumbKey);
          if (previous && previous !== uri) {
            deleteLocalFile(previous);
          }
        })
        .catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:timer', caught); });
    }, THUMB_IDLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a doc a kulcson át számít: csak valódi tartalom-változásra indul újra
  }, [activeThumbKey]);
}

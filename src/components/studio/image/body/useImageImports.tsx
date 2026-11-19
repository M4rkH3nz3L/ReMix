import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { type SheetKind } from '@/components/studio/image/body/ImageStudioSheets';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { addLayer } from '@/lib/imageDoc';
import { importPdf, importPsd } from '@/lib/imageDocClient';
import { photoBoxFor } from '@/lib/imageLayerGeometry';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { pickImageFile, pickPdf, pickPsd, pickSvg } from '@/lib/media';
import { parseSvg } from '@/lib/svgImport';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import type { ImageDoc, PhotoLayer, Project } from '@/types/project';

/**
 * 📥 A Kép Stúdió fájl-importjai (raszterkép, SVG, PSD, PDF). VISELKEDÉS-MEGŐRZŐ kiemelés az
 * `ImageStudioBody`-ból: a függvények szó szerint a body-ban voltak; minden dokumentum-írás a
 * command-buson megy (`commit` / `dispatch` / `applyBatch`). `.tsx`: a fordítás-paritás őr
 * (`imageLocaleParity`) innen is gyűjti a `t()`-kulcsokat.
 */
export function useImageImports({
  mode,
  doc,
  project,
  busy,
  setBusy,
  commit,
  setSelectedId,
  setSheet,
  setActivePageId,
}: {
  mode: 'project' | 'scoped';
  doc: ImageDoc | null;
  project: Project | null;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  commit: (next: ImageDoc, label?: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSheet: (next: SheetKind) => void;
  setActivePageId: Dispatch<SetStateAction<string | null>>;
}) {
  const { t } = useTranslation();
  /**
   * 📥 SVG-fájl importja rétegekké (`svgImport` mag): a `.svg`-t beolvassuk,
   * ImageDoc-rétegekre bontjuk, és EGY köteg-műveletként (egy undo-lépés) a
   * command-buson betesszük — a vászonon azonnal megjelennek.
   */
  // 🖼️ raszterkép a Fájlokból: a hibás fájl üzenetet ad, a réteg a kép saját arányában jön létre
  const importImageFile = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const picked = await pickImageFile();
      if (!picked) {
        return;
      }
      if (picked.status === 'invalid') {
        Alert.alert(t('studio.image.importFile.invalidTitle'), t('studio.image.importFile.invalidBody'));
        return;
      }
      const l: PhotoLayer = { kind: 'photo', id: makeId('lyr'), uri: picked.uri, position: { x: 0.5, y: 0.5 }, ...photoBoxFor(picked.width, picked.height, effectiveCanvas(doc)), fit: 'stretch' };
      commit(addLayer(doc, l), t('studio.image.undoAddPhoto'));
      setSelectedId(l.id);
      setSheet(null);
      if (picked.width < picked.originalWidth) {
        Alert.alert(t('studio.image.importFile.scaledTitle'), t('studio.image.importFile.scaledBody', { from: picked.originalWidth, to: picked.width }));
      }
    } finally {
      setBusy(false);
    }
  };

  const importSvg = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const svg = await pickSvg();
      if (svg == null) {
        return;
      }
      const { layers, unsupported } = parseSvg(svg);
      if (layers.length === 0) {
        Alert.alert(t('studio.image.svgFailTitle'), t('studio.image.svgFailBody'));
        return;
      }
      // ⚠️ I25: amit nem tudtunk beolvasni, azt megmondjuk (nem tűnik el csendben)
      const skipped = Object.entries(unsupported).map(([tag, count]) => `<${tag}> ×${count}`);
      if (skipped.length > 0) {
        Alert.alert(t('studio.image.svgPartialTitle'), t('studio.image.svgPartialBody', { items: skipped.join(', ') }));
      }
      let next = doc;
      for (const l of layers) {
        next = addLayer(next, l);
      }
      commit(next, t('studio.image.undoImportSvg'));
      setSelectedId(layers[layers.length - 1].id);
      setSheet('layers');
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:importSvg', caught);
      Alert.alert(t('studio.image.svgFailTitle'), t('studio.image.svgFailBody'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 🖼️ PSD-import (IMAGE 01.1): egy .psd-t a workerrel réteges `ImageDoc`-ká
   * olvasunk (ag-psd, réteg-megőrzés), és EGY `UPSERT_IMAGE_DOC` parancsként
   * tesszük a projektbe (undo-barát) — a meglévő dokumentumok érintetlenek. Pro-
   * gated: free usernél a gomb letiltva, de ha mégis ide jutunk, a `guardPro`
   * elkapja a `ProRequiredError`-t és felhozza a paywallt.
   */
  const importPsdDoc = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const file = await pickPsd();
      if (!file) {
        return;
      }
      const psdDoc = await guardPro(
        () => importPsd(file, project?.id),
        (e) => Alert.alert(t('studio.image.psdFailTitle'), e.message || t('studio.image.psdFailBody'))
      );
      if (!psdDoc) {
        return; // lemondás / Pro-paywall / hiba (a guardPro már jelzett)
      }
      // EGY command: a réteges doc a projektbe (sosem közvetlen doc-írás)
      useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: psdDoc, label: t('studio.image.undoImportPsd') });
      // I22: az importált lapra ugrunk, különben úgy tűnik, nem történt semmi
      if (mode === 'project') {
        setActivePageId(psdDoc.id);
        setSelectedId(null);
      }
      setSheet('layers');
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:importPsdDoc', e);
      Alert.alert(t('studio.image.psdFailTitle'), (e as Error)?.message || t('studio.image.psdFailBody'));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 📄 PDF-import (IMAGE 01.3): egy .pdf-et a workerrel OLDALANKÉNT egy `ImageDoc`-ká
   * olvasunk (pdf-lib struktúra + pdfjs+canvas raszter), és a kész lapokat EGY
   * `applyBatch` köteg-paranccsal tesszük a projekt-galériába (az egész import EGY
   * undo-lépés — a meglévő lapok érintetlenek). Pro-gated: free usernél a gomb
   * letiltva, de ha mégis ide jutunk, a `guardPro` felhozza a paywallt.
   */
  const importPdfDocs = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const file = await pickPdf();
      if (!file) {
        return;
      }
      const pdfDocs = await guardPro(
        () => importPdf(file, project?.id),
        (e) => Alert.alert(t('studio.image.pdfFailTitle'), e.message || t('studio.image.pdfFailBody'))
      );
      if (!pdfDocs || pdfDocs.length === 0) {
        return; // lemondás / Pro-paywall / hiba / üres (a guardPro már jelzett)
      }
      // EGY köteg-command (applyBatch): oldalanként egy UPSERT_IMAGE_DOC, de az
      // egész import EGY undo-lépés (sosem közvetlen doc-írás)
      useEditorStore
        .getState()
        .applyBatch(
          pdfDocs.map((d) => ({ type: 'UPSERT_IMAGE_DOC', doc: d, label: t('studio.image.undoImportPdf') })),
          'user'
        );
      // az ÚJ első lapra ugrunk (project módban), hogy a felhasználó rögtön lássa
      if (mode === 'project') {
        setActivePageId(pdfDocs[0].id);
        setSelectedId(null);
      }
      setSheet('layers');
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:importPdfDocs', e);
      Alert.alert(t('studio.image.pdfFailTitle'), (e as Error)?.message || t('studio.image.pdfFailBody'));
    } finally {
      setBusy(false);
    }
  };

  return { importImageFile, importSvg, importPsdDoc, importPdfDocs };
}

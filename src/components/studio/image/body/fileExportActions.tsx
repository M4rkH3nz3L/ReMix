import type { TFunction } from 'i18next';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';

import { markExported } from '@/components/studio/image/body/exportCommon';
import type { createExportRasterizer } from '@/components/studio/image/body/exportRasterizer';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { exportPsd, renderSvgPdf } from '@/lib/imageDocClient';
import { imageMimeForUri, pdfExportFileName, svgExportFileName } from '@/lib/imageExportFiles';
import { isEmbeddablePhoto, pdfRasterHeight } from '@/lib/imageExportPlan';
import { logCaught } from '@/lib/logCaught';
import { jpegToPdf } from '@/lib/rasterPdf';
import { imageDocToSvg, svgDocSize } from '@/lib/svgExport';
import { guardPro } from '@/store/paywallStore';
import type { ImageDoc, Project } from '@/types/project';

type Rasterizer = ReturnType<typeof createExportRasterizer>;

export interface FileExportDeps {
  t: TFunction;
  doc: ImageDoc | null;
  project: Project | null;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  rasterize: Rasterizer['rasterize'];
  alertRenderFail: Rasterizer['alertRenderFail'];
}

/**
 * 📁 A fájl-exportok: önálló SVG, telefonos (raszteres) és szerveres (vektoros) PDF, rétegezett PSD
 * — mind megosztva. VISELKEDÉS-MEGŐRZŐ kiemelés a `useImageExport`-ból, hook nélküli gyárként.
 * `.tsx`: a fordítás-paritás őr innen is gyűjt.
 */
export function createFileExportActions({ t, doc, project, busy, setBusy, rasterize, alertRenderFail }: FileExportDeps) {
  /**
   * 🧩 ÖNÁLLÓ SVG a dokumentumból ([svgExport](@/lib/svgExport)): a fotó-rétegeket
   * base64 data-URI-ba ágyazzuk, hogy a kimenet önmagában megálljon (SVG + PDF közös).
   */
  const buildExportSvg = (d: ImageDoc): string => {
    const embedded = {
      ...d,
      layers: d.layers.map((l) => {
        if (isEmbeddablePhoto(l)) {
          try {
            const src = new File(l.uri);
            if (src.exists) {
              return { ...l, uri: `data:${imageMimeForUri(l.uri)};base64,${src.base64()}` };
            }
          } catch (caught) {
            logCaught('components/studio/image/ImageStudioBody.tsx:buildExportSvg', caught);
            // nem olvasható fotó → marad a hivatkozás (nem self-contained)
          }
        }
        return l;
      }),
    };
    return imageDocToSvg(embedded);
  };

  /**
   * 🧩 VEKTOR-export: a dokumentum SVG-ként, hogy a formák/szöveg/gradiensek
   * vektorként maradjanak (nem raszter-PNG-be égetve) → ÖNÁLLÓ, megosztható .svg.
   */
  const exportSvg = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const svg = buildExportSvg(doc);
      const dir = new Directory(Paths.cache, 'export');
      if (!dir.exists) {
        dir.create();
      }
      const file = new File(dir, svgExportFileName(doc.name));
      try {
        if (file.exists) {
          file.delete();
        }
      } catch (caught) {
        logCaught('components/studio/image/ImageStudioBody.tsx:exportSvg', caught);
        // a write úgyis felülírja
      }
      file.write(svg);
      markExported(project);
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportSvg', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'image/svg+xml', dialogTitle: t('studio.export') }).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportSvg', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * 📄 VEKTOR-PDF export: ugyanaz az önálló SVG → a worker Chromiumja nyomdakész
   * PDF-be nyomtatja (`renderSvgPdf` → `/svg/pdf`). A lap pontosan a vászon mérete.
   */
  // 📄 S14: PDF a TELEFONON — a kész kép (JPEG, doc-felbontáson) egy PDF-oldalon: offline, Free-ben is,
  // pixelre a vászon, a betűk beégetve. A vektoros PDF a szerveres út (`exportVectorPdf`).
  const exportPdf = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const height = pdfRasterHeight(effectiveCanvas(doc).height);
      const jpg = await rasterize(doc, { format: 'jpg', quality: 0.92, height });
      if (!jpg) {
        alertRenderFail();
        return;
      }
      const pdf = jpegToPdf(await new File(jpg).bytes(), { title: doc.name || project?.name || 'ReMix' });
      const dir = new Directory(Paths.cache, 'export');
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const out = new File(dir, pdfExportFileName(doc.name));
      if (out.exists) out.delete();
      out.write(pdf);
      markExported(project);
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPdf', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(out.uri, { mimeType: 'application/pdf', dialogTitle: t('studio.export') }).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPdf', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:exportPdf', caught);
      alertRenderFail();
    } finally {
      setBusy(false);
    }
  };

  const exportVectorPdf = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const svg = buildExportSvg(doc);
      const { width, height } = svgDocSize(doc);
      const uri = await renderSvgPdf(svg, width, height);
      if (!uri) {
        Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
        return;
      }
      markExported(project);
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPdf', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: t('studio.export') }).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPdf', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * 🖼️ PSD-export (IMAGE 01.2): a réteg-fát a workerrel RÉTEG-MEGŐRZÉSSEL (NEM
   * flatten!) .psd-vé építjük (`exportPsd` → `/psd/export`), és megosztjuk. Pro-
   * gated: free usernél az ExportSheet gombja letiltva (`canPsd`), de ha ide jutunk,
   * a `guardPro` elkapja a `ProRequiredError`-t és felhozza a paywallt.
   */
  const exportPsdFile = async () => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const uri = await guardPro(
        () => exportPsd(doc, project?.id),
        (e) => Alert.alert(t('studio.image.psdExportFailTitle'), e.message || t('studio.image.psdExportFailBody'))
      );
      if (!uri) {
        return; // lemondás / Pro-paywall / hiba (a guardPro már jelzett)
      }
      markExported(project);
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPsdFile', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/vnd.adobe.photoshop',
          dialogTitle: t('studio.export'),
        }).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportPsdFile', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:exportPsdFile', e);
      Alert.alert(t('studio.image.psdExportFailTitle'), (e as Error)?.message || t('studio.image.psdExportFailBody'));
    } finally {
      setBusy(false);
    }
  };

  return { exportSvg, exportPdf, exportVectorPdf, exportPsdFile };
}

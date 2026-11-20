import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type View } from 'react-native';

import { createExportRasterizer } from '@/components/studio/image/body/exportRasterizer';
import { createFileExportActions } from '@/components/studio/image/body/fileExportActions';
import { createPublishActions } from '@/components/studio/image/body/publishActions';
import { createRasterExportActions } from '@/components/studio/image/body/rasterExportActions';
import { type RenderStageHandle } from '@/components/studio/image/RenderStage';
import type { ImageDoc, Project } from '@/types/project';

/**
 * 🖨️ A Kép Stúdió render- és export-rétege: raszterizálás (telefon / worker), a vászon pillanatképe,
 * a kép / réteg / méretcsomag / SVG / PDF / PSD export, a videóba küldés, a feed-megosztás és a
 * scoped mentés. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból: a függvények szó szerint a
 * body-ban voltak; a közös állapot (`busy`, `capturing`) a body-é, ide propként jön. A `.tsx`
 * kiterjesztés szándékos: a fordítás-paritás őr (`imageLocaleParity`) a `studio/image` `.tsx`
 * fájljaiból gyűjti a `t()`-kulcsokat — így az itteni feliratok is ellenőrzöttek maradnak.
 *
 * REFACTOR: a hook csak az állapotot (refek, `exporting`) tartja; a műveletek hook nélküli gyárakban
 * élnek (`exportRasterizer`, `rasterExportActions`, `fileExportActions`, `publishActions`), a tiszta
 * mag a `src/lib/imageExportPlan.ts`-ben.
 */
export function useImageExport({
  doc,
  project,
  pages,
  busy,
  setBusy,
  setCapturing,
  canvasRef,
  onSave,
  onExit,
}: {
  doc: ImageDoc | null;
  project: Project | null;
  pages: ImageDoc[];
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setCapturing: Dispatch<SetStateAction<boolean>>;
  canvasRef: RefObject<View | null>;
  onSave?: (doc: ImageDoc, renderedUri: string | null) => Promise<void>;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  const rejectedRef = useRef(false);
  const renderStageRef = useRef<RenderStageHandle>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  const { rasterize, captureCanvas, alertRenderFail } = createExportRasterizer({ t, rejectedRef, renderStageRef, canvasRef, setCapturing });
  const { exportPart, exportPack, exportImage } = createRasterExportActions({ t, doc, project, busy, setBusy, setExporting, exportAbort, rasterize, alertRenderFail });
  const { exportSvg, exportPdf, exportVectorPdf, exportPsdFile } = createFileExportActions({ t, doc, project, busy, setBusy, rasterize, alertRenderFail });
  const { insertIntoVideo, confirmShare, saveScoped } = createPublishActions({ t, doc, project, pages, busy, setBusy, rasterize, alertRenderFail, onSave, onExit });

  return {
    renderStageRef,
    exportAbort,
    exporting,
    rasterize,
    captureCanvas,
    exportPart,
    exportPack,
    exportImage,
    exportSvg,
    exportPdf,
    exportVectorPdf,
    exportPsdFile,
    insertIntoVideo,
    confirmShare,
    saveScoped,
  };
}

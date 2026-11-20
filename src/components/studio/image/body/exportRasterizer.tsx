import type { TFunction } from 'i18next';
import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Alert, PixelRatio, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { type RenderStageHandle } from '@/components/studio/image/RenderStage';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { ExportCancelled, renderImageDoc } from '@/lib/imageDocClient';
import { ImageRenderRejected } from '@/lib/imageExport';
import { captureViewSize, rasterHeightOf } from '@/lib/imageExportPlan';
import { chooseImageRenderRoute } from '@/lib/imageRenderRoute';
import { logCaught } from '@/lib/logCaught';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc } from '@/types/project';

export interface ExportRasterizerDeps {
  t: TFunction;
  rejectedRef: RefObject<boolean>;
  renderStageRef: RefObject<RenderStageHandle | null>;
  canvasRef: RefObject<View | null>;
  setCapturing: Dispatch<SetStateAction<boolean>>;
}

/**
 * 🖼️ A raszterizálás (telefon / worker), a vászon pillanatképe és az általános render-hibaablak.
 * VISELKEDÉS-MEGŐRZŐ kiemelés a `useImageExport`-ból, hook nélküli gyárként: a `rejectedRef` (a
 * szerver szándékos elutasítása) a hooké, ide paraméterként jön. `.tsx`: a fordítás-paritás őr
 * innen is gyűjt.
 */
export function createExportRasterizer({ t, rejectedRef, renderStageRef, canvasRef, setCapturing }: ExportRasterizerDeps) {
  /**
   * 🖼️ A dokumentum raszterizálása — OFFLINE FIRST (CORE K1): elsőként a TELEFON renderel
   * (`RenderStage`: a vászon réteg-fája rejtetten, a kért pixelméreten, bármely lapra). A
   * worker csak a telefonon nem rajzolható effektekért kell (`serverOnlyEffects`), illetve
   * tartalék, ha a telefonos render nem sikerült.
   */
  const rasterize = async (
    target: ImageDoc,
    opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number; signal?: AbortSignal }
  ): Promise<string | null> => {
    rejectedRef.current = false;
    const height = rasterHeightOf(target, opts?.height);
    // 🧭 CORE K1: offline first — a worker csak a telefonon nem rajzolható effektekért kell
    const needsWorker = chooseImageRenderRoute(target, true) === 'worker';
    if (needsWorker) {
      const viaWorker = await rasterizeOnWorker(target, height, opts);
      if (viaWorker || rejectedRef.current) {
        return viaWorker;
      }
    }
    if (opts?.signal?.aborted) {
      throw new ExportCancelled();
    }
    // a telefon renderel, BÁRMELY lapot, a kért pixelméreten (a vászon paritás-mért réteg-fája)
    const onDevice = (await renderStageRef.current?.render(target, height, { format: opts?.format, quality: opts?.quality })) ?? null;
    if (opts?.signal?.aborted) {
      throw new ExportCancelled();
    }
    if (onDevice) {
      if (needsWorker) {
        Alert.alert(t('studio.image.deviceRenderGaps.title'), t('studio.image.deviceRenderGaps.body'));
      }
      return onDevice;
    }
    // tartalék: a worker (ha a telefonos render nem sikerült)
    return needsWorker ? null : rasterizeOnWorker(target, height, opts);
  };

  /** a worker-render (pontos, teljes felbontás) — `null`, ha nem érhető el */
  const rasterizeOnWorker = async (
    target: ImageDoc,
    height: number,
    opts?: { format?: 'png' | 'jpg' | 'webp'; quality?: number; signal?: AbortSignal }
  ): Promise<string | null> => {
    try {
      return await renderImageDoc(target, height, {
        format: opts?.format,
        quality: opts?.quality,
        signal: opts?.signal,
        fonts: useEditorStore.getState().project?.fonts,
        onMissingLayers: (count) =>
          Alert.alert(t('studio.image.missingInExport.title'), t('studio.image.missingInExport.body', { count })),
      });
    } catch (e) {
      // 🚫 I13: szándékos elutasítás — a tartalék a user elől rejtené el az okot
      if (e instanceof ImageRenderRejected) {
        rejectedRef.current = true;
        Alert.alert(t('studio.image.renderFailTitle'), e.message);
        return null;
      }
      throw e;
    }
  };

  /** A vászon képe az eszközön, a dokumentum felbontásán, vízjel és kijelölés-króm nélkül. */
  const captureCanvas = async (target: ImageDoc, height: number, opts?: { format?: 'png' | 'jpg' | 'webp'; quality?: number }) => {
    setCapturing(true);
    await new Promise((r) => setTimeout(r, 90)); // egy render-kör, kijelölés-króm nélkül
    try {
      const canvas = effectiveCanvas(target);
      const ratio = PixelRatio.get();
      // a view-shot a méretet képpontban várja — a dokumentum felbontására kérjük a képet
      return await captureRef(canvasRef, {
        format: opts?.format === 'jpg' ? 'jpg' : 'png',
        quality: opts?.quality ?? 1,
        ...captureViewSize(height, canvas, ratio),
      });
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:rasterize', caught);
      return null;
    } finally {
      setCapturing(false);
    }
  };

  /** az általános hibaablak — ha a szerver már megmondta az okot, nem duplázzuk */
  const alertRenderFail = () => {
    if (!rejectedRef.current) {
      Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
    }
  };

  return { rasterize, captureCanvas, alertRenderFail };
}

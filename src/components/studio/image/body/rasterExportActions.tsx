import type { TFunction } from 'i18next';
import * as Sharing from 'expo-sharing';
import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import { Alert } from 'react-native';

import { commitRendered, markExported } from '@/components/studio/image/body/exportCommon';
import type { createExportRasterizer } from '@/components/studio/image/body/exportRasterizer';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { ExportCancelled } from '@/lib/imageDocClient';
import { customExportSize, exportSize } from '@/lib/imageExport';
import { EXPORT_PACK_SCALES, expectsAlpha } from '@/lib/imageExportCheck';
import { logCaught } from '@/lib/logCaught';
import { saveImageToPhotos } from '@/lib/media';
import type { ImageDoc, Project } from '@/types/project';

type Rasterizer = ReturnType<typeof createExportRasterizer>;

export interface RasterExportDeps {
  t: TFunction;
  doc: ImageDoc | null;
  project: Project | null;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setExporting: Dispatch<SetStateAction<boolean>>;
  exportAbort: RefObject<AbortController | null>;
  rasterize: Rasterizer['rasterize'];
  alertRenderFail: Rasterizer['alertRenderFail'];
}

/**
 * 🖨️ A raszteres exportok: réteg / kijelölés, méretcsomag, a kép (megosztás vagy Fotók) — a
 * minőségkapuval és a leállítható (`exportAbort`) folyamattal. VISELKEDÉS-MEGŐRZŐ kiemelés a
 * `useImageExport`-ból, hook nélküli gyárként. `.tsx`: a fordítás-paritás őr innen is gyűjt.
 */
export function createRasterExportActions({ t, doc, project, busy, setBusy, setExporting, exportAbort, rasterize, alertRenderFail }: RasterExportDeps) {
  /** ✅ minőségkapu: a kész fájlt visszaolvassuk, a hibát a felhasználó is látja */
  const reportProblems = async (uri: string, target: ImageDoc, height: number, format: 'png' | 'jpg' | 'webp') => {
    markExported(project);
    const { verifyExport } = await import('@/components/studio/image/exportVerify');
    const problems = await verifyExport(uri, { ...customExportSize(target, height), format, wantsAlpha: expectsAlpha(target, format) });
    if (problems.length > 0) {
      logCaught('components/studio/image/ImageStudioBody.tsx:quality', new Error(`export minőségkapu: ${problems.join(',')}`));
      Alert.alert(t('studio.image.export.problemTitle'), problems.map((p) => t(`studio.image.export.problem.${p}`)).join('\n'));
    }
    return problems;
  };

  /** Egy réteg vagy kijelölés önálló képként, átlátszó háttéren. */
  const exportPart = async (part: ImageDoc | null) => {
    if (!doc || !part || busy) {
      return;
    }
    setBusy(true);
    exportAbort.current = new AbortController();
    setExporting(true);
    try {
      const height = effectiveCanvas(doc).height;
      const uri = await rasterize(part, { format: 'png', height, signal: exportAbort.current.signal });
      if (!uri) {
        alertRenderFail();
        return;
      }
      await reportProblems(uri, part, height, 'png');
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      }
    } catch (caught) {
      if (!(caught instanceof ExportCancelled)) {
        logCaught('components/studio/image/ImageStudioBody.tsx:exportPart', caught);
        alertRenderFail();
      }
    } finally {
      exportAbort.current = null;
      setExporting(false);
      setBusy(false);
    }
  };

  /** Méretcsomag: ugyanaz a kép több méretben a Fotókba. */
  const exportPack = async (opts: { format: 'png' | 'jpg' | 'webp'; quality: number }) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    exportAbort.current = new AbortController();
    setExporting(true);
    try {
      let saved = 0;
      for (const scale of EXPORT_PACK_SCALES) {
        const { height } = exportSize(doc, scale);
        const uri = await rasterize(doc, { ...opts, height, signal: exportAbort.current.signal });
        if (!uri) {
          alertRenderFail();
          return;
        }
        await reportProblems(uri, doc, height, opts.format);
        const res = await saveImageToPhotos(uri);
        if (res !== 'saved') {
          Alert.alert(t('studio.image.wand.failTitle'), t(res === 'denied' ? 'studio.image.export.saveDenied' : 'studio.image.export.saveFailed'));
          return;
        }
        saved += 1;
      }
      Alert.alert(t('studio.image.export.savedTitle'), t('studio.image.export.packDone', { count: saved }));
    } catch (caught) {
      if (!(caught instanceof ExportCancelled)) {
        logCaught('components/studio/image/ImageStudioBody.tsx:exportPack', caught);
        alertRenderFail();
      }
    } finally {
      exportAbort.current = null;
      setExporting(false);
      setBusy(false);
    }
  };

  const exportImage = async (opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number; target?: 'share' | 'photos' }) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    exportAbort.current = new AbortController();
    setExporting(true);
    try {
      const uri = await rasterize(doc, { ...opts, signal: exportAbort.current.signal });
      if (!uri) {
        alertRenderFail();
        return;
      }
      commitRendered(doc.id, uri);
      await reportProblems(uri, doc, opts?.height ?? effectiveCanvas(doc).height, opts?.format ?? 'png');
      if (opts?.target === 'photos') {
        const saved = await saveImageToPhotos(uri);
        if (saved === 'saved') {
          Alert.alert(t('studio.image.export.savedTitle'), t('studio.image.export.savedBody'));
        } else {
          Alert.alert(t('studio.image.wand.failTitle'), t(saved === 'denied' ? 'studio.image.export.saveDenied' : 'studio.image.export.saveFailed'));
        }
        return;
      }
      const canShare = await Sharing.isAvailableAsync().catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportImage', caught); return false; });
      if (canShare) {
        await Sharing.shareAsync(uri).catch((caught) => { logCaught('components/studio/image/ImageStudioBody.tsx:exportImage', caught); });
      } else {
        Alert.alert(t('studio.image.exportedTitle'), t('studio.image.exportedBody'));
      }
    } catch (caught) {
      // a felhasználó leállította: nincs hibaablak
      if (!(caught instanceof ExportCancelled)) {
        logCaught('components/studio/image/ImageStudioBody.tsx:exportImage', caught);
        alertRenderFail();
      }
    } finally {
      exportAbort.current = null;
      setExporting(false);
      setBusy(false);
    }
  };

  return { exportPart, exportPack, exportImage };
}

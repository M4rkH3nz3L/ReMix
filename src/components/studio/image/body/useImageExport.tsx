import { Directory, File, Paths } from 'expo-file-system';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, PixelRatio, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { type RenderStageHandle } from '@/components/studio/image/RenderStage';
import { flushProjectSave } from '@/hooks/useProjectAutosave';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { logCswcr, studioKindOf } from '@/lib/cswcrClient';
import { publishImageProject } from '@/lib/feed';
import { ExportCancelled, exportPsd, renderImageDoc, renderSvgPdf } from '@/lib/imageDocClient';
import { customExportSize, exportSize, ImageRenderRejected, imageDocContentKey, isRenderFresh } from '@/lib/imageExport';
import { EXPORT_PACK_SCALES, expectsAlpha } from '@/lib/imageExportCheck';
import { imageMimeForUri, pdfExportFileName, svgExportFileName } from '@/lib/imageExportFiles';
import { chooseImageRenderRoute } from '@/lib/imageRenderRoute';
import type { ImageShareMode } from '@/lib/imageShare';
import { sendStillToVideo } from '@/lib/linkedAssetClient';
import { logCaught } from '@/lib/logCaught';
import { saveImageToPhotos } from '@/lib/media';
import { jpegToPdf } from '@/lib/rasterPdf';
import { listProjects, loadProject } from '@/lib/storage';
import { imageDocToSvg, svgDocSize } from '@/lib/svgExport';
import { useActionMenu } from '@/store/actionMenuStore';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { useSeoGate } from '@/store/seoGateStore';
import type { ImageDoc, Project } from '@/types/project';
import type { PostVisibility } from '@/types/social';

/**
 * 🖨️ A Kép Stúdió render- és export-rétege: raszterizálás (telefon / worker), a vászon pillanatképe,
 * a kép / réteg / méretcsomag / SVG / PDF / PSD export, a videóba küldés, a feed-megosztás és a
 * scoped mentés. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból: a függvények szó szerint a
 * body-ban voltak; a közös állapot (`busy`, `capturing`) a body-é, ide propként jön. A `.tsx`
 * kiterjesztés szándékos: a fordítás-paritás őr (`imageLocaleParity`) a `studio/image` `.tsx`
 * fájljaiból gyűjti a `t()`-kulcsokat — így az itteni feliratok is ellenőrzöttek maradnak.
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
  /**
   * 🖼️ A dokumentum raszterizálása — OFFLINE FIRST (CORE K1): elsőként a TELEFON renderel
   * (`RenderStage`: a vászon réteg-fája rejtetten, a kért pixelméreten, bármely lapra). A
   * worker csak a telefonon nem rajzolható effektekért kell (`serverOnlyEffects`), illetve
   * tartalék, ha a telefonos render nem sikerült.
   */
  const rejectedRef = useRef(false);
  const renderStageRef = useRef<RenderStageHandle>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const [exporting, setExporting] = useState(false);
  const rasterize = async (
    target: ImageDoc,
    opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number; signal?: AbortSignal }
  ): Promise<string | null> => {
    rejectedRef.current = false;
    const height = opts?.height ?? target.height ?? 1280;
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
        width: Math.round((height * (canvas.width / canvas.height)) / ratio),
        height: Math.round(height / ratio),
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

  // 💾 I4: a kész renderelt kép a store FRISS doc-jára kerül — a render alatt tett
  // szerkesztések nem állnak vissza az `await` előtt elkapott állapotra
  const commitRendered = (docIdToUpdate: string, renderedUri: string) => {
    const s = useEditorStore.getState();
    const fresh = s.project?.imageDocs?.find((d) => d.id === docIdToUpdate);
    if (fresh) {
      s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: { ...fresh, renderedUri, renderedKey: imageDocContentKey(fresh) }, label: 'render' });
    }
  };

  /** ✅ minőségkapu: a kész fájlt visszaolvassuk, a hibát a felhasználó is látja */
  /** 📊 CSWCR (CORE K4): a Kép Stúdió exportja befejezi a láncot (export / poszt / csomag) */
  const markExported = () => {
    if (project) logCswcr({ type: 'export', projectId: project.id, kind: studioKindOf(project.kind) });
  };
  const reportProblems = async (uri: string, target: ImageDoc, height: number, format: 'png' | 'jpg' | 'webp') => {
    markExported();
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

  /**
   * 🧩 ÖNÁLLÓ SVG a dokumentumból ([svgExport](@/lib/svgExport)): a fotó-rétegeket
   * base64 data-URI-ba ágyazzuk, hogy a kimenet önmagában megálljon (SVG + PDF közös).
   */
  const buildExportSvg = (d: ImageDoc): string => {
    const embedded = {
      ...d,
      layers: d.layers.map((l) => {
        if (l.kind === 'photo' && typeof l.uri === 'string' && l.uri.startsWith('file://')) {
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
      markExported();
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
      const height = Math.min(4096, effectiveCanvas(doc).height);
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
      markExported();
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
      markExported();
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
      markExported();
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

  // 🖼️→🎬 CORE K2 (IMAGE-PROD C2): a lap HIVATKOZÁSKÉNT egy új vagy meglévő videó-projektbe. A kép a
  // telefonon készül, a klip a rétegeket is hordozza; a lap későbbi módosítása a videóban
  // „Frissítés elérhető” → egy koppintás, egy visszavonás.
  const sendToVideo = async (target: Awaited<ReturnType<typeof loadProject>>) => {
    if (!doc || !project || busy) {
      return;
    }
    setBusy(true);
    try {
      // előbb a kép-projekt mentése: a hivatkozás verziója a TÁROLT laphoz igazodjon
      await flushProjectSave();
      const fresh = useEditorStore.getState().project?.imageDocs?.find((d) => d.id === doc.id) ?? doc;
      const uri = await rasterize(fresh);
      if (!uri) {
        alertRenderFail();
        return;
      }
      const vid = await sendStillToVideo(project, fresh, uri, target, { newName: t('studio.image.videoName', { name: project.name }) });
      router.replace(`/editor/${vid.id}`);
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:sendToVideo', caught);
      Alert.alert(t('studio.image.toVideo.title'), (caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const pickVideoProject = async () => {
    const metas = (await listProjects()).filter((m) => (m.kind ?? 'video') === 'video' && m.id !== project?.id).slice(0, 8);
    if (metas.length === 0) {
      Alert.alert(t('studio.image.toVideo.title'), t('studio.image.toVideo.noVideos'));
      return;
    }
    useActionMenu.getState().open(
      t('studio.image.toVideo.pickTitle'),
      metas.map((m) => ({
        label: m.name,
        icon: 'videocam-outline',
        onPress: () => {
          void loadProject(m.id).then((p) => (p ? sendToVideo(p) : undefined));
        },
      }))
    );
  };
  const insertIntoVideo = () => {
    useActionMenu.getState().open(t('studio.image.toVideo.title'), [
      { label: t('studio.image.toVideo.newLinked'), icon: 'link-outline', onPress: () => void sendToVideo(null) },
      { label: t('studio.image.toVideo.existing'), icon: 'film-outline', onPress: () => void pickVideoProject() },
    ]);
  };

  /**
   * 🖼️➡️📲 A galéria megosztása a FEEDBE — diavetítés (videó) vagy lapozható (carousel).
   * Előbb MINDEN lapot rasterizálunk (renderelt PNG), majd a `publishImageProject` a megfelelő
   * poszttá alakítja. (Felhő-funkció: a render/feltöltés a workert/tárat igényli — a free a
   * telefonon marad; a hiba barátságosan jelenik meg.)
   */
  // I43: a megosztás nem azonnal nyilvános — a user választ láthatóságot
  const confirmShare = (shareMode: ImageShareMode) => {
    Alert.alert(t('studio.image.shareFeed.confirmTitle'), t('studio.image.shareFeed.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.image.shareFeed.followers'), onPress: () => void shareToFeed(shareMode, 'followers') },
      { text: t('studio.image.shareFeed.public'), onPress: () => void shareToFeed(shareMode, 'public') },
    ]);
  };

  const shareToFeed = async (shareMode: ImageShareMode, visibility: PostVisibility) => {
    const s = useEditorStore.getState();
    if (!s.project || busy) {
      return;
    }
    // 📣 S22: a SEO a megosztáskor kell (létrehozáskor elhagyható volt) — hiányzik → bekéri
    if (!(await useSeoGate.getState().ensureSeo(s.project))) {
      return;
    }
    setBusy(true);
    try {
      for (const p of pages) {
        // I41: a szerkesztés után elavult képet nem osztjuk meg
        if (!isRenderFresh(p)) {
          const uri = await rasterize(p);
          if (!uri) {
            // I12: inkább nem osztunk meg semmit, mint rossz lapot
            alertRenderFail();
            return;
          }
          commitRendered(p.id, uri);
        }
      }
      const fresh = useEditorStore.getState().project;
      if (!fresh) {
        return;
      }
      await publishImageProject(fresh, shareMode, { visibility });
      Alert.alert(
        t('studio.image.shareFeed.doneTitle', { defaultValue: 'Megosztva' }),
        t('studio.image.shareFeed.doneBody', { defaultValue: 'A poszt felkerült a feedbe.' })
      );
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:shareToFeed', e);
      Alert.alert(t('common.error'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveScoped = async () => {
    if (!doc || busy) {
      onExit();
      return;
    }
    if (!onSave) {
      onExit();
      return;
    }
    setBusy(true);
    try {
      const uri = await rasterize(doc);
      await onSave(doc, uri);
    } finally {
      setBusy(false);
    }
  };

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

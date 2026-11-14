import AsyncStorage from '@react-native-async-storage/async-storage';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { AlphaType, ColorType, drawAsImage, Group, ImageFormat, Skia, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef, Profiler, useEffect, useRef } from 'react';
import { createAudioPlayer, getRecordingPermissionsAsync, RecordingPresets, useAudioRecorder, type AudioRecorder } from 'expo-audio';
import { AppState, Dimensions, Modal, PixelRatio, Platform, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { BrushOverlay, type BrushHandle, renderStrokes } from '@/components/studio/image/BrushOverlay';
import { BrushBar } from '@/components/studio/image/body/BrushBar';
import { SelectionBar } from '@/components/studio/image/body/SelectionBar';
import { Asset } from 'expo-asset';
import { layerSkPath, offsetToResult, skiaBooleanEngine, strokeToResult, withResult } from '@/components/studio/image/skiaVector';
import { booleanCombineInDoc } from '@/lib/imageBoolean';
import { anchorFromDrag, type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
import { moveAnchor, pathEditPatch, pathEditView, setNodeType } from '@/lib/vectorPath';
import { projectMaskToCanvas } from '@/components/studio/image/projectMask';
import { foregroundMask } from '@/lib/foregroundMask';
import { AssistantBar } from '@/components/studio/image/body/AssistantBar';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { loadBrandStyle, saveBrandStyle } from '@/lib/brandStore';
import { remixFromPost } from '@/lib/feed';
import { remixRoute } from '@/lib/imageRemix';
import { loginWithIdentifier } from '@/lib/loginIdentifier';
import { useActionMenu } from '@/store/actionMenuStore';
import { LayerMenuSheet } from '@/components/studio/image/LayerMenuSheet';
import { LiveQuickGrid } from '@/components/live/LiveQuickGrid';
import { MultiSelectBar } from '@/components/studio/image/body/MultiSelectBar';
import { BASE_PX_PER_SEC, MAX_ZOOM } from '@/constants/editor';
import { endLive, startLive } from '@/lib/live';
import { setRecord } from '@/lib/liveDoc';
import { RecordToggle } from '@/components/live/RecordToggle';
import { DEFAULT_PALETTE, encodeFrame, floodFill, paintLine, pixelLayerBox, pixelLayerScale, type PixelArt, type PixelFrame } from '@/lib/pixelArt';
import { writeLayerPng, writePixelGif, writeSpriteSheet } from '@/lib/pixelArtClient';
import { PixelStudio } from '@/components/studio/image/PixelStudio';
import type { FeedPost } from '@/types/social';
import { type Href, router } from 'expo-router';
import { useBrandStyle } from '@/store/brandStyleStore';
import { TemplatesSheet } from '@/components/studio/image/TemplatesSheet';
import { docFromTemplate, IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { addImageDocToVideo } from '@/lib/imageToVideo';
import { variantDoc } from '@/lib/imageVariants';
import { applyImageCommands, parseImageIntent } from '@/lib/imageIntent';
import { logCaught } from '@/lib/logCaught';
import { ExportCancelled } from '@/lib/imageDocClient';
import { photoBytesPerPixel } from '@/components/studio/image/exportEstimate';
import { readExportFacts } from '@/components/studio/image/exportVerify';
import { expectsAlpha, exportProblems, layerOnlyDoc, selectionOnlyDoc } from '@/lib/imageExportCheck';
import { customExportSize, formatBytes } from '@/lib/imageExport';
import { downloadToCache, ingestImageFile, probeAudioDuration, readFileTags } from '@/lib/media';
import { tagLabel } from '@/lib/audioTags';
import { exportAudioFile, exportAudioToFile, isRenderCancelledError } from '@/lib/render';
import { audioExportFileName, audioExportSettings } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { AudioExportSheet } from '@/components/studio/audio/AudioExportSheet';
import { analyzeMixOnDevice } from '@/lib/mixAssistClient';
import { runDevAction } from '@/lib/devActions';
import { recordingPhase } from '@/lib/interruption';
import { CLIP_LEVEL, levelDb, trackLevelAt } from '@/lib/levelMeter';
import { mixRange, offlineMixPlan } from '@/lib/offlineMix';
import type { WaveformData } from '@/lib/waveform';
import { startSyncProbe, stopSyncProbe, summarizeDrift } from '@/lib/audioSyncProbe';
import { exportOfflineWav, measureStretchLatency, probeStretchTiming } from '@/lib/offlineMixClient';
import { canRenderLocally, renderLocal } from '@/lib/nativeRender';
import { previewEngine } from '@/lib/previewEngine';
import { barsBeatsLabel, beatSplitTimes } from '@/lib/audioTransport';
import { useProgressStore } from '@/store/progressStore';
import { useRecordPrefs } from '@/store/recordPrefsStore';
import { cloudAvailable } from '@/lib/backend';
import { clickSample } from '@/lib/metronome';
import { highShelfNorm, KERNEL, nativeDspActive, runKernel, runKernelJs, type KernelKind } from '@/lib/dspKernels';
import '@/lib/dspNativeClient';
import { canSpeakOnDevice } from '@/lib/ttsOnDevice';
import { useAuth } from '@/store/authStore';
import { useCollabLive } from '@/store/collabLiveStore';
import { ensureShared, inviteMember, pullSharedProject, removeMember, respondToInvite } from '@/lib/collab';
import { deleteCloudProject } from '@/lib/cloudSync';
import { canUseCloud } from '@/lib/backend';
import { lastTakeAlign, setTakeAlignForTest } from '@/lib/recordTakeClient';
import { selectTakeCommand } from '@/lib/punchRecord';
import { dbToVolume } from '@/lib/clipGain';
import { tempoMatchPatch } from '@/lib/tempoMatch';
import { moveStage } from '@/lib/fxOrder';
import { masterPreset } from '@/lib/audioMaster';
import { useReference } from '@/store/referenceStore';
import { applyReference, measureReference } from '@/lib/referenceClient';
import { measureMastered } from '@/lib/mixAssistClient';
import { previewLocalUri } from '@/lib/previewRemoteCache';
import { canExtractAudio, extractVideoAudio } from '@/lib/videoAudioImport';
import { useSilenceReview } from '@/store/silenceReviewStore';
import { useSpeechEdit } from '@/store/speechEditStore';
import { currentSpeechWords } from '@/components/studio/audio/SpeechEditBar';
import { clearSpeechWordCache } from '@/lib/speechEditClient';
import { wordCutRanges } from '@/lib/speechEdit';
import { gccPhatLag, SYNC_MIN_CONFIDENCE } from '@/lib/audioSync';
import { syncClipTo } from '@/lib/audioSyncClient';
import { exportParts } from '@/components/studio/audio/exportParts';
import { auditionDrum, auditionNote, lastLoopPcm, lastStartMs, playPcm, previewLooping, previewPosition, stopPreview, warmPreview } from '@/lib/instrumentPreview';
import { DRUM_ACCENT, DRUM_SOFT, emptyPattern, patternHits } from '@/lib/drums';
import { renderDrumsPcm, renderSamplerPcm, renderSynthPcm } from '@/lib/instrumentRender';
import { decodeSample } from '@/lib/instrumentClient';
import { instrumentDocOf } from '@/lib/instrumentDoc';
import { emptySampler } from '@/lib/sampler';
import { applyCommand } from '@/lib/commands';
import { linkedAssets, mixdownVersion, relinkPlan } from '@/lib/linkedAsset';
import { sendMixdownToVideo, sourceVersionOf } from '@/lib/linkedAssetClient';
import { clearCswcrLog, logCswcr, type CswcrStats } from '@/lib/cswcrClient';
import { USER_PRESETS_KEY, useUserPresets } from '@/store/userPresetStore';
import { useAudioEditMode } from '@/store/audioEditModeStore';
import type { CheckIssue } from '@/lib/audioCheck';
import { runAudioCheck } from '@/lib/audioCheckClient';
import { devTypeAssistant, parseNow } from '@/components/studio/audio/AudioAssistantBar';
import { ASR_HINT, type AudioIntentResult } from '@/lib/audioIntent';
import { renderSynthToClip } from '@/lib/synthClient';
import { renderDrumsToClip } from '@/lib/drumsClient';
import { renderSamplerToClip } from '@/lib/samplerClient';
import { audioLanes, laneLabel } from '@/components/studio/audio/audioLanes';
import { crc32, localDataOffset, parseCentralDirectory, parseEocd } from '@/lib/zipStore';
import { t as i18nT, type TFunction } from 'i18next';
import { canSegment, LongSource, setLongThresholdForTest } from '@/lib/longSource';
import { whisperEngineAvailable } from '@/lib/nativeEngines';
import { catalogRuntime, downloadModel, listCachedModels, removeModel } from '@/lib/modelRegistryClient';
import { bestUsableWhisperModelId, lastRawTokens, runWhisperSmokeTest, transcribeMediaOnDevice, transcribeWordsOnDevice } from '@/lib/whisperClient';
import { catalogAvailability, catalogEntry } from '@/lib/modelCatalog';
import { decodeToMono16k } from '@/lib/audioDecode';
import { findClipSilences } from '@/lib/audioSilenceClient';
import { LiveLoudness } from '@/lib/liveLoudness';
import { integratedLoudness } from '@/lib/loudness';
import { getStretchProxySync, stretchProxyKey } from '@/lib/stretchProxy';
import { trimAudioRight } from '@/lib/audioTrim';
import type { RenderSettings } from '@/lib/render';
import { encodeWav16, wavHeader16 } from '@/lib/offlineMix';
import { detectBeats, lastBeatPath } from '@/lib/beats';
import { canDetachAudio, detachAudioCommands } from '@/lib/audioExtract';
import { freeDiskBytes, setFreeDiskOverride } from '@/lib/diskSpaceClient';
import { EXPORT_SPACE_MARGIN, RECORD_STOP_FREE, wavBytes } from '@/lib/diskSpace';
import { addSong, initAlbum, makeSong } from '@/lib/albumDoc';
import { AlbumSheet } from '@/components/studio/audio/AlbumSheet';
import { AudioOnlyExportSection } from '@/components/editor/panels/AudioOnlyExportSection';
import { startVoiceRecording, stopVoiceRecording, voiceoverClip } from '@/lib/voiceRecording';
import { useFinishRecordingOnLeave } from '@/hooks/useFinishRecordingOnLeave';
import { audioApiState, loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { clearWaveformMemory, clipWindowPeaks, getWaveform, lastWaveformMode, WAVEFORM_PPS, waveformCacheKey } from '@/lib/waveform';
import { mixForExport } from '@/lib/audioExportMix';
import { classifyAudioIntake } from '@/lib/audioIntake';
import { supabase } from '@/lib/supabase';
import { layerHistogram } from '@/components/studio/image/HistogramView';
import { HslSheet } from '@/components/studio/image/HslSheet';
import { computeHistogram, histogramShift } from '@/lib/histogram';
import { SelectionAnts } from '@/components/studio/image/SelectionAnts';
import { updateLayer } from '@/lib/imageDoc';
import { adjustSelection, copySelectionToLayer, deleteSelection, maskFromSelection } from '@/lib/imageSelectionOps';
import { applyRing, ellipseRing, invertSelection, rectRing, selectionToMask } from '@/lib/selection';
import { DEFAULT_BRUSH, type RetouchTool, type Stroke } from '@/lib/brushEngine';
import { ImageCanvas } from '@/components/studio/image/ImageCanvas';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { PhotoSkiaContent, makeLutImage } from '@/components/studio/image/SkiaPhotoLayer';
import { flushProjectSave, useProjectAutosave } from '@/hooks/useProjectAutosave';
import { rotateCanvasDoc } from '@/lib/imageCanvasOps';
import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { renderImageDoc } from '@/lib/imageDocClient';
import { LUT_DRAFT_SIZE, LUT_SIZE } from '@/lib/imagePreviewLut';
import { exportSize } from '@/lib/imageExport';
import { makeId } from '@/lib/id';
import { magicWandSelect } from '@/lib/magicWandClient';
import { normalizePickedImage } from '@/lib/media';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { createEmptyProject, splitClip } from '@/lib/projectUtils';
import { cloudBaseUrl, serverHost } from '@/lib/backend';
import Constants from 'expo-constants';
import { deleteProject, listProjects, loadProject, loadVersions, readRecovery, recoveryIsFresher, saveProjectAndEvents, saveProject, writeRecovery, clearRecovery } from '@/lib/storage';
import { findMissingMedia } from '@/lib/videdFile';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, ImageClip, VideoClip, ImageDoc, ImageLayer, PhotoLayer, Project, ShapeLayer } from '@/types/project';

type Log = (ok: boolean | null, name: string, detail?: string) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function decode(uri: string): Promise<SkImage> {
  const bytes = await new File(uri).bytes();
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBytes(bytes));
  if (!img) {
    throw new Error(`nem dekódolható: ${uri}`);
  }
  return img;
}

function pixel(img: SkImage, x: number, y: number): number[] {
  const px = img.readPixels(x, y, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return px ? [...px] : [];
}

/** átlátszó vászon, közepén piros négyzet — az alfa-megőrzés próbájához */
function alphaImage(format: ImageFormat, ext: string): string {
  const surface = Skia.Surface.MakeOffscreen(64, 64)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#ff0000'));
  surface.getCanvas().drawRect(Skia.XYWHRect(20, 20, 24, 24), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_alpha_${Date.now().toString(36)}.${ext}`);
  file.write(surface.makeImageSnapshot().encodeToBytes(format));
  return file.uri;
}

function removeFile(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    /* takarítás — best-effort */
  }
}

async function smokeNetwork(log: Log) {
  const base = cloudBaseUrl();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal });
    log(res.ok, 'telefon → worker', `${base} HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    log(false, 'telefon → worker', `${base}: ${(e as Error).message}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function smokeBrush(log: Log) {
  const box = { w: 300, h: 300 };
  // vízszintes vonal a vászon közepén, 10 képpont vastag a képernyőn
  const stroke = { points: [{ x: 0.1, y: 0.5, p: 1 }, { x: 0.9, y: 0.5, p: 1 }], color: '#ff0000', width: 10 / box.w, hardness: 1, opacity: 1, eraser: false };
  const img = renderStrokes([stroke], 2160, 2160);
  if (!img) {
    log(false, 'I19 ecset offscreen', 'nincs GPU-felület');
    return;
  }
  log(img.width() === 2160 && img.height() === 2160, 'I19 ecset doc-felbontáson', `${img.width()}×${img.height()}`);
  const inside = pixel(img, 1080, 1080 - 30)[3]; // a 72 px vastag vonalon belül
  const outside = pixel(img, 1080, 1080 - 60)[3]; // azon kívül
  log(inside > 200 && outside === 0, 'I19 a vonal arányosan skálázódik (72 px)', `belül α=${inside}, kívül α=${outside}`);
  // a nagy felbontás éles él: a vonal széle pár pixelen belül vált (nem egy elmosódott nagyítás)
  let edge = 0;
  for (let y = 1080 - 40; y < 1080 - 30; y++) {
    const a = pixel(img, 1080, y)[3];
    if (a > 10 && a < 245) {
      edge += 1;
    }
  }
  log(edge <= 3, 'I19 éles él', `${edge} átmeneti pixel`);
}

async function smokeIntake(log: Log) {
  for (const [name, format, ext] of [['WebP', ImageFormat.WEBP, 'webp'], ['PNG', ImageFormat.PNG, 'png']] as const) {
    const src = alphaImage(format, ext);
    const out = await normalizePickedImage(src, 64, 64);
    const img = await decode(out.uri);
    const corner = pixel(img, 2, 2);
    const center = pixel(img, 32, 32);
    log(/\.png$/.test(out.uri) && corner[3] === 0 && center[3] === 255, `I21 átlátszó ${name} import`, `${out.uri.split('.').pop()} sarok α=${corner[3]} közép α=${center[3]}`);
    removeFile(src);
    removeFile(out.uri);
  }
  const jpg = alphaImage(ImageFormat.JPEG, 'jpg');
  const out = await normalizePickedImage(jpg, 64, 64);
  log(/\.jpg$/.test(out.uri), 'I21 JPEG JPEG marad', out.uri.split('.').pop());
  removeFile(jpg);
  removeFile(out.uri);
}

function testDoc(extra: Partial<ImageDoc> = {}): ImageDoc {
  const base = createImageDoc('Smoke', '1:1', () => makeId('lyr'), { width: 1080, height: 1080 });
  // üres, átlátszó vászon: a háttér-réteg nélkül látszik, ha a capture hozza a keretet/hátteret
  const doc: ImageDoc = { ...base, layers: [], ...extra };
  const shape = { kind: 'shape', id: makeId('lyr'), shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff0000' } as ShapeLayer;
  return addLayer(doc, shape as ImageLayer);
}

async function smokeCapture(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const doc = testDoc();
  const ref = createRef<View>() as RefObject<View>;
  setHarness(
    <View style={{ width: 280, height: 280 }}>
      <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
    </View>
  );
  await sleep(900);
  const uri = await captureRef(ref, { format: 'png', quality: 1, width: Math.round(1080 / ratio), height: Math.round(1080 / ratio) });
  const img = await decode(uri);
  log(Math.abs(img.width() - 1080) <= 2 && Math.abs(img.height() - 1080) <= 2, 'I12 offline kép doc-felbontáson', `${img.width()}×${img.height()}, ratio ${ratio}`);
  const w = img.width();
  const corner = pixel(img, 1, 1);
  const edge = pixel(img, Math.round(w / 2), 1);
  const center = pixel(img, Math.round(w / 2), Math.round(w / 2));
  log(corner[3] === 0 && edge[3] === 0, 'I12 nincs keret / háttér, átlátszó', `sarok ${corner} perem ${edge}`);
  log(center[0] > 240 && center[1] < 15 && center[3] === 255, 'I12 a tartalom megvan', `közép ${center}`);
  removeFile(uri);
  setHarness(null);
}

/** 200×100-as kép: bal 70% piros, jobb 30% kék — aszimmetrikus, hogy a rossz leképezés kilógjon */
function wandImage(): string {
  const surface = Skia.Surface.MakeOffscreen(200, 100)!;
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#ff0000'));
  canvas.drawRect(Skia.XYWHRect(0, 0, 140, 100), paint);
  paint.setColor(Skia.Color('#0000ff'));
  canvas.drawRect(Skia.XYWHRect(140, 0, 60, 100), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_wand_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  return file.uri;
}

async function smokeWand(log: Log) {
  const uri = wandImage();
  // cover négyzetes dobozban: a kép középső fele látszik (0,25–0,75), a kék 0,7-től → dobozban 0,9-től
  const outline = await magicWandSelect(uri, 0.95, 0.5, 32, { boxAspect: 1, fit: 'cover' });
  const xs = (outline ?? []).map((p) => p.x);
  const min = Math.min(...xs);
  log(!!outline && Math.abs(min - 0.9) < 0.03 && Math.max(...xs) <= 1, 'I33 pálca cover-illesztésnél a kék sávot jelöli', `dobozban x=${min.toFixed(3)}…${Math.max(...xs).toFixed(3)}`);
  const margin = await magicWandSelect(uri, 0.5, 0.05, 32, { boxAspect: 1, fit: 'contain' });
  log(margin === null, 'I33 contain-margóra koppintás nem jelöl ki semmit');
  removeFile(uri);
}

async function smokeZoomCanvas(log: Log, setHarness: (n: ReactNode) => void) {
  const doc = testDoc();
  const layerId = doc.layers[0].id;
  setHarness(
    <View style={{ width: 280, height: 280 }}>
      <ImageCanvas doc={doc} selectedId={layerId} onSelect={() => {}} commit={() => {}} />
    </View>
  );
  await sleep(900);
  log(true, 'I36 a vászon kijelöléssel, kétujjas-pan gesztussal felépül a natív rétegen');
  setHarness(null);
}

/** A valódi vászon kilógó réteggel, kijelölve — képernyőképhez (a fázis nyitva marad). */
async function smokePasteboard(log: Log, setHarness: (n: ReactNode) => void) {
  const base = createImageDoc('Smoke', '1:1', () => makeId('lyr'), { width: 1080, height: 1080 });
  const shape = { kind: 'shape', id: 'over', shape: 'ellipse', position: { x: 0.9, y: 0.5 }, w: 0.6, h: 0.6, fill: '#ff2d95' } as ShapeLayer;
  const doc = addLayer({ ...base, layers: [] }, shape as ImageLayer);
  setHarness(
    <View style={{ width: 340, height: 320 }}>
      <ImageCanvas doc={doc} selectedId="over" initialZoom={0.5} onSelect={() => {}} commit={() => {}} />
    </View>
  );
  await sleep(800);
  log(null, 'PASTEBOARD-READY');
}

/** A valódi réteg- és vászon-lapok (képernyőképhez). */
async function smokeSheets(log: Log, setHarness: (n: ReactNode) => void) {
  const doc = testDoc();
  const id = doc.layers[0].id;
  setHarness(
    <View style={{ width: 380, height: 320 }}>
      <LayerPanel doc={doc} selectedId={id} onSelect={() => {}} onMergeDown={() => {}} onRasterize={() => {}} onFlatten={() => {}} commit={() => {}} onClose={() => {}} />
    </View>
  );
  await sleep(1200);
  log(null, 'SHEETS-READY');
}

/** Vászon-művelet a telefonról, a valódi workeren át. */
async function smokeCanvasOps(log: Log) {
  const base = createImageDoc('Smoke', '1:1', () => makeId('lyr'), { width: 400, height: 200 });
  const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.25, y: 0.5 }, w: 0.5, h: 1, fill: '#ff0000' } as ShapeLayer;
  const doc = addLayer({ ...base, layers: [] }, shape as ImageLayer);
  const rotated = rotateCanvasDoc(doc, 90);
  const uri = await renderImageDoc(rotated, rotated.height);
  if (!uri) {
    log(false, 'vászon-forgatás a telefonról', 'nincs render');
    return;
  }
  const img = await decode(uri);
  // 400×200 balfele piros → 90° jobbra: 200×400, a FELSŐ fele piros
  log(img.width() === 200 && img.height() === 400 && pixel(img, 100, 100)[0] > 240 && pixel(img, 100, 300)[3] === 0, 'vászon-forgatás 90° a telefonról', `${img.width()}×${img.height()} felül ${pixel(img, 100, 100)} alul ${pixel(img, 100, 300)}`);
  removeFile(uri);
}

/** 🎨 Az előnézet a valódi Skia-kimeneten, a valódi szerver-render ellen mérve. */
async function smokeParity(log: Log) {
  const COLORS = ['#c83c28', '#28a050', '#3246c8', '#808080', '#e6dcc8', '#1e1928', '#f0c83c', '#5a2878'];
  const surface = Skia.Surface.MakeOffscreen(320, 40)!;
  const paint = Skia.Paint();
  COLORS.forEach((c, i) => {
    paint.setColor(Skia.Color(c));
    surface.getCanvas().drawRect(Skia.XYWHRect(i * 40, 0, 40, 40), paint);
  });
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_par_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const source = await decode(file.uri);
  const cases: [string, Partial<PhotoLayer>][] = [
    ['nincs', { adjust: { contrast: 0.0001 } }],
    ['kontraszt', { adjust: { contrast: 0.3 } }],
    ['telítettség', { adjust: { saturation: 0.5 } }],
    ['hőmérséklet', { adjust: { temperature: 0.2 } }],
    ['vibrance', { adjust: { vibrance: 0.6 } }],
    ['hue', { adjust: { hue: 0.25 } }],
    ['szintek', { levels: { black: 0.1, white: 0.8, gamma: 1.4 } }],
    ['grade', { grade: 'teal-orange' }],
    ['filterId', { filterId: 'warm', filterIntensity: 1 }],
    ['gradient-map', { gradientMap: { shadow: '#102040', highlight: '#ffcc80' } }],
  ];
  const canvas = { width: 320, height: 320 };
  for (const [name, patch] of cases) {
    const layer = { kind: 'photo', id: 'p', uri: file.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...patch } as PhotoLayer;
    const preview = await drawAsImage(
      <PhotoSkiaContent image={source} lut={makeLutImage(layer)} layer={layer} w={320} h={320} scale={1} canvas={canvas} />,
      { width: 320, height: 320 }
    );
    const uri = await renderImageDoc({ id: 'par', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [layer] } as unknown as ImageDoc, 320);
    if (!preview || !uri) {
      log(false, `előnézet = export: ${name}`, 'nincs kép');
      continue;
    }
    const real = await decode(uri);
    let worst = 0;
    for (let i = 0; i < COLORS.length; i++) {
      const a = pixel(preview, i * 40 + 20, 60);
      const b = pixel(real, i * 40 + 20, 60);
      worst = Math.max(worst, ...[0, 1, 2].map((k) => Math.abs(a[k] - b[k])));
    }
    log(worst <= 14, `előnézet = export: ${name}`, `legnagyobb eltérés ${worst}/255`);
    removeFile(uri);
  }
  // vágás és átlátszóság: rácspontonként az alfa
  const shapes: [string, Partial<PhotoLayer>][] = [
    ['téglalap-maszk', { mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005 } }],
    ['ellipszis-maszk', { mask: { shape: 'ellipse', x: 0.4, y: 0.6, w: 0.5, h: 0.4, feather: 0.005 } }],
    ['fordított maszk', { mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005, invert: true } }],
    ['poligon-maszk forgatott rétegen', { rotation: 30, w: 0.7, h: 0.7, mask: { shape: 'polygon', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005, points: [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.35 }, { x: 0.55, y: 0.7 }] } }],
  ];
  for (const [name, patch] of shapes) {
    const layer = { kind: 'photo', id: 'p', uri: file.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...patch } as PhotoLayer;
    const lw = 320 * layer.w;
    const lh = 320 * layer.h;
    const preview = await drawAsImage(
      <Group transform={[{ translate: [160, 160] }, { rotate: ((layer.rotation ?? 0) * Math.PI) / 180 }, { translate: [-lw / 2, -lh / 2] }]}>
        <PhotoSkiaContent image={source} lut={null} layer={layer} w={lw} h={lh} scale={1} canvas={canvas} />
      </Group>,
      { width: 320, height: 320 }
    );
    const uri = await renderImageDoc({ id: 'par', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [layer] } as unknown as ImageDoc, 320);
    if (!preview || !uri) {
      log(false, `vágás = export: ${name}`, 'nincs kép');
      continue;
    }
    const real = await decode(uri);
    let bad = 0;
    let total = 0;
    // a vízjel az alsó sávban van, azt kihagyjuk
    for (let y = 10; y < 280; y += 12) {
      for (let x = 10; x < 320; x += 12) {
        total += 1;
        if (Math.abs(pixel(preview, x, y)[3] - pixel(real, x, y)[3]) > 90) {
          bad += 1;
        }
      }
    }
    log(bad / total <= 0.03, `vágás = export: ${name}`, `${bad}/${total} rácspont tér el`);
    removeFile(uri);
  }
  removeFile(file.uri);
}

/** Mérési segéd: két kép eltérése rácspontonként (alfa + szín, ahol mindkettő fedő). */
function gridDiff(a: SkImage, b: SkImage, size: number, stop: number): { bad: number; total: number } {
  let bad = 0;
  let total = 0;
  for (let y = 8; y < stop; y += 12) {
    for (let x = 8; x < size; x += 12) {
      total += 1;
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      const color = p[3] > 128 && q[3] > 128 ? Math.max(...[0, 1, 2].map((k) => Math.abs(p[k] - q[k]))) : 0;
      if (Math.abs(p[3] - q[3]) > 70 || color > 40) {
        bad += 1;
      }
    }
  }
  return { bad, total };
}

/** 🔬 A második kör mérései: sebesség, effektek, és a TELJES valódi vászon. */
async function smokeDeep(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const heavy = { kind: 'photo', id: 'h', uri: 'x', position: { x: 0.5, y: 0.5 }, w: 1, h: 1, adjust: { contrast: 0.2, saturation: 0.3, vibrance: 0.4, hue: 0.1, highlights: 0.3, temperature: 0.1 }, grade: 'teal-orange', levels: { black: 0.05, white: 0.95, gamma: 1.2 } } as unknown as PhotoLayer;
  const time = (size: number) => {
    const t0 = Date.now();
    for (let i = 0; i < 10; i++) {
      makeLutImage(heavy, [], size);
    }
    return (Date.now() - t0) / 10;
  };
  const draft = time(LUT_DRAFT_SIZE);
  log(draft < 34, 'csúszka-költség húzás közben', `${draft.toFixed(1)} ms (cél: 33 ms alatt)`);
  log(null, 'pontos LUT megálláskor', `${time(LUT_SIZE).toFixed(1)} ms`);

  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#3070d0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 320, 320), paint);
  paint.setColor(Skia.Color('#f0c040'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 160, 160), paint);
  surface.flush();
  const file = new File(projectMediaDir(), `smoke_deep_${Date.now().toString(36)}.png`);
  file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const source = await decode(file.uri);
  const canvas = { width: 320, height: 320 };
  const small = { kind: 'photo', id: 'p', uri: file.uri, position: { x: 0.5, y: 0.45 }, w: 0.5, h: 0.5, fit: 'stretch' } as PhotoLayer;

  const effects: [string, Partial<PhotoLayer>][] = [
    ['vetett árnyék', { dropShadow: { color: '#ff0000', dx: 0.08, dy: 0.08, blur: 0.004, opacity: 1 } }],
    ['ragyogás', { outerGlow: { color: '#00ff00', size: 0.02, opacity: 1 } }],
    ['gradiens-maszk jobbra', { maskGradient: 'right' }],
  ];
  for (const [name, patch] of effects) {
    const layer = { ...small, ...patch } as PhotoLayer;
    const lw = 160;
    const preview = await drawAsImage(
      <Group transform={[{ translate: [80, 64] }]}>
        <PhotoSkiaContent image={source} lut={null} layer={layer} w={lw} h={lw} scale={1} canvas={canvas} />
      </Group>,
      { width: 320, height: 320 }
    );
    const uri = await renderImageDoc({ id: 'fx', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [layer] } as unknown as ImageDoc, 320);
    if (!preview || !uri) {
      log(false, `effekt = export: ${name}`, 'nincs kép');
      continue;
    }
    const d = gridDiff(preview, await decode(uri), 320, 280);
    log(d.bad / d.total <= 0.06, `effekt = export: ${name}`, `${d.bad}/${d.total} rácspont tér el`);
    removeFile(uri);
  }

  // a TELJES vászon: a valódi ImageCanvas nézet-fája, keverési móddal, a szerver ellen
  const base = { ...small, id: 'bg', position: { x: 0.5, y: 0.5 }, w: 1, h: 1 } as PhotoLayer;
  const top = { ...small, id: 'top', blendMode: 'multiply', adjust: { saturation: -1 } } as PhotoLayer;
  const docs: [string, ImageLayer[]][] = [
    ['fotó', [base as ImageLayer]],
    ['fotó + korrekció + szorzás-keverés', [base as ImageLayer, top as ImageLayer]],
    ['korrekciós réteg a fotó fölött', [base as ImageLayer, { kind: 'adjust', id: 'adj', adjust: { contrast: 0.3, saturation: 0.5 } } as ImageLayer]],
  ];
  for (const [name, layers] of docs) {
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers } as unknown as ImageDoc;
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const uri = await renderImageDoc(doc, 320);
    if (!uri) {
      log(false, `vászon = export: ${name}`, 'nincs render');
      continue;
    }
    const a = await decode(shot);
    const d = gridDiff(a, await decode(uri), Math.min(a.width(), 320), Math.min(a.height(), 280));
    const b2 = await decode(uri);
    log(d.bad / d.total <= 0.06, `vászon = export: ${name}`, `${a.width()}×${a.height()}, ${d.bad}/${d.total} rácspont tér el; sárga ${pixel(a, 80, 80)} / ${pixel(b2, 80, 80)}; kék ${pixel(a, 240, 240)} / ${pixel(b2, 240, 240)}`);
    if (name.includes('szorzás')) {
      // ellenpróba: a keverés nélküli kép ugyanitt el KELL térjen, különben a mérés vak
      const plainUri = await renderImageDoc({ ...doc, layers: [base, { ...top, blendMode: undefined }] } as unknown as ImageDoc, 320);
      if (plainUri) {
        const ctrl = gridDiff(a, await decode(plainUri), Math.min(a.width(), 320), 280);
        log(ctrl.bad > 0, 'ellenpróba: a mérés érzékeli a keverést', `${ctrl.bad} rácspont tér el a keverés nélküli képtől`);
        removeFile(plainUri);
      }
    }
    setHarness(null);
    removeFile(uri);
    removeFile(shot);
  }
  removeFile(file.uri);
}

/** 🔬 Szöveg/forma effektek, doc-szintű hatások, .cube, lokális korrekció: valódi vászon a szerver ellen. */
async function smokeDeep2(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#3070d0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 320, 320), paint);
  paint.setColor(Skia.Color('#f0c040'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 160, 160), paint);
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_d2_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const rows = ['LUT_3D_SIZE 3'];
  for (let b = 0; b < 3; b++) for (let g = 0; g < 3; g++) for (let r = 0; r < 3; r++) rows.push(`${(r / 2) * 0.8 + 0.1} ${(g / 2) ** 2} ${1 - (b / 2) * 0.7}`);
  const cube = new File(projectMediaDir(), `smoke_d2_${Date.now().toString(36)}.cube`);
  cube.write(rows.join('\n'));
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.45 }, w: 1, h: 0.9, fit: 'stretch', ...extra }) as ImageLayer;
  const rect = (extra: Partial<ShapeLayer>) => ({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.45 }, w: 0.4, h: 0.4, fill: '#ff2d95', ...extra }) as ImageLayer;
  const cases: [string, ImageLayer[], Partial<ImageDoc>][] = [
    ['forma árnyéka', [bg, rect({ dropShadow: { color: '#0000ff', dx: 0.08, dy: 0.08, blur: 0.004, opacity: 1 } })], {}],
    ['forma ragyogása', [bg, rect({ outerGlow: { color: '#00aa00', size: 0.03, opacity: 1 } })], {}],
    ['forma körvonala', [bg, rect({ stroke: { color: '#ff0000', width: 0.03 } })], {}],
    ['forgatott forma árnyéka', [bg, rect({ rotation: 30, dropShadow: { color: '#0000ff', dx: 0.08, dy: 0.02, blur: 0.004, opacity: 1 } })], {}],
    ['forma + doc-grade', [bg, rect({})], { grade: 'noir' } as Partial<ImageDoc>],
    ['forma + korrekciós réteg', [bg, rect({}), { kind: 'adjust', id: 'adj', adjust: { saturation: -0.9 } } as ImageLayer], {}],
    ['fotó + vignetta', [photo({})], { vignette: 0.8 } as Partial<ImageDoc>],
    ['.cube LUT', [photo({ lut: cube.uri, lutName: 'x' })], {}],
    ['lokális korrekció', [photo({ localAdjust: { adjust: { contrast: 0.3, saturation: 0.5 }, mask: { shape: 'rectangle', x: 0.5, y: 0.45, w: 0.4, h: 0.4, feather: 0.005 } } })], {}],
    ['fotó körvonala', [bg, photo({ w: 0.6, h: 0.6, stroke: { color: '#ff0000', width: 0.03 } })], {}],
  ];
  for (const [name, layers, extra] of cases) {
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers, ...extra } as unknown as ImageDoc;
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1600);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const uri = await renderImageDoc(doc, 320);
    if (!uri) {
      log(false, `vászon = export: ${name}`, 'nincs render');
      continue;
    }
    const a = await decode(shot);
    const d = gridDiff(a, await decode(uri), 320, 280);
    // ellenpróba: az effekt NÉLKÜLI exporttól el kell térnie, különben a mérés vak
    const plain = {
      ...doc,
      grade: undefined,
      vignette: 0,
      layers: doc.layers.filter((l) => l.kind !== 'adjust').map((l) => ({ ...l, dropShadow: undefined, outerGlow: undefined, stroke: undefined, lut: undefined, localAdjust: undefined })),
    } as unknown as ImageDoc;
    const plainUri = await renderImageDoc(plain, 320);
    const c = plainUri ? gridDiff(a, await decode(plainUri), 320, 280) : { bad: 0, total: 0 };
    log(d.bad / d.total <= 0.06 && c.bad > d.bad, `vászon = export: ${name}`, `${d.bad}/${d.total} tér el; effekt nélküli exporttól ${c.bad}`);
    if (plainUri) {
      removeFile(plainUri);
    }
    setHarness(null);
    await sleep(80);
    removeFile(uri);
    removeFile(shot);
  }
  removeFile(png.uri);
  removeFile(cube.uri);
}

function meanDiff(a: SkImage, b: SkImage, size: number, stop: number): number {
  let sum = 0;
  let n = 0;
  for (let y = 5; y < stop; y += 7) {
    for (let x = 5; x < size - 5; x += 7) {
      const p = pixel(a, x, y);
      const q = pixel(b, x, y);
      sum += (Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2])) / 3;
      n += 1;
    }
  }
  return sum / n;
}

/** Az effekt tiszta hatása a cellahatárokon: a vászon és az export VÁLTOZÁSÁNAK különbsége, az újramintázás zaja nélkül. */
function edgeEffect(a: SkImage, a0: SkImage, b: SkImage, b0: SkImage): { residual: number; effect: number } {
  let residual = 0;
  let effect = 0;
  let n = 0;
  for (let k = 1; k < 15; k++) {
    for (let j = 1; j < 15; j++) {
      for (const off of [-2, -1, 0, 1]) {
        const [x, y] = [k * 20 + off, j * 20 + 10];
        const [p, p0, q, q0] = [pixel(a, x, y), pixel(a0, x, y), pixel(b, x, y), pixel(b0, x, y)];
        for (const c of [0, 1, 2]) {
          const canvasDelta = p[c] - p0[c];
          const exportDelta = q[c] - q0[c];
          residual += Math.abs(canvasDelta - exportDelta);
          effect += Math.abs(exportDelta);
          n += 1;
        }
      }
    }
  }
  return { residual: residual / n, effect: effect / n };
}

function redCount(a: SkImage, size: number): number {
  let n = 0;
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const p = pixel(a, x, y);
      if (p[0] > 170 && p[1] < 90 && p[2] < 90) n += 1;
    }
  }
  return n;
}

/** a lágy fényudvar mérése: az összes vörös többlet (R−G) */
function redExcess(a: SkImage, size: number): number {
  let sum = 0;
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const p = pixel(a, x, y);
      sum += Math.max(0, p[0] - p[1]);
    }
  }
  return sum;
}

function spread(a: SkImage, x0: number, y0: number, n: number): number {
  const v: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) v.push(pixel(a, x0 + x, y0 + y)[1]);
  const m = v.reduce((p, c) => p + c, 0) / v.length;
  return Math.sqrt(v.reduce((p, c) => p + (c - m) ** 2, 0) / v.length);
}

/** A részlet-műveletek pixelszintű mérése a szerver ellen, ellenpróbával: az effekt nélküli export. */
async function smokeDeep3(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  log(true, 'mért eszköz', `${Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'telefon'}, pixelarány ${ratio}`);
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const v = (x * 37 + y * 91 + x * y * 13) % 200;
      paint.setColor(Skia.Color(`rgb(${40 + v},${230 - v},${60 + (v * 2) % 170})`));
      c.drawRect(Skia.XYWHRect(x * 20, y * 20, 20, 20), paint);
    }
  }
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_d3_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const gray = { kind: 'fill', id: 'f', fill: '#808080' } as ImageLayer;
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as ImageLayer;
  const rect = (extra: Partial<ShapeLayer>) => ({ kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, ...extra }) as ImageLayer;
  const mask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, feather: 0.005 };
  const cases: [string, ImageLayer[], Partial<ImageDoc>][] = [
    ['élesítés', [photo({ filters: [{ type: 'sharpen', amount: 0.8 }] })], {}],
    ['clarity szűrő', [photo({ filters: [{ type: 'clarity', amount: 0.8 }] })], {}],
    ['develop clarity', [photo({ develop: { base: {}, detail: { clarity: 0.8 } } as unknown as PhotoLayer['develop'] })], {}],
    ['develop texture', [photo({ develop: { base: {}, detail: { texture: 1 } } as unknown as PhotoLayer['develop'] })], {}],
    ['pixelezés', [photo({ filters: [{ type: 'pixelate', amount: 0.6 }] })], {}],
    ['folt-javítás', [photo({ heal: [{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }] })], {}],
    ['réteg-vignetta', [photo({ adjust: { vignette: 0.9 } })], {}],
    ['grade-vignetta', [photo({ grade: 'moody' })], {}],
    ['maszkolt korrekciós réteg', [photo({}), { kind: 'adjust', id: 'adj', adjust: { saturation: -1, contrast: 0.4 }, mask } as unknown as ImageLayer], {}],
    ['gradiens + korrekció', [bg, rect({ fillGradient: { from: '#ff0000', to: '#0000ff' } }), { kind: 'adjust', id: 'adj', adjust: { saturation: -1 } } as ImageLayer], {}],
    ['szöveg körvonala', [gray, { kind: 'text', id: 't', text: 'ÁRVÍZ', position: { x: 0.5, y: 0.5 }, fontSize: 22, color: '#ffffff', fontWeight: '900', stroke: { color: '#ff0000', width: 0.015 } } as unknown as ImageLayer], {}],
    ['szöveg árnyéka', [gray, { kind: 'text', id: 't', text: 'ÁRVÍZ', position: { x: 0.5, y: 0.5 }, fontSize: 22, color: '#ffffff', fontWeight: '900', dropShadow: { color: '#ff0000', dx: 0.02, dy: 0.02, blur: 0.002, opacity: 1 } } as unknown as ImageLayer], {}],
    ['szöveg ragyogása', [gray, { kind: 'text', id: 't', text: 'ÁRVÍZ', position: { x: 0.5, y: 0.5 }, fontSize: 22, color: '#ffffff', fontWeight: '900', outerGlow: { color: '#ff0000', size: 0.02, opacity: 1 } } as unknown as ImageLayer], {}],
  ];
  const plainOf = (doc: ImageDoc) =>
    ({
      ...doc,
      layers: doc.layers
        .filter((l) => l.kind !== 'adjust')
        .map((l) => ({ ...l, filters: undefined, develop: undefined, heal: undefined, adjust: undefined, grade: undefined, stroke: undefined, dropShadow: undefined, outerGlow: undefined })),
    }) as unknown as ImageDoc;
  const shoot = async (doc: ImageDoc) => {
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1600);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const img = await decode(shot);
    removeFile(shot);
    setHarness(null);
    await sleep(80);
    return img;
  };
  for (const [name, layers, extra] of cases) {
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers, ...extra } as unknown as ImageDoc;
    const a = await shoot(doc);
    const uri = await renderImageDoc(doc, 320);
    const plainUri = await renderImageDoc(plainOf(doc), 320);
    if (!uri || !plainUri) {
      log(false, `részlet = export: ${name}`, 'nincs render');
      continue;
    }
    const b = await decode(uri);
    const p = await decode(plainUri);
    if (name === 'szöveg ragyogása') {
      const [ra, rb, rp] = [redExcess(a, 320), redExcess(b, 320), redExcess(p, 320)];
      log(Math.abs(ra - rb) <= rb * 0.4 && rp < rb * 0.05, `részlet = export: ${name}`, `vörös többlet: vászon ${ra}, export ${rb}, ragyogás nélkül ${rp}`);
    } else if (name.startsWith('szöveg')) {
      const [ra, rb, rp] = [redCount(a, 320), redCount(b, 320), redCount(p, 320)];
      log(Math.abs(ra - rb) <= rb * 0.4 && rp === 0 && rb > 50, `részlet = export: ${name}`, `vörös pontok: vászon ${ra}, export ${rb}, körvonal nélkül ${rp}`);
    } else {
      if (name === 'élesítés' || name.includes('clarity') || name.includes('texture')) {
        // az alap is a Skia-úton rajzolódjon: elhanyagolható élesítés, különben a sima Image-et mérnénk
        const skiaPlain = { ...plainOf(doc), layers: [photo({ filters: [{ type: 'sharpen', amount: 0.001 }] })] } as ImageDoc;
        const fx = edgeEffect(a, await shoot(skiaPlain), b, p);
        log(fx.residual <= fx.effect * 0.5 && fx.effect > 1, `részlet = export: ${name}`, `az effekt a cellahatáron ${fx.effect.toFixed(1)}/255, ebből eltér ${fx.residual.toFixed(1)}`);
        removeFile(uri);
        removeFile(plainUri);
        continue;
      }
      const d = meanDiff(a, b, 320, 320);
      const ctl = meanDiff(a, p, 320, 320);
      log(d <= 8 && ctl >= d * 1.5, `részlet = export: ${name}`, `átlag ${d.toFixed(1)}/255; effekt nélkül ${ctl.toFixed(1)}`);
    }
    removeFile(uri);
    removeFile(plainUri);
  }
  // a szemcse véletlen: pixel helyett a szórását mérjük a középszürkén
  const grainDoc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [gray], grain: 0.7 } as unknown as ImageDoc;
  const g = await shoot(grainDoc);
  const flat = await shoot({ ...grainDoc, grain: 0 } as ImageDoc);
  const uri = await renderImageDoc(grainDoc, 320);
  if (uri) {
    const sv = spread(await decode(uri), 100, 100, 60);
    const sa = spread(g, 100, 100, 60);
    const s0 = spread(flat, 100, 100, 60);
    log(Math.abs(sa - sv) <= sv * 0.35 && s0 < sv * 0.2, 'szemcse szórása = export', `vászon ${sa.toFixed(1)}, export ${sv.toFixed(1)}, szemcse nélkül ${s0.toFixed(1)}`);
    removeFile(uri);
  }
  removeFile(png.uri);
}

/** Az ecset-motor a valódi Skia-rajzon, a valódi overlay-en át; a hibás logikát mind ellenpróba fogja meg. */
async function smokeBrushEngine(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const line = (extra: Partial<Stroke>, y = 0.5): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color: '#ff0000', width: 0.1, hardness: 1, opacity: 1, eraser: false, ...extra });
  const size = 400;
  const alpha = (img: SkImage, x: number, y: number) => pixel(img, x, y)[3];

  // átlátszóság: önmagát keresztező vonás a metszésben sem sötétedik
  const cross: Stroke = { ...line({ opacity: 0.5 }), points: [{ x: 0.1, y: 0.5, p: 1 }, { x: 0.9, y: 0.5, p: 1 }, { x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }] };
  const a = renderStrokes([cross], size, size)!;
  const [one, both] = [alpha(a, 100, 200), alpha(a, 200, 200)];
  log(Math.abs(one - 128) <= 3 && Math.abs(both - one) <= 3, 'átlátszóság: a vonás önmagán nem halmozódik', `vonalon α=${one}, keresztezésben α=${both}`);
  const twice = renderStrokes([line({ opacity: 0.5 }), line({ opacity: 0.5 })], size, size)!;
  log(alpha(twice, 200, 200) > 180, 'ellenpróba: két külön vonás már fed', `α=${alpha(twice, 200, 200)}`);

  // keménység: az él mennyire fokozatos
  const edgeBand = (s: Stroke) => {
    const img = renderStrokes([s], size, size)!;
    let band = 0;
    for (let y = 120; y < 200; y++) {
      const v = alpha(img, 200, y);
      if (v > 12 && v < 243) band += 1;
    }
    return band;
  };
  const [hard, soft] = [edgeBand(line({ hardness: 1 })), edgeBand(line({ hardness: 0 }))];
  log(hard <= 3 && soft >= 10, 'keménység: a lágy él fokozatos, a kemény éles', `átmenet: kemény ${hard} px, lágy ${soft} px`);

  // nyomás
  const widthAt = (p: number) => {
    const img = renderStrokes([{ ...line({}), points: [{ x: 0.1, y: 0.5, p }, { x: 0.9, y: 0.5, p }] }], size, size)!;
    let n = 0;
    for (let y = 100; y < 300; y++) if (alpha(img, 200, y) > 128) n += 1;
    return n;
  };
  const [light, heavy] = [widthAt(0), widthAt(1)];
  log(Math.abs(heavy - 40) <= 1 && Math.abs(light - 10) <= 1, 'nyomás: a vastagság a nyomást követi', `könnyű ${light} px, erős ${heavy} px`);

  // radír: csak a metszetben lyukaszt
  const erased = renderStrokes([line({}), { ...line({ eraser: true }), points: [{ x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }] }], size, size)!;
  log(alpha(erased, 200, 200) === 0 && alpha(erased, 100, 200) === 255, 'radír: a keresztezésben lyuk, mellette érintetlen', `metszet α=${alpha(erased, 200, 200)}, mellette α=${alpha(erased, 100, 200)}`);

  // a valódi overlay: vonásonkénti undo, és az előnézet = export
  const box = { w: 300, h: 300 };
  const ref = createRef<BrushHandle>();
  const view = createRef<View>() as RefObject<View>;
  const history: string[] = [];
  const mount = (baseUri?: string) =>
    setHarness(
      <View ref={view} collapsable={false} style={{ width: box.w, height: box.h, backgroundColor: 'transparent' }}>
        <BrushOverlay ref={ref} box={box} settings={DEFAULT_BRUSH} baseUri={baseUri} onHistory={(u, r) => history.push(`${u}/${r}`)} />
      </View>
    );
  mount();
  await sleep(500);
  ref.current!.addStroke(line({ color: '#00ff00', opacity: 0.6, hardness: 0.3 }, 0.3));
  ref.current!.addStroke(line({ color: '#0000ff' }, 0.7));
  await sleep(300);
  ref.current!.undo();
  await sleep(300);
  const undone = await decode(ref.current!.exportPng(300, 300)!);
  log(alpha(undone, 150, 90) > 100 && alpha(undone, 150, 210) === 0, 'undo: csak az utolsó vonás tűnik el', `első α=${alpha(undone, 150, 90)}, második α=${alpha(undone, 150, 210)}`);
  log(history[history.length - 1] === 'true/true', 'a gombok állapota követi az előzményt', history[history.length - 1]);
  ref.current!.redo();
  await sleep(300);
  const shot = await captureRef(view, { format: 'png', quality: 1, width: 300 / ratio, height: 300 / ratio });
  const uri = ref.current!.exportPng(300, 300)!;
  const [screen, png] = [await decode(shot), await decode(uri)];
  // egyetlen élpixel bármit mutathat, ezért a rácspontok arányát mérjük
  let bad = 0;
  let total = 0;
  const sample: string[] = [];
  for (let y = 10; y < 290; y += 6) {
    for (let x = 40; x < 260; x += 6) {
      const [p, q] = [pixel(screen, x, y), pixel(png, x, y)];
      total += 1;
      // az alig látszó szélen a szín nem számít, az alfa viszont kiszúrná a hiányzó rajzot
      const seen = p[3] > 64 && q[3] > 64;
      if (Math.abs(p[3] - q[3]) > 40 || (seen && [0, 1, 2].some((c) => Math.abs(p[c] - q[c]) > 40))) {
        bad += 1;
        if (sample.length < 3) sample.push(`${x},${y}: ${p} / ${q}`);
      }
    }
  }
  log(bad / total <= 0.03 && alpha(png, 150, 210) === 255, 'előnézet = PNG az overlay-en', `${bad}/${total} rácspont tér el ${sample.join(' | ')}`);
  removeFile(shot);

  // festett réteg folytatása: a radír a korábbi festést is törli
  setHarness(null);
  await sleep(100);
  mount(uri);
  await sleep(900);
  ref.current!.addStroke({ ...line({ eraser: true }, 0.7) });
  await sleep(300);
  const reopened = await decode(ref.current!.exportPng(300, 300)!);
  log(alpha(reopened, 150, 90) > 100 && alpha(reopened, 150, 210) === 0, 'újranyitott festésen a radír a régi vonást törli', `megmaradó α=${alpha(reopened, 150, 90)}, törölt α=${alpha(reopened, 150, 210)}`);

  // az export a szerver útján is ugyanazt adja
  const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 300, height: 300, layers: [{ kind: 'photo', id: 'p', uri, paint: true, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'contain' }] } as unknown as ImageDoc;
  const server = await renderImageDoc(doc, 300);
  if (server) {
    const s = await decode(server);
    const [g, b] = [pixel(s, 150, 90), pixel(s, 150, 210)];
    const [eg, eb] = [pixel(png, 150, 90), pixel(png, 150, 210)];
    log(Math.abs(b[2] - eb[2]) <= 8 && Math.abs(b[3] - eb[3]) <= 8 && Math.abs(g[3] - eg[3]) <= 20, 'a szerver-export a festést adja', `kék ${b} (várt ${eb}), zöld ${g} (várt ${eg})`);
    removeFile(server);
  } else {
    log(false, 'a szerver-export a festést adja', 'nincs render');
  }
  removeFile(uri);
  setHarness(null);
}

/** A kijelölés a valódi vásznon a szerver ellen, ellenpróbával; a műveletek a valódi függvényeken át mennek. */
async function smokeSelection(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      paint.setColor(Skia.Color(`rgb(${40 + x * 60},${220 - y * 50},${60 + (x + y) * 25})`));
      c.drawRect(Skia.XYWHRect(x * 80, y * 80, 80, 80), paint);
    }
  }
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_sel_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const pt = (x: number, y: number) => ({ x, y });
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as ImageLayer;
  const base = (layers: ImageLayer[]) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers }) as unknown as ImageDoc;
  const u = applyRing(null, [pt(0.1, 0.1), pt(0.9, 0.1), pt(0.9, 0.9), pt(0.6, 0.9), pt(0.6, 0.3), pt(0.4, 0.3), pt(0.4, 0.9), pt(0.1, 0.9)], 'new')!;
  const ring = applyRing(applyRing(null, ellipseRing(pt(0.1, 0.1), pt(0.9, 0.9)), 'new'), rectRing(pt(0.35, 0.35), pt(0.65, 0.65)), 'subtract')!;
  const cut = applyRing(null, rectRing(pt(0.2, 0.2), pt(0.5, 0.5)), 'new')!;
  const start = base([bg, photo()]);
  const moved = updateLayer<PhotoLayer>(deleteSelection(start, 'p', cut)!, 'p', { position: { x: 0.65, y: 0.6 } });
  const cases: [string, ImageDoc][] = [
    ['homorú lasszó maszkként', maskFromSelection(start, 'p', u)!],
    ['lyukas ellipszis maszkként', maskFromSelection(start, 'p', ring)!],
    ['invertált kijelölés', maskFromSelection(start, 'p', invertSelection(u))!],
    ['lágy szél', maskFromSelection(start, 'p', { ...u, feather: 0.03 })!],
    ['törlés', deleteSelection(start, 'p', cut)!],
    ['mozgatott réteg maszkja', moved],
    ['másolat új rétegre', { ...copySelectionToLayer(base([bg, photo({ opacity: 0.25 })]), 'p', u, 'c')!, id: 'full' }],
    ['korrekció a kijelölésen', ((d) => ({ ...d, layers: d.layers.map((l) => (l.kind === 'adjust' ? { ...l, adjust: { saturation: -1, contrast: 0.4 } } : l)) }) as ImageDoc)(adjustSelection(start, u, 'adj'))],
  ];
  const ctlDoc = (d: ImageDoc) => base([bg, photo({ position: (d.layers[1] as PhotoLayer).position })]);
  for (const [name, doc] of cases) {
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [uri, plainUri] = [await renderImageDoc(doc, 320), await renderImageDoc(ctlDoc(doc), 320)];
    if (!uri || !plainUri) {
      log(false, `kijelölés = export: ${name}`, 'nincs render');
      continue;
    }
    const server = await decode(uri);
    const d = meanDiff(a, server, 320, 320);
    const ctl = meanDiff(a, await decode(plainUri), 320, 320);
    if (d > 8) {
      const rows: string[] = [];
      for (let y = 0; y < 320; y += 40) {
        const row: number[] = [];
        for (let x = 0; x < 320; x += 40) {
          let sum = 0;
          for (let i = 4; i < 40; i += 8) for (let j = 4; j < 40; j += 8) sum += Math.abs(pixel(a, x + i, y + j)[1] - pixel(server, x + i, y + j)[1]);
          row.push(Math.round(sum / 25));
        }
        rows.push(row.join(','));
      }
      log(true, 'TÉRKÉP', rows.join(' / '));
    }
    log(d <= 8 && ctl >= d * 1.5, `kijelölés = export: ${name}`, `átlag ${d.toFixed(1)}/255; a kijelölés nélkül ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(uri);
    removeFile(plainUri);
  }

  // az ecset nem fest ki a kijelölésből
  const brush: Stroke = { points: [pt(0.1, 0.25), pt(0.9, 0.25)].map((p) => ({ ...p, p: 1 })), color: '#ff0000', width: 0.1, hardness: 1, opacity: 1, eraser: false };
  const clipped = renderStrokes([brush], 400, 400, null, cut)!;
  const free = renderStrokes([brush], 400, 400)!;
  log(pixel(clipped, 140, 100)[3] === 255 && pixel(clipped, 300, 100)[3] === 0 && pixel(free, 300, 100)[3] === 255, 'az ecset a kijelölésen belül marad', `benne α=${pixel(clipped, 140, 100)[3]}, kívül α=${pixel(clipped, 300, 100)[3]}, kijelölés nélkül α=${pixel(free, 300, 100)[3]}`);
  const inv = renderStrokes([brush], 400, 400, null, invertSelection(cut))!;
  log(pixel(inv, 140, 100)[3] === 0 && pixel(inv, 300, 100)[3] === 255, 'invertált kijelölésnél fordítva', `benne α=${pixel(inv, 140, 100)[3]}, kívül α=${pixel(inv, 300, 100)[3]}`);

  // a körvonal a kijelzőn: rendszer-képernyőképhez
  setHarness(
    <View style={{ width: 300, height: 300, backgroundColor: '#3060a0' }}>
      <SelectionAnts selection={ring} box={{ w: 300, h: 300 }} />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a kijelölés körvonala a kijelzőn');
  await sleep(6000);
  setHarness(null);
  removeFile(png.uri);
}

/** A színenkénti HSL és a fényerő a vásznon a szerver ellen; a hisztogram a kész export eloszlása ellen. */
async function smokeColor(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  const colors = ['#e02020', '#e08020', '#e0d020', '#30c040', '#20c0c0', '#2040e0', '#8040e0', '#e020a0', '#808080'];
  colors.forEach((col, i) => {
    paint.setColor(Skia.Color(col));
    c.drawRect(Skia.XYWHRect((i % 3) * 107, Math.floor(i / 3) * 107, 107, 107), paint);
  });
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_col_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const photo = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as PhotoLayer;
  const docOf = (l: PhotoLayer) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [l] }) as unknown as ImageDoc;
  const source = await decode(png.uri);
  const cases: [string, Partial<PhotoLayer>][] = [
    ['piros kifakítva', { hsl: { red: { s: -1 } } }],
    ['kék árnyalat', { hsl: { blue: { h: 1 } } }],
    ['zöld világosítva', { hsl: { green: { l: 1 } } }],
    ['több sáv', { hsl: { orange: { h: -0.7, s: 0.5 }, aqua: { l: -0.8 }, magenta: { s: -0.6, h: 0.4 } } }],
    ['HSL + korrekció', { adjust: { contrast: 0.3 }, hsl: { yellow: { s: -1 } } }],
    ['fényerő', { adjust: { brightness: 0.2 } }],
  ];
  for (const [name, extra] of cases) {
    const layer = photo(extra);
    const doc = docOf(layer);
    const ref = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={ref} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(ref, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [uri, plainUri] = [await renderImageDoc(doc, 320), await renderImageDoc(docOf(photo({})), 320)];
    if (!uri || !plainUri) {
      log(false, `szín = export: ${name}`, 'nincs render');
      continue;
    }
    const server = await decode(uri);
    const d = meanDiff(a, server, 320, 320);
    const ctl = meanDiff(a, await decode(plainUri), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `szín = export: ${name}`, `átlag ${d.toFixed(1)}/255; a beállítás nélkül ${ctl.toFixed(1)}`);
    // a hisztogram az eszközön számolt: a kész exporttal kell egyeznie, az eredetitől eltérnie
    const hist = layerHistogram(source, layer)!;
    const px = server.readPixels(0, 0, { width: 320, height: 320, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
    const real = computeHistogram(px);
    const before = layerHistogram(source, photo({}))!;
    const dist = Math.max(histogramShift(hist.r, real.r), histogramShift(hist.g, real.g), histogramShift(hist.b, real.b));
    const change = Math.max(histogramShift(before.r, real.r), histogramShift(before.g, real.g), histogramShift(before.b, real.b));
    log(dist <= 3 && change >= dist * 2, `hisztogram = export: ${name}`, `eltérés ${dist.toFixed(1)} szint; az eredetitől ${change.toFixed(1)} szint`);
    removeFile(shot);
    removeFile(uri);
    removeFile(plainUri);
  }
  setHarness(
    <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center', height: 320 }}>
      <HslSheet doc={docOf(photo({ hsl: { red: { s: -0.5 } } }))} layer={photo({ hsl: { red: { s: -0.5 } } })} commit={() => {}} onClose={() => {}} />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a HSL-lap a kijelzőn');
  await sleep(6000);
  setHarness(null);
  removeFile(png.uri);
}

/** A festett maszk: a valódi overlay festi, a valódi vászon mutatja, a szerver ellen mérve. */
async function smokePaintMask(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  const c = surface.getCanvas();
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      paint.setColor(Skia.Color(`rgb(${40 + x * 60},${220 - y * 50},${60 + (x + y) * 25})`));
      c.drawRect(Skia.XYWHRect(x * 80, y * 80, 80, 80), paint);
    }
  }
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_pm_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const photo = (extra: Partial<PhotoLayer> = {}) => ({ kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch', ...extra }) as PhotoLayer;
  const docOf = (l: PhotoLayer) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, l] }) as unknown as ImageDoc;
  const line = (color: string, y: number, extra: Partial<Stroke> = {}): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color, width: 0.14, hardness: 1, opacity: 1, eraser: false, ...extra });

  const ref = createRef<BrushHandle>();
  setHarness(
    <View style={{ width: 300, height: 300, backgroundColor: '#406080' }}>
      <BrushOverlay ref={ref} box={{ w: 300, h: 300 }} settings={DEFAULT_BRUSH} maskMode />
    </View>
  );
  await sleep(500);
  ref.current!.addStroke(line('#000000', 0.3));
  ref.current!.addStroke(line('#000000', 0.7, { hardness: 0.2, opacity: 0.6 }));
  await sleep(400);
  log(true, 'FOTÓZHATÓ', 'a maszk-festés nézete a kijelzőn');
  await sleep(5000);
  const uri = ref.current!.exportPng(320, 320)!;
  const m = await decode(uri);
  log(pixel(m, 160, 96)[0] < 10 && pixel(m, 160, 10)[0] > 245, 'a maszk: rejtett fekete, a többi fehér', `rejtett ${pixel(m, 160, 96)}, látható ${pixel(m, 160, 10)}`);
  setHarness(null);
  await sleep(80);

  // a meglévő kijelölésből induló festés a formát hozza
  const seedRing = applyRing(null, rectRing({ x: 0.25, y: 0.25 }, { x: 0.75, y: 0.75 }), 'new')!;
  const seeded = renderStrokes([], 320, 320, null, null, selectionToMask(seedRing))!;
  log(pixel(seeded, 160, 160)[0] > 245 && pixel(seeded, 20, 20)[0] < 10, 'a meglévő maszk formája átjön a festésbe', `belül ${pixel(seeded, 160, 160)}, kívül ${pixel(seeded, 20, 20)}`);

  const mask = { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: uri } as PhotoLayer['mask'];
  const moved = updateLayer<PhotoLayer>(docOf(photo({ mask })), 'p', { position: { x: 0.62, y: 0.55 } });
  const cases: [string, ImageDoc][] = [
    ['festett maszk', docOf(photo({ mask }))],
    ['lágy szélű maszk', docOf(photo({ mask: { ...mask!, feather: 0.015 } }))],
    ['mozgatott réteg maszkja', moved],
    ['elforgatott réteg', docOf(photo({ mask, rotation: 25, w: 0.7, h: 0.7 }))],
  ];
  for (const [name, doc] of cases) {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1500);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const plainDoc = { ...doc, layers: doc.layers.map((l) => (l.kind === 'photo' ? { ...l, mask: undefined } : l)) } as ImageDoc;
    const [out, plain] = [await renderImageDoc(doc, 320), await renderImageDoc(plainDoc, 320)];
    if (!out || !plain) {
      log(false, `festett maszk = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(out), 320, 320);
    const ctl = meanDiff(a, await decode(plain), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `festett maszk = export: ${name}`, `átlag ${d.toFixed(1)}/255; maszk nélkül ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(out);
    removeFile(plain);
  }
  removeFile(uri);
  removeFile(png.uri);
}

/** A retus-eszközök a valódi Skia-rajzon: a vonás alatt változik, mellette a réteg átlátszó marad. */
async function smokeRetouch(log: Log) {
  const size = 400;
  const surface = Skia.Surface.MakeOffscreen(size, size)!;
  const c = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#606060'));
  c.drawRect(Skia.XYWHRect(0, 0, size, size), paint);
  paint.setColor(Skia.Color('#d04020'));
  c.drawRect(Skia.XYWHRect(0, 0, 200, 200), paint);
  paint.setColor(Skia.Color('#ffffff'));
  for (let i = 0; i < 20; i++) {
    c.drawRect(Skia.XYWHRect(0, i * 20, 200, 4), paint); // mintázat a klónhoz
  }
  surface.flush();
  const source = surface.makeImageSnapshot().makeNonTextureImage()!;
  const line = (tool: RetouchTool, y: number, offset?: { x: number; y: number }, extra: Partial<Stroke> = {}): Stroke => ({ points: [{ x: 0.1, y, p: 1 }, { x: 0.9, y, p: 1 }], color: '#000000', width: 0.1, hardness: 1, opacity: 1, eraser: false, tool, offset, ...extra });
  const render = (s: Stroke) => renderStrokes([s], size, size, null, null, null, source)!;

  // klón: a jobb alsó szürke helyre a bal felső mintás piros kerül
  const clone = render(line('clone', 0.75, { x: -0.5, y: -0.5 }));
  const [dst, src] = [pixel(clone, 300, 303), pixel(source, 100, 103)];
  log(Math.abs(dst[0] - src[0]) <= 2 && Math.abs(dst[1] - src[1]) <= 2 && dst[3] === 255, 'klón: a forrás pixele kerül a célra', `cél ${dst}, forrás ${src}`);
  log(pixel(clone, 300, 100)[3] === 0, 'klón: a vonáson kívül átlátszó', `α=${pixel(clone, 300, 100)[3]}`);

  // folt: a minta jön át, de a cél szürke tónusa marad (a klón pirosat adna)
  const heal = render(line('heal', 0.75, { x: -0.5, y: -0.5 }, { width: 0.1 }));
  // egy pixel a minta miatt eltérhet: a terület átlagos színe a döntő
  const mean = (img: SkImage) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let y = 285; y < 315; y++) {
      for (let x = 240; x < 340; x += 3) {
        const p = pixel(img, x, y);
        [0, 1, 2].forEach((k) => (sum[k] += p[k]));
        n += 1;
      }
    }
    return sum.map((v) => Math.round(v / n));
  };
  const [hm, cm] = [mean(heal), mean(clone)];
  const healSpread = Math.max(...hm) - Math.min(...hm);
  const cloneSpread = Math.max(...cm) - Math.min(...cm);
  let [hi0, lo0] = [0, 255];
  for (let y = 285; y < 315; y++) {
    const v = pixel(heal, 300, y)[1];
    hi0 = Math.max(hi0, v);
    lo0 = Math.min(lo0, v);
  }
  log(healSpread <= 40 && Math.abs(hm[1] - 96) <= 45 && cloneSpread > 60 && hi0 - lo0 > 40, 'folt: a cél tónusa marad, a minta átjön', `folt átlag ${hm}, klón átlag ${cm}, minta terjedelme ${hi0 - lo0}`);

  const base = pixel(source, 300, 300);
  const dodge = pixel(render(line('dodge', 0.75)), 300, 300);
  const burn = pixel(render(line('burn', 0.75)), 300, 300);
  log(Math.abs(dodge[0] - base[0] * 1.35) <= 3 && Math.abs(burn[0] - base[0] * 0.65) <= 3, 'világosít és sötétít', `alap ${base[0]}, világos ${dodge[0]}, sötét ${burn[0]}`);
  const half = pixel(render(line('dodge', 0.75, undefined, { opacity: 0.5 })), 300, 300);
  log(Math.abs(half[3] - 128) <= 3, 'az erősség az átlátszóságon át hat', `α=${half[3]}`);

  // elmosás: a piros-szürke él elmosódik; élesítés: túllövés az élen
  const edge = (y: number, tool: RetouchTool) => pixel(render({ ...line(tool, 0.5), points: [{ x: 0.5, y: 0.1, p: 1 }, { x: 0.5, y: 0.9, p: 1 }], width: 0.2 }), 200 + y, 310);
  const blurred = edge(-3, 'blur');
  log(blurred[0] > 100 && blurred[0] < 130 + 60, 'elmosás: az él átmenetet kap', `él mellett ${blurred}`);
  const sharpSurface = render({ ...line('sharpen', 0.25), points: [{ x: 0.1, y: 0.25, p: 1 }, { x: 0.45, y: 0.25, p: 1 }], width: 0.2 });
  let [hi, orig] = [0, 0];
  for (let y = 60; y < 140; y++) {
    hi = Math.max(hi, pixel(sharpSurface, 100, y)[1]);
    orig = Math.max(orig, pixel(source, 100, y)[1]);
  }
  let lo = 255;
  for (let y = 60; y < 140; y++) lo = Math.min(lo, pixel(sharpSurface, 100, y)[1]);
  const origLo = pixel(source, 100, 110)[1];
  log(lo < origLo - 10, 'élesítés: a sötét oldal mélyül az élen', `legsötétebb ${lo}, eredeti ${origLo}`);

  // forrás nélkül nincs rajz
  const empty = renderStrokes([line('clone', 0.75, { x: 0, y: 0 })], size, size)!;
  log(pixel(empty, 300, 300)[3] === 0, 'forrás nélkül nem fest feketét', `${pixel(empty, 300, 300)}`);
}

/** A háttér-eltávolítás a valódi Vision-úton; a kép a csomagolt logó, a téma közepe ismert. */
async function smokeBgRemove(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const asset = await Asset.fromModule(require('../../assets/images/icon.png')).downloadAsync();
  const uri = asset.localUri!;
  const output = new File(projectMediaDir(), `fg_smoke_${Date.now().toString(36)}.png`).uri;
  const res = await foregroundMask(uri, output);
  log(res.status === 'ok', 'Vision maszk', res.status);
  if (res.status !== 'ok') {
    return;
  }
  const [photo, mask] = [await decode(uri), await decode(res.uri)];
  log(mask.width() > 0 && Math.abs(mask.width() / mask.height() - photo.width() / photo.height()) < 0.02, 'a maszk a kép arányában', `${mask.width()}×${mask.height()}, kép ${photo.width()}×${photo.height()}`);
  const [w, h] = [mask.width(), mask.height()];
  const row = Array.from({ length: 11 }, (_, i) => Array.from({ length: 11 }, (__, j) => (pixel(mask, Math.min(w - 1, Math.floor((j / 10) * w)), Math.min(h - 1, Math.floor((i / 10) * h)))[0] > 128 ? '#' : '.')).join(''));
  log(row.join('').includes('#') && row.join('').includes('.'), 'a maszkban van téma és háttér', row.join(' / '));

  const canvas = { width: 320, height: 320 };
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const place = (extra: Partial<PhotoLayer>) => ({ kind: 'photo', id: 'p', uri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover', ...extra }) as PhotoLayer;
  const layouts: [string, Partial<PhotoLayer>][] = [
    ['teljes vásznon', {}],
    ['elforgatva', { rotation: 30, w: 0.7, h: 0.7 }],
    ['tükrözve, eltolva', { flipH: true, position: { x: 0.6, y: 0.45 }, w: 0.7, h: 0.7 }],
    ['contain, eltérő arány', { fit: 'contain', w: 0.9, h: 0.5 }],
  ];
  for (const [name, extra] of layouts) {
    const layer = place(extra);
    const projected = projectMaskToCanvas(mask, layer, { width: photo.width(), height: photo.height() }, canvas, false)!;
    const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, { ...layer, mask: { shape: 'rectangle', x: 0.5, y: 0.5, w: 1, h: 1, feather: 0, image: projected } }] } as unknown as ImageDoc;
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1600);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [out, plain] = [await renderImageDoc(doc, 320), await renderImageDoc({ ...doc, layers: [bg, layer] } as unknown as ImageDoc, 320)];
    if (!out || !plain) {
      log(false, `kivágás = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(out), 320, 320);
    const ctl = meanDiff(a, await decode(plain), 320, 320);
    log(d <= 6 && ctl >= d * 1.5, `kivágás = export: ${name}`, `átlag ${d.toFixed(1)}/255; kivágás nélkül ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(out);
    removeFile(plain);
    removeFile(projected);
  }
  removeFile(res.uri);
}

/** Húzásos tollal rajzolt görbék a vásznon a szerver ellen; az egyenes változat az ellenpróba. */
async function smokeVector(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const docOf = (...layers: ImageLayer[]) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, ...layers] }) as unknown as ImageDoc;
  const box = { w: 320, h: 320 };
  const blob = [
    anchorFromDrag({ x: 0.5, y: 0.15 }, { x: 0.75, y: 0.15 }, box),
    anchorFromDrag({ x: 0.85, y: 0.5 }, { x: 0.85, y: 0.75 }, box),
    anchorFromDrag({ x: 0.5, y: 0.85 }, { x: 0.25, y: 0.85 }, box),
    anchorFromDrag({ x: 0.15, y: 0.5 }, { x: 0.15, y: 0.25 }, box),
  ];
  const wave = [
    anchorFromDrag({ x: 0.1, y: 0.5 }, { x: 0.25, y: 0.1 }, box),
    anchorFromDrag({ x: 0.5, y: 0.5 }, { x: 0.65, y: 0.9 }, box),
    { x: 0.9, y: 0.5 },
  ];
  const straight = (pts: CanvasPoint[]) => pts.map(({ x, y }) => ({ x, y }));
  const shape = (pts: CanvasPoint[], closed: boolean, extra: Partial<ShapeLayer> = {}) => ({ ...pathShapeFromCanvasPoints(pts, closed, 's', '#ff2d95')!, ...extra }) as ImageLayer;
  const edited = shape(blob, true) as ShapeLayer;
  const cases: [string, ImageDoc, ImageDoc][] = [
    ['zárt görbe forma', docOf(shape(blob, true)), docOf(shape(straight(blob), true))],
    ['nyitott görbe vonal', docOf(shape(wave, false, { strokeWidth: 2 })), docOf(shape(straight(wave), false, { strokeWidth: 2 }))],
    ['sarokká tett csomópont', docOf({ ...edited, points: setNodeType(edited.points!, 1, 'corner', true) } as ImageLayer), docOf(edited)],
    ['megnyitott útvonal', docOf({ ...edited, closed: false, strokeWidth: 1.5 } as ImageLayer), docOf(edited)],
  ];
  for (const [name, doc, other] of cases) {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1300);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [out, ctl] = [await renderImageDoc(doc, 320), await renderImageDoc(other, 320)];
    if (!out || !ctl) {
      log(false, `görbe = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(out), 320, 320);
    const c = meanDiff(a, await decode(ctl), 320, 320);
    log(d <= 5 && c >= d * 1.5, `görbe = export: ${name}`, `átlag ${d.toFixed(1)}/255; ellenpróba ${c.toFixed(1)}`);
    removeFile(shot);
    removeFile(out);
    removeFile(ctl);
  }
}

/** A logikai műveletek eredménye a két forrásformához mérve, függetlenül; és a vászon a szerver ellen. */
async function smokeBoolean(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const canvas = { width: 320, height: 240 };
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const star = { kind: 'shape', id: 'a', shape: 'star', starPoints: 5, innerRatio: 0.4, position: { x: 0.45, y: 0.5 }, w: 0.6, h: 0.8, rotation: 20, fill: '#ff2d95' } as unknown as ShapeLayer;
  const ball = { kind: 'shape', id: 'b', shape: 'ellipse', position: { x: 0.6, y: 0.5 }, w: 0.4, h: 0.5, fill: '#2060e0' } as unknown as ShapeLayer;
  const ringDoc = { id: 'full', name: 'p', aspectRatio: '4:3', width: 320, height: 240, layers: [bg, star, ball] } as unknown as ImageDoc;
  const engine = skiaBooleanEngine(canvas);
  const [pa, pb] = [layerSkPath(star, canvas), layerSkPath(ball, canvas)];
  const rule: Record<string, (x: boolean, y: boolean) => boolean> = { union: (x, y) => x || y, subtract: (x, y) => x && !y, intersect: (x, y) => x && y, exclude: (x, y) => x !== y };
  for (const op of ['union', 'subtract', 'intersect', 'exclude'] as const) {
    const out = booleanCombineInDoc(ringDoc, 'b', op, engine);
    if (!out) {
      log(false, `logika: ${op}`, 'nincs eredmény');
      continue;
    }
    const layer = out.doc.layers.find((l) => l.id === out.resultId) as ShapeLayer;
    const res = layerSkPath(layer, canvas);
    let wrong = 0;
    let total = 0;
    for (let y = 4; y < 240; y += 8) {
      for (let x = 4; x < 320; x += 8) {
        total += 1;
        if (res.contains(x, y) !== rule[op](pa.contains(x, y), pb.contains(x, y))) wrong += 1;
      }
    }
    // ellenpróba: a régi, sokszöges mag ugyanezen a bemeneten
    const old = booleanCombineInDoc(ringDoc, 'b', op);
    let oldWrong = -1;
    if (old) {
      const oldPath = layerSkPath(old.doc.layers.find((l) => l.id === old.resultId) as ShapeLayer, canvas);
      oldWrong = 0;
      for (let y = 4; y < 240; y += 8) {
        for (let x = 4; x < 320; x += 8) {
          if (oldPath.contains(x, y) !== rule[op](pa.contains(x, y), pb.contains(x, y))) oldWrong += 1;
        }
      }
    }
    log(null, `régi mag: ${op}`, `${oldWrong}/${total} pont hibás`);
    const curves = layer.subpaths!.flat().filter((p) => p.h1 || p.h2).length;
    const nodes = layer.subpaths!.flat().length;
    log(wrong <= 3 && (op === 'exclude' || curves > 0), `logika: ${op}`, `${wrong}/${total} pont hibás, ${nodes} csomópont, ebből ${curves} görbe`);
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 260 }}>
        <ImageCanvas doc={out.doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1200);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 240 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [exp, ctl] = [await renderImageDoc(out.doc, 240), await renderImageDoc(ringDoc, 240)];
    if (exp && ctl) {
      const d = meanDiff(a, await decode(exp), 320, 240);
      const c = meanDiff(a, await decode(ctl), 320, 240);
      log(d <= 5 && c >= d * 1.5, `logika = export: ${op}`, `átlag ${d.toFixed(1)}/255; a művelet nélkül ${c.toFixed(1)}`);
      removeFile(exp);
      removeFile(ctl);
    } else {
      log(false, `logika = export: ${op}`, 'nincs render');
    }
    removeFile(shot);
  }
}

/** Összetett forma szerkesztése, vonalból forma és eltolt útvonal: a vásznon a szerver ellen, a geometria függetlenül. */
async function smokePathOps(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const canvas = { width: 320, height: 320 };
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const docOf = (...layers: ImageLayer[]) => ({ id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, ...layers] }) as unknown as ImageDoc;
  const square = { kind: 'shape', id: 'a', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.7, h: 0.7, fill: '#ff2d95' } as unknown as ShapeLayer;
  const hole = { kind: 'shape', id: 'b', shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.3, h: 0.3, fill: '#2060e0' } as unknown as ShapeLayer;
  const res = booleanCombineInDoc(docOf(square, hole), 'b', 'subtract', skiaBooleanEngine(canvas))!;
  const compound = res.doc.layers.find((l) => l.id === res.resultId) as ShapeLayer;
  log(compound.subpaths!.length === 2, 'a lyukas forma két gyűrű', `${compound.subpaths!.length} gyűrű`);

  // a lyuk gyűrűjének egy pontját húzzuk el: a lyuk változik, a külső forma nem
  const ring = compound.subpaths!.findIndex((r) => r.some((p) => p.h1 || p.h2));
  const view = pathEditView(compound, ring);
  const edited = { ...compound, ...pathEditPatch(compound, ring, moveAnchor(view.points!, 0, view.points![0].x + 0.1, view.points![0].y)) } as ShapeLayer;
  const [p0, p1] = [layerSkPath(compound, canvas), layerSkPath(edited, canvas)];
  log(p1.contains(70, 70) && !p0.contains(160, 160), 'a gyűrű szerkesztése a külső formához nem nyúl', `gyűrű ${ring}`);

  const box = { w: 320, h: 320 };
  const wave = { ...pathShapeFromCanvasPoints([anchorFromDrag({ x: 0.1, y: 0.5 }, { x: 0.25, y: 0.1 }, box), anchorFromDrag({ x: 0.5, y: 0.5 }, { x: 0.65, y: 0.9 }, box), { x: 0.9, y: 0.5 }], false, 's', '#ff2d95')!, strokeWidth: 3 } as ShapeLayer;
  const outline = strokeToResult(wave, canvas);
  const star = { kind: 'shape', id: 's', shape: 'star', starPoints: 5, innerRatio: 0.5, position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fill: '#2060e0' } as unknown as ShapeLayer;
  const [grown, shrunk] = [offsetToResult(star, canvas, 8), offsetToResult(star, canvas, -8)];
  if (!outline || !grown || !shrunk) {
    log(false, 'útvonal-műveletek', 'nincs eredmény');
    return;
  }
  const outlined = { ...wave, ...withResult(wave, outline) } as ShapeLayer;
  const [g, sh] = [{ ...star, ...withResult(star, grown) } as ShapeLayer, { ...star, ...withResult(star, shrunk) } as ShapeLayer];
  const [pStar, pG, pS] = [layerSkPath(star, canvas), layerSkPath(g, canvas), layerSkPath(sh, canvas)];
  let [wrong, total, aS, aStar, aG] = [0, 0, 0, 0, 0];
  for (let y = 4; y < 320; y += 6) {
    for (let x = 4; x < 320; x += 6) {
      const [i, j, k] = [pS.contains(x, y), pStar.contains(x, y), pG.contains(x, y)];
      total += 1;
      if ((j && !k) || (i && !j)) wrong += 1;
      aS += i ? 1 : 0;
      aStar += j ? 1 : 0;
      aG += k ? 1 : 0;
    }
  }
  log(wrong === 0 && aG > aStar && aS < aStar, 'eltolás: a bővített tartalmazza, a szűkített benne van', `területek ${aS} < ${aStar} < ${aG}, hibás ${wrong}/${total}`);

  const cases: [string, ImageDoc, ImageDoc][] = [
    ['szerkesztett lyuk', docOf(edited), docOf(compound)],
    ['vonalból forma = az eredeti vonal', docOf(outlined), docOf(wave)],
    ['bővített csillag', docOf(g), docOf(star)],
    ['szűkített csillag', docOf(sh), docOf(star)],
  ];
  for (const [name, doc, other] of cases) {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1200);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [e, c] = [await renderImageDoc(doc, 320), await renderImageDoc(other, 320)];
    if (!e || !c) {
      log(false, `útvonal = export: ${name}`, 'nincs render');
      continue;
    }
    const d = meanDiff(a, await decode(e), 320, 320);
    const ctl = meanDiff(a, await decode(c), 320, 320);
    const same = name.startsWith('vonalból');
    log(same ? d <= 5 && ctl <= 5 : d <= 5 && ctl >= d * 1.5, `útvonal = export: ${name}`, `átlag ${d.toFixed(1)}/255; ${same ? 'az eredeti vonal exportjától' : 'ellenpróba'} ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(e);
    removeFile(c);
  }
}

/** A rács a szerkesztőben látszik, a képbe és az exportba nem kerül. */
async function smokeGrid(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const shape = { kind: 'shape', id: 's', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff2d95' } as ImageLayer;
  const bg = { kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer;
  const plain = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [bg, shape] } as unknown as ImageDoc;
  const doc = { ...plain, grid: { size: 32, show: true, snap: true } } as ImageDoc;
  const shot = async (d: ImageDoc, capturing: boolean) => {
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing={capturing} />
      </View>
    );
    await sleep(900);
    const uri = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const img = await decode(uri);
    removeFile(uri);
    return img;
  };
  const [edit, none, capture] = [await shot(doc, false), await shot(plain, false), await shot(doc, true)];
  setHarness(null);
  const edge = meanDiff(edit, none, 320, 320);
  let lines = 0;
  // a hajszálvonal a kicsinyítésben részben eltűnik: a jelenlét számít, rács nélkül ez pontosan 0
  for (let i = 0; i < 320; i++) if (Math.abs(pixel(edit, i, 20)[1] - pixel(none, i, 20)[1]) > 2) lines += 1;
  log(lines > 0, 'a rács látszik a szerkesztőben', `${lines} eltérő pont a sorban, átlag ${edge.toFixed(1)}`);
  log(meanDiff(capture, none, 320, 320) < 1, 'a mentett képbe nem kerül', `átlag ${meanDiff(capture, none, 320, 320).toFixed(1)}/255`);
  const [a, b] = [await renderImageDoc(doc, 320), await renderImageDoc(plain, 320)];
  if (a && b) {
    const d = meanDiff(await decode(a), await decode(b), 320, 320);
    log(d === 0, 'az exportba nem kerül', `átlag ${d.toFixed(1)}/255`);
    removeFile(a);
    removeFile(b);
  } else {
    log(false, 'az exportba nem kerül', 'nincs render');
  }
  setHarness(
    <View style={{ width: 300, height: 300 }}>
      <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a rács a kijelzőn');
  await sleep(6000);
  setHarness(null);
}

/** Fájl-import, exportméret, becslés és megszakítás a valódi úton. */
async function smokeImportExport(log: Log) {
  const pngFile = (w: number, h: number, name: string) => {
    const surface = Skia.Surface.MakeOffscreen(w, h)!;
    const c = surface.getCanvas();
    const paint = Skia.Paint();
    for (let i = 0; i < 40; i++) {
      paint.setColor(Skia.Color(`rgb(${(i * 37) % 255},${(i * 91) % 255},${(i * 53) % 255})`));
      c.drawRect(Skia.XYWHRect(0, (i * h) / 40, w, h / 40 + 1), paint);
    }
    surface.flush();
    const file = new File(projectMediaDir(), `${name}_${Date.now().toString(36)}.png`);
    file.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
    return file.uri;
  };
  const ok = await ingestImageFile(pngFile(400, 200, 'imp'));
  log(ok.status === 'ok' && ok.width === 400, 'érvényes képfájl beolvasva', JSON.stringify({ s: ok.status }));
  const bad = new File(projectMediaDir(), `rossz_${Date.now().toString(36)}.png`);
  bad.write('ez nem kép');
  const invalid = await ingestImageFile(bad.uri);
  log(invalid.status === 'invalid', 'a sérült fájl nem megy tovább', invalid.status);
  removeFile(bad.uri);
  const big = await ingestImageFile(pngFile(4000, 1000, 'big'));
  log(big.status === 'ok' && big.width === 3072 && big.originalWidth === 4000, 'a túl nagy kép kicsinyül, és tudjuk az eredetit', big.status === 'ok' ? `${big.originalWidth} → ${big.width}` : big.status);

  const photoUri = pngFile(1024, 1024, 'exp');
  const doc = { id: 'full', name: 'p', aspectRatio: '1:1', width: 1024, height: 1024, layers: [{ kind: 'photo', id: 'p', uri: photoUri, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'stretch' }] } as unknown as ImageDoc;
  const size = customExportSize(doc, 700);
  const out = await renderImageDoc(doc, size.height);
  if (out) {
    const img = await decode(out);
    log(img.height() === size.height && img.width() === size.width, 'az egyedi méret pontos', `${img.width()}×${img.height()}, kért ${size.width}×${size.height}`);
    removeFile(out);
  } else {
    log(false, 'az egyedi méret pontos', 'nincs render');
  }

  // a becslés a valódi fájlmérethez: csíkos grafika és a csomagolt, részletgazdag logó
  const art = (await Asset.fromModule(require('../../assets/images/icon.png')).downloadAsync()).localUri!;
  for (const [label, uri] of [['csíkos', photoUri], ['logó', art]] as const) {
    const estDoc = { ...doc, id: `est${label === 'logó' ? 1 : 0}`, layers: [{ ...(doc.layers[0] as PhotoLayer), uri }] } as ImageDoc;
    for (const [format, quality] of [['png', 1], ['jpg', 0.9]] as const) {
      const out2 = await renderImageDoc(estDoc, 1024, { format, quality });
      const bpp = await photoBytesPerPixel([uri], format, quality);
      if (out2 && bpp != null) {
        const real = new File(out2).size ?? 0;
        const guess = bpp * 1024 * 1024;
        const ratio = real ? guess / real : 0;
        log(ratio >= 0.25 && ratio <= 4, `becslés ${label} ${format}`, `becsült ${formatBytes(guess)}, valódi ${formatBytes(real)}, arány ${ratio.toFixed(2)}`);
        removeFile(out2);
      } else {
        log(false, `becslés ${label} ${format}`, 'nincs mérés');
      }
    }
  }

  // a minőségkapu a valódi fájlokon: a jót átengedi, a rosszat megfogja
  const bgDoc = { ...doc, id: 'gate', layers: [{ kind: 'fill', id: 'f', fill: '#ffffff' } as ImageLayer, { ...(doc.layers[0] as PhotoLayer), w: 0.5, h: 0.5 }] } as ImageDoc;
  const partOf = layerOnlyDoc(bgDoc, 'p')!;
  const part = await renderImageDoc(partOf, 512);
  if (part) {
    const facts = await readExportFacts(part);
    const expected = { ...customExportSize(partOf, 512), format: 'png' as const, wantsAlpha: expectsAlpha(partOf, 'png') };
    log(exportProblems(facts, expected).length === 0 && facts.hasAlpha, 'réteg-export: átlátszó háttéren, kapu átengedi', `${facts.width}×${facts.height}, alfa ${facts.hasAlpha}`);
    const img = await decode(part);
    log(pixel(img, 10, 10)[3] === 0 && pixel(img, 256, 256)[3] === 255, 'a réteg a helyén, körülötte átlátszó', `sarok α=${pixel(img, 10, 10)[3]}, közép α=${pixel(img, 256, 256)[3]}`);
    const wrong = exportProblems(facts, { ...expected, width: 1024, height: 1024 });
    log(wrong.includes('size'), 'a kapu megfogja a rossz méretet', wrong.join(','));
    removeFile(part);
  } else {
    log(false, 'réteg-export', 'nincs render');
  }
  const sel = applyRing(null, rectRing({ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.5 }), 'new')!;
  const selPart = await renderImageDoc(selectionOnlyDoc(bgDoc, sel, 'p')!, 512);
  if (selPart) {
    const img = await decode(selPart);
    log(pixel(img, 200, 200)[3] === 255 && pixel(img, 300, 300)[3] === 0, 'kijelölés-export: csak a terület marad', `benne α=${pixel(img, 200, 200)[3]}, kívül α=${pixel(img, 300, 300)[3]}`);
    removeFile(selPart);
  } else {
    log(false, 'kijelölés-export', 'nincs render');
  }
  const flat = await renderImageDoc(bgDoc, 256, { format: 'jpg' });
  if (flat) {
    const facts = await readExportFacts(flat);
    const missing = exportProblems(facts, { width: 256, height: 256, format: 'png', wantsAlpha: true });
    log(!facts.hasAlpha && missing.includes('alpha'), 'a kapu megfogja az elveszett átlátszóságot', missing.join(','));
    removeFile(flat);
  }
  const broken = new File(projectMediaDir(), `tort_${Date.now().toString(36)}.png`);
  broken.write('nem kép');
  const bf = await readExportFacts(broken.uri);
  log(exportProblems(bf, { width: 1, height: 1, format: 'png', wantsAlpha: false })[0] === 'unreadable', 'a kapu megfogja a nem nyitható fájlt', `opened=${bf.opened}`);
  removeFile(broken.uri);

  // megszakítás: a kérés indul, azonnal leállítjuk, a következő export zavartalan
  const ctrl = new AbortController();
  const cancelled = renderImageDoc({ ...doc, id: 'cancel' } as ImageDoc, 4000, { signal: ctrl.signal }).then(
    () => 'lefutott',
    (e: unknown) => (e instanceof ExportCancelled ? 'megszakítva' : String(e))
  );
  await sleep(40);
  ctrl.abort();
  const verdict = await cancelled;
  log(verdict === 'megszakítva', 'a megszakítás leállít, nem hiba', verdict);
  const after = await renderImageDoc({ ...doc, id: 'after' } as ImageDoc, 512);
  log(!!after, 'megszakítás után újra exportál', after ? 'kész' : 'nincs render');
  removeFile(photoUri);
}

/** Az asszisztens végig: mondat → parancsok → dokumentum → vászon és export. */
async function smokeAssistant(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  const surface = Skia.Surface.MakeOffscreen(320, 320)!;
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#4080c0'));
  surface.getCanvas().drawRect(Skia.XYWHRect(0, 0, 320, 320), paint);
  surface.flush();
  const png = new File(projectMediaDir(), `smoke_as_${Date.now().toString(36)}.png`);
  png.write(surface.makeImageSnapshot().encodeToBytes(ImageFormat.PNG));
  const start = { id: 'full', name: 'p', aspectRatio: '1:1', width: 320, height: 320, layers: [
    { kind: 'fill', id: 'bg', fill: '#ffffff' },
    { kind: 'photo', id: 'p', uri: png.uri, position: { x: 0.5, y: 0.5 }, w: 0.6, h: 0.6, fit: 'stretch' },
    { kind: 'shape', id: 'c', shape: 'ellipse', position: { x: 0.3, y: 0.3 }, w: 0.2, h: 0.2, fill: '#ff0000' },
  ] } as unknown as ImageDoc;
  let n = 0;
  const say = (doc: ImageDoc, text: string) => {
    const { commands, unknown } = parseImageIntent(text, doc, null);
    return { unknown, doc: applyImageCommands(doc, commands, () => `new${++n}`).doc };
  };
  const steps = [
    'a kör legyen kék, tedd a kört felülre és a kör legyen nagyobb',
    'adj hozzá egy zöld csillagot',
    'a fotó legyen sötétebb, forgasd a fotót 20 fokkal',
    'legyen fekete a háttér',
  ];
  let doc = start;
  for (const text of steps) {
    const before = doc;
    const res = say(doc, text);
    doc = res.doc;
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: 340, height: 320 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1300);
    const shot = await captureRef(v, { format: 'png', quality: 1, width: 320 / ratio, height: 320 / ratio });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const [e, c] = [await renderImageDoc(doc, 320), await renderImageDoc(before, 320)];
    if (e && c) {
      const d = meanDiff(a, await decode(e), 320, 320);
      const ctl = meanDiff(a, await decode(c), 320, 320);
      log(res.unknown.length === 0 && d <= 6 && ctl >= d * 1.5, `asszisztens: ${text}`, `átlag ${d.toFixed(1)}/255; a lépés előtti állapottól ${ctl.toFixed(1)}`);
      removeFile(e);
      removeFile(c);
    } else {
      log(false, `asszisztens: ${text}`, 'nincs render');
    }
    removeFile(shot);
  }
  setHarness(
    <Modal transparent visible>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#20242e' }}>
        <AssistantBar doc={doc} selectedId={null} onApply={() => {}} onClose={() => {}} />
      </View>
    </Modal>
  );
  await sleep(2500);
  log(true, 'FOTÓZHATÓ', 'az asszisztens sávja a kijelzőn');
  await sleep(5000);
  setHarness(null);
  removeFile(png.uri);
}

/** Sablonok, méretváltozat és a kép→videó a valódi vásznon, szerveren és tárolón át. */
async function smokeEcosystem(log: Log, setHarness: (n: ReactNode) => void, ratio: number, brandOnly = false) {
  let n = 0;
  const id = () => `eco${++n}`;
  const check = async (name: string, doc: ImageDoc, other: ImageDoc) => {
    const { width, height } = effectiveCanvas(doc);
    const scale = Math.min(320 / width, 320 / height);
    const [W, H] = [Math.round(width * scale), Math.round(height * scale)];
    const v = createRef<View>() as RefObject<View>;
    setHarness(
      <View style={{ width: W + 20, height: H + 20 }}>
        <ImageCanvas doc={doc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
      </View>
    );
    await sleep(1300);
    // a kijelző teljes felbontásán: a kis szöveg így nem mintavételi zaj
    const shot = await captureRef(v, { format: 'png', quality: 1, width: W, height: H });
    const a = await decode(shot);
    setHarness(null);
    await sleep(80);
    const target = Math.max(240, H * ratio);
    const [e, c] = [await renderImageDoc(doc, target), await renderImageDoc(other, target)];
    if (!e || !c) {
      log(false, name, 'nincs render');
      return;
    }
    // a két kép mérete eltérhet (a szerver minimum 240 magas): arányos pontokon hasonlítunk
    const diff = (p: SkImage, q: SkImage) => {
      let sum = 0;
      let count = 0;
      for (let i = 1; i < 40; i++) {
        for (let j = 1; j < 40; j++) {
          const [x, y] = [(j + 0.5) / 40, (i + 0.5) / 40];
          const [u, w] = [pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height())), pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()))];
          sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
          count += 1;
        }
      }
      return sum / count;
    };
    const d = diff(a, await decode(e));
    const ctl = diff(a, await decode(c));
    // hol van a fehér szöveg a két képen, a kép arányában
    const whiteBox = (img: SkImage) => {
      let [x0, y0, x1, y1] = [1, 1, 0, 0];
      for (let i = 0; i < 120; i++) {
        for (let j = 0; j < 120; j++) {
          const [x, y] = [j / 120, i / 120];
          const p = pixel(img, Math.floor(x * img.width()), Math.floor(y * img.height()));
          if (p[0] > 230 && p[1] > 230 && p[2] > 230) {
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
      }
      return `${x0.toFixed(2)},${y0.toFixed(2)}–${x1.toFixed(2)},${y1.toFixed(2)}`;
    };
    log(null, `doboz ${name}`, `vászon ${whiteBox(a)}, export ${whiteBox(await decode(e))}`);
    log(d <= 7 && ctl >= d * 1.5, name, `átlag ${d.toFixed(1)}/255; ellenpróba ${ctl.toFixed(1)}`);
    removeFile(shot);
    removeFile(e);
    removeFile(c);
  };
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height} betűméret ${PixelRatio.getFontScale()}`);
  if (brandOnly) {
    // a felhasználó márkáját a mérés után visszaírjuk
    const mine = await loadBrandStyle();
    const brand = { colors: ['#ffd166', '#0a7d3e'], fontFamily: 'Bungee' };
    await saveBrandStyle(brand);
    const stored = await loadBrandStyle();
    log(stored.fontFamily === 'Bungee' && stored.colors.length === 2, 'márka: visszaolvasva a tárolóból', JSON.stringify(stored));
    for (const tpl of IMAGE_TEMPLATES) {
      const doc = docFromTemplate(tpl, tpl.key, id, stored);
      // ellenpróba: ugyanaz a sablon márka nélkül; ha a szerver nem kapná a fontot, ez bukna
      await check(`márkás sablon = export: ${tpl.key}`, doc, docFromTemplate(tpl, tpl.key, id));
    }
    const plain = docFromTemplate(IMAGE_TEMPLATES[0], 'a', id, { colors: [], fontFamily: 'Poppins' });
    await check('a márka-font valóban más képet ad', docFromTemplate(IMAGE_TEMPLATES[0], 'b', id, { colors: [], fontFamily: 'Bungee' }), plain);
    useBrandStyle.setState({ colors: stored.colors, fontFamily: stored.fontFamily });
    setHarness(
      <Modal transparent visible>
        <TemplatesSheet onPick={() => {}} onClose={() => {}} />
      </Modal>
    );
    await sleep(1500);
    log(true, 'FOTÓZHATÓ', 'a Sablonok lap a márkával');
    await sleep(9000);
    setHarness(null);
    useBrandStyle.setState({ colors: mine.colors, fontFamily: mine.fontFamily });
    await saveBrandStyle(mine);
    return;
  }
  const docs = IMAGE_TEMPLATES.map((tpl) => docFromTemplate(tpl, tpl.key, id));
  for (const [i, doc] of docs.entries()) {
    await check(`sablon = export: ${IMAGE_TEMPLATES[i].key}`, doc, { ...doc, layers: doc.layers.slice(0, 1) } as ImageDoc);
  }
  const post = docs[1];
  const story = variantDoc(post, 1080, 1920, 'Story', id);
  await check('változat 9:16 = export', story, post);
  const wide = variantDoc(post, 1500, 500, 'Fejléc', id);
  await check('változat széles = export', wide, post);

  const video = addImageDocToVideo(createEmptyProject('smoke kép→videó', '16:9', undefined, 'video'), post, 'file:///smoke.png');
  await saveProject(video);
  const loaded = await loadProject(video.id);
  const clip = loaded?.tracks.find((t) => t.type === 'video')?.clips[0] as ImageClip | undefined;
  const restored = loaded?.imageDocs?.find((d) => d.id === clip?.docId);
  log(restored?.layers.length === post.layers.length, 'kép→videó: mentés után is ott a réteges dokumentum', `${restored?.layers.length ?? 0} réteg, docId ${clip?.docId ? 'megvan' : 'nincs'}`);
  await deleteProject(video.id);
}

/** Kép-poszt remixe valódi hálózati képekből: projekt, megnyitás a stúdióban, vászon = export. */
async function smokeRemix(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  // nyilvános https-kép kell: a szerver privát címről védelemből nem tölt le (SSRF)
  const base = 'https://raw.githubusercontent.com/M4rkH3nz3L/ReMix/main/assets/images';
  const post = {
    id: 'smoke-post',
    title: 'Teszt',
    remixable: true,
    videoUri: null,
    images: [`${base}/icon.png`, `${base}/android-icon-background.png`],
    aspectRatio: '1:1',
    creator: { displayName: 'Teszt Elek' },
  } as unknown as FeedPost;
  const id = await remixFromPost(post);
  const saved = id ? await loadProject(id) : null;
  const docs = saved?.imageDocs ?? [];
  log(saved?.kind === 'image' && docs.length === 2 && saved.remixOf?.postId === 'smoke-post', 'remix: új kép-projekt két lappal, forrással', `${saved?.kind} ${docs.length} lap, ${saved?.remixOf?.postId}`);
  if (!id || docs.length !== 2) {
    return;
  }
  log(remixRoute(post, id) === `/studio/image/${id}`, 'remix: a képstúdióba visz', remixRoute(post, id));
  const v = createRef<View>() as RefObject<View>;
  setHarness(
    <View style={{ width: 340, height: 340 }}>
      <ImageCanvas doc={docs[0]} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
    </View>
  );
  // a hálózati kép lassabban ér ide, mint a helyi
  await sleep(6000);
  const shot = await captureRef(v, { format: 'png', quality: 1, width: 320, height: 320 });
  const a = await decode(shot);
  setHarness(null);
  await sleep(80);
  const [e, c] = [await renderImageDoc(docs[0], 320 * ratio), await renderImageDoc(docs[1], 320 * ratio)];
  if (!e || !c) {
    log(false, 'remix: hálózati kép az exportban', 'nincs render');
  } else {
    const diff = (p: SkImage, q: SkImage) => {
      let sum = 0;
      for (let i = 1; i < 30; i++) {
        for (let j = 1; j < 30; j++) {
          const [x, y] = [(j + 0.5) / 30, (i + 0.5) / 30];
          const [u, w] = [pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height())), pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()))];
          sum += (Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2])) / 3;
        }
      }
      return sum / (29 * 29);
    };
    const [d, ctl] = [diff(a, await decode(e)), diff(a, await decode(c))];
    log(d <= 7 && ctl >= 20, 'remix: a hálózati kép a vásznon = export', `átlag ${d.toFixed(1)}/255; a másik lap ${ctl.toFixed(1)}`);
    removeFile(e);
    removeFile(c);
  }
  removeFile(shot);
  router.push(remixRoute(post, id) as Href);
  await sleep(4000);
  const open = useEditorStore.getState().project;
  log(open?.id === id && open.imageDocs?.length === 2, 'remix: a valódi képstúdió megnyitotta', `${open?.name}, ${open?.imageDocs?.length} lap`);
  log(true, 'FOTÓZHATÓ', 'a remix a képstúdióban');
  await sleep(7000);
  router.back();
  await sleep(2000);
  await deleteProject(id);
  log((await loadProject(id)) === null, 'remix: a tesztprojekt törölve', id);
}

/** Nagy dokumentum költsége: módosítás, visszavonás, mentés, vászon. Fejlesztői build, a növekedés a lényeg. */
async function smokePerf(log: Log, setHarness: (n: ReactNode) => void) {
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const timed = async (fn: () => unknown) => {
    const t = performance.now();
    await fn();
    return performance.now() - t;
  };
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const count of [20, 100, 400]) {
    let n = 0;
    const id = () => `perf${count}_${++n}`;
    let doc = createImageDoc('perf', '1:1', id, { width: 1080, height: 1080 });
    for (let i = 0; i < count; i++) {
      const position = { x: ((i * 37) % 100) / 100, y: ((i * 61) % 100) / 100 };
      doc = addLayer(doc, i % 3 === 0
        ? ({ kind: 'text', id: id(), text: `Szöveg ${i}`, position, fontSize: 4, color: '#ffffff', fontFamily: 'Poppins' } as ImageLayer)
        : ({ kind: 'shape', id: id(), shape: 'rectangle', position, w: 0.1, h: 0.1, fill: '#ff2d95' } as ImageLayer));
    }
    const project = { ...createEmptyProject(`perf ${count}`, '1:1', undefined, 'image'), imageDocs: [doc] };
    useEditorStore.getState().loadProject(project, []);
    const moved = (d: ImageDoc, k: number) => updateLayer(d, d.layers[d.layers.length - 1].id, { position: { x: 0.1 + k / 100, y: 0.5 } } as Partial<ImageLayer>);
    const commits: number[] = [];
    const undos: number[] = [];
    for (let k = 0; k < 9; k++) {
      commits.push(await timed(() => useEditorStore.getState().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: moved(doc, k) }, 'user')));
    }
    for (let k = 0; k < 5; k++) {
      undos.push(await timed(() => useEditorStore.getState().undo()));
    }
    const state = useEditorStore.getState();
    const bytes = JSON.stringify(state.project).length;
    const save = await timed(() => saveProjectAndEvents(state.project!, state.events));
    const renders: number[] = [];
    const view = (d: ImageDoc) => (
      <Profiler id="canvas" onRender={(_id, _phase, actual) => { renders.push(actual); }}>
        <View style={{ width: 320, height: 320 }}>
          <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} capturing />
        </View>
      </Profiler>
    );
    setHarness(view(doc));
    await sleep(1500);
    const mount = renders.reduce((a, b) => a + b, 0);
    const updates: number[] = [];
    for (let k = 0; k < 5; k++) {
      renders.length = 0;
      setHarness(view(moved(doc, k)));
      await sleep(250);
      updates.push(renders.reduce((a, b) => a + b, 0));
    }
    setHarness(null);
    await sleep(200);
    // a memo nem hagyhat elavult képet: a korrekció és az eltolt réteg azonnal látszik
    if (count === 20) {
      const v = createRef<View>() as RefObject<View>;
      const frame = (d: ImageDoc) => (
        <View style={{ width: 200, height: 200 }}>
          <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
        </View>
      );
      const grab = async () => {
        await sleep(350);
        const uri = await captureRef(v, { format: 'png', quality: 1, width: 120, height: 120 });
        const img = await decode(uri);
        removeFile(uri);
        return img;
      };
      const distance = (p: SkImage, q: SkImage) => {
        let sum = 0;
        for (let i = 0; i < 400; i++) {
          const [x, y] = [(i * 53) % 120, (i * 97) % 120];
          const [u, w] = [pixel(p, x, y), pixel(q, x, y)];
          sum += Math.abs(u[0] - w[0]) + Math.abs(u[1] - w[1]) + Math.abs(u[2] - w[2]);
        }
        return sum / 1200;
      };
      setHarness(frame(doc));
      const base = await grab();
      const graded = addLayer(doc, { kind: 'adjust', id: id(), name: 'k', adjust: { brightness: -0.6 } } as unknown as ImageLayer);
      setHarness(frame(graded));
      const dark = await grab();
      const lighter = { ...graded, layers: graded.layers.map((l) => (l.kind === 'adjust' ? ({ ...l, adjust: { brightness: 0.6 } } as ImageLayer) : l)) };
      setHarness(frame(lighter));
      const light = await grab();
      setHarness(frame(doc));
      const back = await grab();
      setHarness(null);
      log(distance(base, dark) > 8 && distance(dark, light) > 8, 'memo: az új és a változó korrekció azonnal látszik', `alap→sötét ${distance(base, dark).toFixed(1)}, sötét→világos ${distance(dark, light).toFixed(1)}`);
      log(distance(base, back) < 1, 'memo: a korrekció törlése visszaadja az eredeti képet', `${distance(base, back).toFixed(2)}`);
    }
    log(median(updates) <= (count === 400 ? 100 : 30), `perf ${count} réteg: egy réteg változása elfér`, `${median(updates).toFixed(0)} ms`);
    log(null, `perf ${count} réteg`, `módosítás ${median(commits).toFixed(1)} ms, undo ${median(undos).toFixed(1)} ms, mentés ${save.toFixed(0)} ms (${Math.round(bytes / 1024)} kB), vászon-felépítés ${mount.toFixed(0)} ms, egy réteg változása ${median(updates).toFixed(0)} ms`);
    useEditorStore.getState().closeProject();
    await deleteProject(project.id);
  }
}

/** Nagy fotók a vásznon: megjelenés és egy fotó mozgatásának ára. */
async function smokePerfPhotos(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let seq = 0;
  const id = () => `perfp${++seq}`;
  const source = addLayer(createImageDoc('forrás', '1:1', id, { width: 3072, height: 3072 }), { kind: 'shape', id: id(), shape: 'ellipse', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.8, fill: '#ff2d95', gradient: { type: 'linear', angle: 45, stops: [{ color: '#ff2d95', offset: 0 }, { color: '#00e5ff', offset: 1 }] } } as unknown as ImageLayer);
  const png = await renderImageDoc(source, 3072);
  if (!png) {
    log(false, 'perf fotó: forrás', 'nincs render');
    return;
  }
  const files: File[] = [];
  for (let i = 0; i < 10; i++) {
    const copy = new File(Paths.cache, `perf_${Date.now()}_${i}.png`);
    new File(png).copy(copy);
    files.push(copy);
  }
  log(null, 'forrás', `3072×3072 PNG, ${Math.round(new File(png).size / 1024)} kB`);
  for (const count of [2, 5, 10]) {
    let doc = createImageDoc('fotók', '1:1', id, { width: 1080, height: 1080 });
    for (let i = 0; i < count; i++) {
      doc = addLayer(doc, { kind: 'photo', id: id(), name: `${i}`, uri: files[i].uri, position: { x: 0.2 + 0.06 * i, y: 0.5 }, w: 0.7, h: 0.7, fit: 'cover' } as PhotoLayer);
    }
    const renders: number[] = [];
    const v = createRef<View>() as RefObject<View>;
    const view = (d: ImageDoc) => (
      <Profiler id="canvas" onRender={(_id, _phase, actual) => { renders.push(actual); }}>
        <View style={{ width: 320, height: 320 }}>
          <ImageCanvas doc={d} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
        </View>
      </Profiler>
    );
    const start = performance.now();
    setHarness(view(doc));
    let shown = -1;
    for (let i = 0; i < 60 && shown < 0; i++) {
      await sleep(100);
      if (!v.current) {
        continue;
      }
      const uri = await captureRef(v, { format: 'png', quality: 1, width: 64, height: 64 });
      const img = await decode(uri);
      removeFile(uri);
      // a legfelső fotó a szélén látszik először: a sarokhoz közel még a háttér volt
      const p = pixel(img, Math.round(img.width() * (0.2 + 0.06 * (count - 1))), Math.round(img.height() / 2));
      if (Math.abs(p[0] - 18) + Math.abs(p[1] - 18) + Math.abs(p[2] - 26) > 40) {
        shown = performance.now() - start;
      }
    }
    await sleep(500);
    const updates: number[] = [];
    const last = doc.layers[doc.layers.length - 1];
    for (let k = 0; k < 7; k++) {
      renders.length = 0;
      setHarness(view(updateLayer(doc, last.id, { position: { x: 0.3 + k / 50, y: 0.5 } } as Partial<ImageLayer>)));
      await sleep(120);
      updates.push(renders.reduce((a, b) => a + b, 0));
    }
    setHarness(null);
    await sleep(300);
    const median = [...updates].sort((a, b) => a - b)[3];
    log(shown > 0, `perf ${count} fotó megjelent`, `${shown.toFixed(0)} ms`);
    log(median <= 30, `perf ${count} fotó: egy fotó mozgatása`, `${median.toFixed(0)} ms`);
  }
  files.forEach((f) => f.delete());
  removeFile(png);
}

/** Pixel art: a kép, a GIF és a sprite-lap a valódi Skia-dekóderen át, a réteg a vásznon és a szerveren. */
async function smokePixel(log: Log, setHarness: (n: ReactNode) => void, ratio: number) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const [w, h] = [32, 32];
  const frames: PixelFrame[] = [0, 1, 2].map((n) => {
    const f = new Uint8Array(w * h);
    paintLine(f, w, h, 4 + n * 3, 4, 20, 26, 9, { x: true, y: false });
    paintLine(f, w, h, 0, 31, 31, 31, 12, { x: false, y: false });
    floodFill(f, w, h, 15, 2, 0, { x: false, y: false });
    f[(5 + n) * w + 15] = 11;
    // a mintavétel a kitöltött területet látja, a vékony vonalat nem
    f.fill(4 + n, 8 * w, 8 * w);
    for (let y = 8; y < 24; y++) {
      f.fill(4 + n, y * w + 8, y * w + 24);
    }
    return f;
  });
  const art: PixelArt = { width: w, height: h, palette: [...DEFAULT_PALETTE], frames: frames.map(encodeFrame), fps: 8 };
  const expected = (frame: PixelFrame, x: number, y: number) => {
    const v = frame[y * w + x];
    if (v === 0) {
      return null;
    }
    const n = parseInt(DEFAULT_PALETTE[v - 1].slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const mismatches = (img: SkImage, frame: PixelFrame, scale: number, ox = 0, oy = 0) => {
    const px = img.readPixels(ox, oy, { width: w * scale, height: h * scale, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    let bad = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const at = ((y * scale + scale - 1) * w * scale + x * scale + scale - 1) * 4;
        const want = expected(frame, x, y);
        const got = px ? [px[at], px[at + 1], px[at + 2]] : [];
        if (want ? got.join() !== want.join() || (px as Uint8Array)[at + 3] !== 255 : (px as Uint8Array)[at + 3] !== 0) {
          bad++;
        }
      }
    }
    return bad;
  };
  const scale = pixelLayerScale(w, h);
  const png = writeLayerPng(art);
  const img = await decode(png);
  log(img.width() === w * scale && mismatches(img, frames[0], scale) === 0, 'réteg-PNG pontos és éles', `${img.width()}×${img.height()}, eltérés ${mismatches(img, frames[0], scale)}/${w * h}`);

  const gifUri = writePixelGif(art, 4);
  const gifData = await Skia.Data.fromURI(gifUri);
  const gif = Skia.AnimatedImage.MakeAnimatedImageFromEncoded(gifData);
  log(gif?.getFrameCount() === 3, 'GIF: a Skia három kockát olvas', `${gif?.getFrameCount()}`);
  log(Math.abs((gif?.currentFrameDuration() ?? 0) - 120) <= 10, 'GIF: 8 fps időzítés', `${gif?.currentFrameDuration()} ms`);
  for (let n = 0; n < 3 && gif; n++) {
    const shot = gif.getCurrentFrame();
    const bad = shot ? mismatches(shot, frames[n], 4) : -1;
    log(bad === 0, `GIF ${n + 1}. kocka pixelre pontos`, `eltérés ${bad}/${w * h}`);
    gif.decodeNextFrame();
  }
  const sheetUri = writeSpriteSheet(art, 2);
  const sheet = await decode(sheetUri);
  log(sheet.width() === 128 && sheet.height() === 128 && mismatches(sheet, frames[2], 2, 0, 64) === 0, 'sprite-lap: a 3. kocka a helyén', `${sheet.width()}×${sheet.height()}, eltérés ${mismatches(sheet, frames[2], 2, 0, 64)}`);

  let n = 0;
  const id = () => `pix${++n}`;
  const base = createImageDoc('pixel', '1:1', id, { width: 1080, height: 1080, background: '#20242e' });
  const box = pixelLayerBox(w, h, 1080, 1080);
  const doc = addLayer(base, { kind: 'photo', id: id(), name: 'p', uri: png, position: { x: 0.5, y: 0.5 }, ...box, fit: 'stretch', pixelArt: art } as PhotoLayer);
  const project = { ...createEmptyProject('smoke pixel', '1:1', undefined, 'image'), imageDocs: [doc] };
  await saveProject(project);
  // a mentés a projekt mappájába költözteti a képet: a visszaolvasott dokumentum az érvényes
  const savedDoc = (await loadProject(project.id))?.imageDocs?.[0] ?? doc;
  const reopened = (savedDoc.layers[1] as PhotoLayer | undefined)?.pixelArt;
  log(reopened?.frames.join('|') === art.frames.join('|'), 'mentés után a rács szerkeszthető marad', `${reopened?.frames.length} kocka`);

  const v = createRef<View>() as RefObject<View>;
  setHarness(
    <View style={{ width: 340, height: 340 }}>
      <ImageCanvas doc={savedDoc} selectedId={null} onSelect={() => {}} commit={() => {}} canvasRef={v} capturing />
    </View>
  );
  await sleep(1200);
  const shot = await captureRef(v, { format: 'png', quality: 1, width: 320, height: 320 });
  const canvasImg = await decode(shot);
  setHarness(null);
  await sleep(80);
  const [e, c] = [await renderImageDoc(savedDoc, 320 * ratio), await renderImageDoc(base, 320 * ratio)];
  if (e && c) {
    const diff = (p: SkImage, q: SkImage) => {
      let sum = 0;
      for (let i = 1; i < 40; i++) {
        for (let j = 1; j < 40; j++) {
          const [x, y] = [(j + 0.5) / 40, (i + 0.5) / 40];
          const [u, t] = [pixel(p, Math.floor(x * p.width()), Math.floor(y * p.height())), pixel(q, Math.floor(x * q.width()), Math.floor(y * q.height()))];
          sum += (Math.abs(u[0] - t[0]) + Math.abs(u[1] - t[1]) + Math.abs(u[2] - t[2])) / 3;
        }
      }
      return sum / (39 * 39);
    };
    const [d, ctl] = [diff(canvasImg, await decode(e)), diff(canvasImg, await decode(c))];
    log(d <= 7 && ctl >= d * 1.5, 'pixel-réteg: vászon = export', `átlag ${d.toFixed(1)}/255; ellenpróba ${ctl.toFixed(1)}`);
    removeFile(e);
    removeFile(c);
  } else {
    log(false, 'pixel-réteg: vászon = export', 'nincs render');
  }
  await deleteProject(project.id);
  [shot, png, gifUri, sheetUri].forEach(removeFile);
  setHarness(<PixelStudio initial={art} onDone={() => {}} onClose={() => {}} />);
  await sleep(1500);
  log(true, 'FOTÓZHATÓ', 'pixel-szerkesztő');
  await sleep(8000);
  setHarness(null);
}

/** A gesztus-terület a valódi képernyőkön: megnyílnak, és a tárolóban él az undo-lánc. */
async function smokeGestureScreens(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const [kind, path] of [['video', '/editor'], ['audio', '/studio/audio'], ['live', '/live/studio']] as const) {
    const project = createEmptyProject(`smoke gesztus ${kind}`, '9:16', undefined, kind);
    await saveProject(project);
    const start = performance.now();
    router.push(`${path}/${project.id}` as Href);
    for (let i = 0; i < 100 && useEditorStore.getState().project?.id !== project.id; i++) {
      await sleep(200);
    }
    const open = useEditorStore.getState().project;
    log(open?.id === project.id, `${kind}: a képernyő megnyílt a gesztus-területtel`, `${Math.round(performance.now() - start)} ms`);
    await sleep(1000);
    router.back();
    await sleep(1500);
    await deleteProject(project.id);
  }
}

/** Élő adás két eszközön: az egyik ad, a másik néz; a szerver oldali ellenőrzés a Macről fut. */
async function smokeLiveHost(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const project = createEmptyProject('smoke live', '9:16', undefined, 'live');
  await saveProject(project);
  const session = await startLive('smoke live');
  log(null, 'LIVEID', session.id);
  router.push(`/live/${session.id}?project=${project.id}` as Href);
  await sleep(60000);
  await endLive(session.id);
  log(null, 'LIVEEND', session.id);
  await sleep(1500);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}

/** „Élő mentése videó-projektbe”: adás felvétellel, kilépés, a felvételből szerkeszthető projekt. */
async function smokeLiveRecord(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  setHarness(<View><RecordToggle value={false} onToggle={() => {}} /><RecordToggle value onToggle={() => {}} /></View>);
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'kapcsoló két állapotban');
  await sleep(4000);
  setHarness(null);
  const blank = createEmptyProject('smoke felvétel', '9:16', undefined, 'live');
  const project = { ...blank, live: setRecord(blank.live!, true) };
  await saveProject(project);
  const before = new Set((await listProjects()).map((p) => p.id));
  const session = await startLive('smoke felvétel');
  log(null, 'LIVEID', session.id);
  router.push(`/live/${session.id}?project=${project.id}` as Href);
  await sleep(35000);
  router.back();
  await sleep(4000);
  const created = (await listProjects()).filter((p) => !before.has(p.id) && p.kind === 'video');
  log(created.length === 1, 'a felvételből videóprojekt lett', `${created.length} új projekt`);
  const full = created[0] ? await loadProject(created[0].id) : null;
  const clip = full?.tracks.find((t) => t.type === 'video')?.clips[0] as VideoClip | undefined;
  log(!!clip?.uri && /^https:/.test(clip.uri), 'a projekt videósávján ott a felvétel', `${clip?.duration.toFixed(0)} mp, ${clip?.uri.slice(0, 48)}`);
  let size = 0;
  for (let i = 0; i < 45 && clip?.uri && size === 0; i++) {
    await sleep(2000);
    const res = await fetch(clip.uri, { headers: { Range: 'bytes=0-1' } }).catch((caught) => { logCaught('lib/imageSmoke.tsx:vod', caught); return null; });
    size = res && res.status < 300 ? Number(res.headers.get('content-range')?.split('/')[1] ?? 1) : 0;
  }
  log(size > 0, 'az MP4 letölthető a tárból', `${Math.round(size / 1024)} kB`);
  if (created[0]) {
    await deleteProject(created[0].id);
  }
  await endLive(session.id).catch((caught) => { logCaught('lib/imageSmoke.tsx:liveRecord', caught); });
}

async function smokeLiveView(log: Log, id: string) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  router.push(`/live/${id}` as Href);
  await sleep(30000);
  log(true, 'FOTÓZHATÓ', 'néző');
  await sleep(6000);
  router.back();
}

/** Tíz perces klip legnagyobb nagyításon a valódi szerkesztőben. */
async function smokeTimelineZoom(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let n = 0;
  const doc = createImageDoc('t', '9:16', () => `tz${++n}`);
  const base = addImageDocToVideo(createEmptyProject('smoke idővonal', '9:16', undefined, 'video'), doc, 'file:///smoke.png');
  const project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: t.clips.map((c) => ({ ...c, duration: 600 })) } : t)) };
  await saveProject(project);
  router.push(`/editor/${project.id}` as Href);
  await sleep(3500);
  const store = useEditorStore.getState();
  store.setZoom(100);
  await sleep(1500);
  const zoom = useEditorStore.getState().zoom;
  log(zoom === MAX_ZOOM, 'a nagyítás felső határa', `${zoom}× = ${(zoom * BASE_PX_PER_SEC) / 30} pont/kocka 30 fps-en`);
  log((zoom * BASE_PX_PER_SEC) / 30 >= 30, 'egy kocka ujjal fogható', '≥ 30 pont');
  const start = performance.now();
  for (let i = 1; i <= 10; i++) {
    store.setPlayhead(i * 55);
    await sleep(150);
  }
  log(useEditorStore.getState().project?.id === project.id, 'tíz perces klip végiggörgetve a legnagyobb nagyításon', `${(performance.now() - start).toFixed(0)} ms`);
  log(true, 'FOTÓZHATÓ', 'idővonal');
  await sleep(5000);
  store.setZoom(1);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}

/** A hosszú nyomás menüje és a többes sáv a kijelzőn. */
async function smokeMenus(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const layer = { kind: 'shape', id: 'm', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.4, h: 0.4, fill: '#fff' } as ImageLayer;
  setHarness(
    <View style={{ width: Math.min(420, Dimensions.get('window').width) }}>
      <MultiSelectBar count={3} onAction={() => {}} onClose={() => {}} />
      <LiveQuickGrid sources={[{ id: 'k', kind: 'camera', label: 'Kamera', visible: true }, { id: 'l', kind: 'logo', label: 'Logó', visible: false }, { id: 't', kind: 'text', label: 'Felirat', visible: true }]} micMuted={false} onToggle={() => {}} onMic={() => {}} onFlip={() => {}} />
      <LayerMenuSheet layer={layer} onPick={() => {}} onClose={() => {}} />
    </View>
  );
  await sleep(1500);
  log(true, 'FOTÓZHATÓ', 'menü és többes sáv');
  await sleep(6000);
  setHarness(null);
}

/** Gyors vissza és előre a valódi mesterórán: a lejátszófej a sebesség szerint halad. */
async function smokeShuttle(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  let n = 0;
  const base = addImageDocToVideo(createEmptyProject('smoke shuttle', '9:16', undefined, 'video'), createImageDoc('t', '9:16', () => `sh${++n}`), 'file:///smoke.png');
  const project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: t.clips.map((c) => ({ ...c, duration: 120 })) } : t)) };
  await saveProject(project);
  router.push(`/editor/${project.id}` as Href);
  const s = () => useEditorStore.getState();
  for (let i = 0; i < 40 && s().project?.id !== project.id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  s().setPlayhead(60);
  await sleep(300);
  const run = async (dir: 1 | -1, times: number, expected: number, name: string) => {
    s().setPlaybackRate(dir);
    for (let i = 0; i < times; i++) {
      s().shuttle(dir);
    }
    const [from, t0] = [s().playhead, performance.now()];
    await sleep(1500);
    const moved = s().playhead - from;
    const elapsed = (performance.now() - t0) / 1000;
    s().setPlaying(false);
    s().setPlaybackRate(1);
    const rate = moved / elapsed;
    log(Math.abs(rate - expected) < Math.abs(expected) * 0.25, name, `${rate.toFixed(2)}× (várt ${expected}×)`);
    await sleep(300);
  };
  await run(1, 1, 2, 'előre 2×');
  await run(1, 2, 4, 'előre 4×');
  await run(-1, 1, -2, 'vissza 2×');
  await run(-1, 2, -4, 'vissza 4×');
  const stopped = s().playhead;
  await sleep(600);
  log(s().playhead === stopped && !s().isPlaying, 'elengedés után megáll a helyén', `${stopped.toFixed(2)} mp`);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}

/** A Live Stúdió a valódi képernyőn: panelek, tablet-elrendezés, fogók. */
async function smokeLiveStudio(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const project = createEmptyProject('smoke stúdió', '9:16', undefined, 'live');
  await saveProject(project);
  const start = performance.now();
  router.push(`/live/studio/${project.id}` as Href);
  for (let i = 0; i < 100 && useEditorStore.getState().project?.id !== project.id; i++) {
    await sleep(200);
  }
  log(useEditorStore.getState().project?.id === project.id, 'a Stúdió megnyílt', `${Math.round(performance.now() - start)} ms`);
  await sleep(1500);
  log(true, 'FOTÓZHATÓ', 'Live Stúdió');
  await sleep(7000);
  router.back();
  await sleep(1500);
  await deleteProject(project.id);
}

/** A hosszú nyomás menüje a gyökérből, a valódi Modal-lal. */
async function smokeActionMenu(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  useActionMenu.getState().open('Videó', [
    { label: 'Több kijelölése', icon: 'checkmark-done-outline', onPress: () => {} },
    { label: 'Vágás itt', icon: 'cut-outline', onPress: () => {} },
    { label: 'Duplikálás', icon: 'copy-outline', onPress: () => {} },
    { label: 'Törlés', icon: 'trash-outline', destructive: true, onPress: () => {} },
  ]);
  await sleep(1200);
  log(useActionMenu.getState().items?.length === 4, 'a menü nyitva', '4 elem');
  log(true, 'FOTÓZHATÓ', 'menülap');
  await sleep(5000);
  useActionMenu.getState().close();
  await sleep(500);
}

/** Belépés azonosítóval a valódi hálózaton: a válasz nem különbözteti meg az ismeretlen fiókot. */
async function smokeLogin(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const out = await loginWithIdentifier('nincs_ilyen_felhasznalo', 'rossz-jelszo');
  log('error' in out && out.error === 'invalidCredentials', 'ismeretlen azonosító: általános hiba', JSON.stringify(out));
}

const AUDIO_KILL_ID = 'prj_smoke_audiokill';

/** Hang-autosave a valódi képernyőn: szerkesztés, majd a külső kilövés előtt megállunk. */
async function smokeAudioKillPrepare(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  await deleteProject(AUDIO_KILL_ID).catch((caught) => logCaught('lib/imageSmoke.tsx:audioKill', caught));
  await saveProject({ ...createEmptyProject('smoke hang-autosave', '9:16', undefined, 'audio'), id: AUDIO_KILL_ID });
  router.push(`/studio/audio/${AUDIO_KILL_ID}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== AUDIO_KILL_ID; i++) {
    await sleep(200);
  }
  await sleep(800);
  useEditorStore.getState().addClip('music', { kind: 'audio', id: 'smoke-kill-clip', uri: 'file:///smoke.m4a', label: 'kilövés előtt', start: 0, duration: 4, volume: 1, fadeIn: 0, fadeOut: 0 } as AudioClip);
  // a klip vágása is a mentésbe kerül
  useEditorStore.getState().splitClipAt('smoke-kill-clip', 2);
  await sleep(2500);
  log(null, 'KILLREADY', AUDIO_KILL_ID);
  await sleep(60000);
}

/** A45: az album-lap a szám-sorokkal (ceruza = átnevezés) — képernyőkép. */
async function smokeAlbumSheet(log: Log, setHarness: (n: ReactNode) => void) {
  const base = createEmptyProject('smoke album', '1:1', undefined, 'audio');
  const album = addSong(initAlbum(makeSong('s1', 'Első dal', base.tracks)), makeSong('s2', 'Második, nagyon hosszú című dal a lapon', base.tracks));
  useEditorStore.getState().loadProject({ ...base, album }, []);
  setHarness(<AlbumSheet onClose={() => {}} onShareAlbum={() => {}} />);
  log(true, 'FOTÓZHATÓ', 'az album-lap a szám-sorokkal');
  await sleep(5000);
  setHarness(null);
}

/**
 * ⏩ A gyorsított videóklip hangja leválasztható (lista #21): a valódi parancs-út (egy undo), és a
 * Hang Stúdióban a hangmagasság-tartó, 1,5×-es előnézet szinkronja a szondával.
 */
async function smokeAudioSpeed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = 'prj_smoke_audiospeed';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioSpeed', caught));
  const base = createEmptyProject('smoke gyorsított hang', '16:9', undefined, 'audio');
  const video = { id: 'v', kind: 'video', uri, start: 0, duration: 6, trimIn: 0.5, sourceDuration: 10, speed: 1.5, volume: 1, filterId: 'none' } as VideoClip;
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [video] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const st = () => useEditorStore.getState();
  const voice = () => (st().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const vol = () => (st().project?.tracks.find((t) => t.type === 'video')?.clips[0] as VideoClip | undefined)?.volume;
  log(canDetachAudio(video), 'az 1,5×-es videóklip hangja leválasztható');
  const detach = () => st().applyBatch(detachAudioCommands(video, 'leválasztott', st().project?.links).commands, 'user');
  detach();
  const a = voice()[0];
  log(a?.speed === 1.5 && a.trimIn === 0.5 && a.duration === 6 && vol() === 0, 'a hangklip átvette a sebességet és a vágást, a videó elnémult', a ? `${a.speed}×, trimIn ${a.trimIn}` : 'nincs');
  st().undo();
  log(voice().length === 0 && vol() === 1, 'egy visszavonás mindent visszaállít');
  detach();
  const clipId = voice()[0]?.id ?? '';
  st().setPlayhead(0);
  await sleep(600);
  // 1. kör: a tanulás; 2. kör: a mért szinkron
  st().setPlaying(true);
  await sleep(2500);
  st().setPlaying(false);
  await sleep(500);
  st().setPlayhead(0);
  await sleep(600);
  startSyncProbe();
  st().setPlaying(true);
  await sleep(1500);
  const rate = runDevAction(`audio.nativeRate.${clipId}`) as number | undefined;
  await sleep(3500);
  const head = st().playhead;
  st().setPlaying(false);
  const { samples, seeks } = stopSyncProbe();
  log(Math.abs((rate ?? 0) - 1.5) < 0.01, 'az előnézet 1,5×-en szól (hangmagasság-tartással)', `rate ${rate}`);
  // a szonda forrás-időben mér: idővonal-időre a sebességgel osztva
  for (const [cid, d] of summarizeDrift(samples.filter((x) => x.sinceStart > 2))) {
    log(d.maxMs / 1.5 <= 45, `szinkron beállás után (${cid === clipId ? 'gyorsított hang' : cid})`, `max ${(d.maxMs / 1.5).toFixed(0)} ms idővonal-időben, ${d.n} minta`);
  }
  log(seeks <= 3, 'a lejátszás nem tekereget folyamatosan', `${seeks} korrekció`);
  const tr = samples.filter((x) => x.clipId === clipId);
  log(null, 'nyom gyorsított', tr.filter((_, k) => k % 8 === 0).map((x) => `${x.sinceStart.toFixed(1)}:${((x.drift * 1000) / 1.5).toFixed(0)}`).join(' '));
  log(Math.abs(head - 5) < 0.4, 'a lejátszófej a valós idővel halad', `${head.toFixed(2)} s`);
  router.back();
}

/**
 * ⏩ A gyorsított hang a TELEFONOS exportban (natív, hangmagasság-tartó nyújtás): forrás 2 s
 * 440 Hz + 2 s 880 Hz. Mérve: a hossz, a frekvencia (marad-e a hangmagasság) és a hangváltás
 * ideje (a nyújtó nem késleltet-e) — ugyanazok, mint a szerveres ffmpeg-tesztben.
 */
async function smokeOfflineStretch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.cache, 'smoke_two_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const api = await loadAudioApi();
  const freqAt = (x: Float32Array, from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  /** az első 20 ms-os ablak, ahol a frekvencia 660 Hz fölé megy */
  const switchAt = (x: Float32Array, from: number, to: number) => {
    for (let t = from; t < to; t += 0.005) if (freqAt(x, t, t + 0.02) > 660) return t + 0.01;
    return Number.NaN;
  };
  const run = async (name: string, over: Partial<AudioClip>) => {
    const base = createEmptyProject('smoke nyújtás', '1:1', undefined, 'audio');
    const c: AudioClip = { kind: 'audio', id: 's', uri: src.uri, label: 's', start: 0, duration: 2, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'voiceover', ...over };
    const p: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
    const t0 = Date.now();
    const { uri, unsupported } = await exportOfflineWav(p, new File(projectExportDir(), `${name}.wav`));
    const ms = Date.now() - t0;
    const buf = await api!.decodeAudioData(uri, SR);
    const x = buf.getChannelData(0).slice();
    new File(uri).delete();
    return { x, dur: buf.duration, ms, unsupported };
  };
  for (const sp of [2, 0.5]) {
    const lat = await measureStretchLatency(sp);
    log(null, `nyújtó késése ${sp}×`, `${lat} minta = ${(((lat ?? 0) / SR) * 1000).toFixed(1)} ms`);
  }
  try {
    const fast = await run('smoke_stretch_2x', { start: 0.5, duration: 2, speed: 2 });
    log(fast.unsupported.length === 0, '2×: a telefonos export nem hagyja ki', `${fast.ms} ms`);
    log(Math.abs(fast.dur - 2.5) < 0.01, '2×: a hossz pontos', `${fast.dur.toFixed(3)} s`);
    const f1 = freqAt(fast.x, 0.6, 1.4);
    const f2 = freqAt(fast.x, 1.6, 2.4);
    log(Math.abs(f1 - 440) < 8 && Math.abs(f2 - 880) < 8, '2×: a hangmagasság marad (nem 880 / 1760 Hz)', `${f1.toFixed(0)} Hz → ${f2.toFixed(0)} Hz`);
    const sw = switchAt(fast.x, 1.2, 1.8);
    log(Math.abs(sw - 1.5) < 0.03, '2×: a hangváltás a helyén (a nyújtó nem késleltet)', `${sw.toFixed(3)} s (várt 1,500)`);
    const slow = await run('smoke_stretch_05x', { start: 0, duration: 4, speed: 0.5, trimIn: 1 });
    // forrás 1–3 s: 440 Hz 1 s-ig, váltás a forrás 2 s-ánál = idővonal 2 s
    const s1 = freqAt(slow.x, 0.2, 1.8);
    const s2 = freqAt(slow.x, 2.2, 3.8);
    log(Math.abs(slow.dur - 4) < 0.01 && Math.abs(s1 - 440) < 8 && Math.abs(s2 - 880) < 8, '0,5×: hossz és hangmagasság', `${slow.dur.toFixed(3)} s, ${s1.toFixed(0)} → ${s2.toFixed(0)} Hz`);
    const sw2 = switchAt(slow.x, 1.7, 2.3);
    log(Math.abs(sw2 - 2) < 0.04, '0,5×: a hangváltás a helyén', `${sw2.toFixed(3)} s (várt 2,000)`);
    // 🎚️ hangmagasság +7 félhang (a hossz marad): 440 → 659 Hz, 880 → 1319 Hz, a váltás a helyén
    const up = await run('smoke_pitch_7', { start: 0, duration: 4, audioFx: { pitchSemitones: 7 } });
    const u1 = freqAt(up.x, 0.3, 1.7);
    const u2 = freqAt(up.x, 2.3, 3.7);
    log(up.unsupported.length === 0 && Math.abs(u1 - 659.3) < 8 && Math.abs(u2 - 1318.5) < 12, 'hangmagasság +7: 440 → 659, 880 → 1319 Hz', `${u1.toFixed(0)} → ${u2.toFixed(0)} Hz, ${up.dur.toFixed(3)} s`);
    let usw = Number.NaN;
    for (let t = 1.7; t < 2.3 && Number.isNaN(usw); t += 0.005) if (freqAt(up.x, t, t + 0.02) > 990) usw = t + 0.01;
    log(Math.abs(usw - 2) < 0.04, 'hangmagasság: a váltás a helyén (a nyújtó késése kalibrálva)', `${usw.toFixed(3)} s (várt 2,000)`);
  } finally {
    src.delete();
  }
}

/**
 * ⏩ A natív (iOS) videó-render a gyorsított hangklipet is skálázza: videó (némítva) + 2×-es
 * hangklip (2 s 440 Hz + 2 s 880 Hz forrás) → MP4 a telefonon; a kimenet hangjában a hossz,
 * a hangmagasság és a hangváltás helye.
 */
async function smokeNativeSpeed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const asset = Asset.fromModule(require('../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.cache, 'smoke_native_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const base = createEmptyProject('smoke natív sebesség', '16:9');
  const video = { id: 'v', kind: 'video', uri: asset.localUri ?? asset.uri, start: 0, duration: 4, trimIn: 0, sourceDuration: 10, speed: 1, volume: 0, filterId: 'none' } as VideoClip;
  const voice: AudioClip = { kind: 'audio', id: 'h', uri: src.uri, label: 'h', start: 0.5, duration: 2, trimIn: 0, sourceDuration: 4, speed: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'voiceover' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video] } : t.type === 'voiceover' ? { ...t, clips: [voice] } : t)) };
  const settings: RenderSettings = { resolution: 720, fps: 30, quality: 'medium', codec: 'h264' };
  const local = canRenderLocally(project, settings);
  log(local, 'a gyorsított hangklipes projekt a telefonon renderelhető (az új build jelzi a képességet)');
  if (!local) return;
  const t0 = Date.now();
  const out = await renderLocal(project, settings);
  log(null, 'natív render', `${Date.now() - t0} ms`);
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out.uri, SR);
  const x = buf.getChannelData(0).slice();
  const freqAt = (from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  let sw = Number.NaN;
  for (let t = 1.2; t < 1.8 && Number.isNaN(sw); t += 0.005) if (freqAt(t, t + 0.02) > 660) sw = t + 0.01;
  const f1 = freqAt(0.6, 1.4);
  const f2 = freqAt(1.6, 2.4);
  log(Math.abs(f1 - 440) < 10 && Math.abs(f2 - 880) < 10, 'a hangmagasság marad (nem 880 / 1760 Hz)', `${f1.toFixed(0)} Hz → ${f2.toFixed(0)} Hz`);
  log(Math.abs(sw - 1.5) < 0.04, 'a hangváltás a helyén (2× = a forrás 2 s-a az idővonal 1,5 s-ánál)', `${sw.toFixed(3)} s`);
  log(freqAt(2.6, 3.4) < 50, 'a klip után csend (a hang nem nyúlik túl)', `${freqAt(2.6, 3.4).toFixed(0)} Hz`);
  out.delete();
  src.delete();
}

/**
 * ⏪⏩ Előnézet visszafelé és 3×-en (a lejátszó ezt nem tudja): a telefon előre nyújtott szakaszt
 * készít, és azt játssza 1×-en. Mérve: a szakasz tartalma (frekvencia-sorrend, hossz), a
 * lejátszás szinkronja és hogy vágás után új szakasz készül.
 */
async function smokeAudioReverse(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const tone = Float32Array.from({ length: 4 * SR }, (_, i) => 0.3 * Math.sin((2 * Math.PI * (i < 2 * SR ? 440 : 880) * i) / SR));
  const src = new File(Paths.document, 'smoke_reverse_tones.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([tone], SR, () => 0.5));
  const id = 'prj_smoke_audioreverse';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioReverse', caught));
  const base = createEmptyProject('smoke visszafelé', '9:16', undefined, 'audio');
  const rev: AudioClip = { kind: 'audio', id: 'rev', uri: src.uri, label: 'visszafelé', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, reversed: true, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'voiceover' };
  const fast: AudioClip = { kind: 'audio', id: 'fast', uri: src.uri, label: '3×', start: 0, duration: 4 / 3, trimIn: 0, sourceDuration: 4, speed: 3, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [rev] } : t.type === 'music' ? { ...t, clips: [fast] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  const api = await loadAudioApi();
  const freqAt = (x: Float32Array, from: number, to: number) => {
    let n = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (to - from);
  };
  const waitProxy = async (key: string) => {
    const t0 = Date.now();
    for (let i = 0; i < 100 && !getStretchProxySync(key); i++) await sleep(100);
    return { uri: getStretchProxySync(key), ms: Date.now() - t0 };
  };
  try {
    const rk = stretchProxyKey(src.uri, rev);
    const r = await waitProxy(rk);
    log(!!r.uri, 'visszafelé: az előnézeti szakasz elkészült', `${r.ms} ms`);
    if (r.uri) {
      const b = await api!.decodeAudioData(r.uri, SR);
      const x = b.getChannelData(0).slice();
      log(Math.abs(b.duration - 4) < 0.01 && Math.abs(freqAt(x, 0.2, 1.8) - 880) < 8 && Math.abs(freqAt(x, 2.2, 3.8) - 440) < 8, 'visszafelé: előbb 880, aztán 440 Hz, 4 s', `${b.duration.toFixed(3)} s, ${freqAt(x, 0.2, 1.8).toFixed(0)} → ${freqAt(x, 2.2, 3.8).toFixed(0)} Hz`);
    }
    const fk = stretchProxyKey(src.uri, fast);
    const f = await waitProxy(fk);
    if (f.uri) {
      const b = await api!.decodeAudioData(f.uri, SR);
      const x = b.getChannelData(0).slice();
      log(Math.abs(b.duration - 4 / 3) < 0.01 && Math.abs(freqAt(x, 0.05, 0.6) - 440) < 10 && Math.abs(freqAt(x, 0.75, 1.3) - 880) < 10, '3×: a hangmagasság marad, 1,33 s', `${b.duration.toFixed(3)} s, ${freqAt(x, 0.05, 0.6).toFixed(0)} → ${freqAt(x, 0.75, 1.3).toFixed(0)} Hz`);
    } else {
      log(false, '3×: az előnézeti szakasz elkészült');
    }
    // lejátszás: a kész szakasz 1×-en, szinkronban
    const st = useEditorStore.getState;
    st().setPlayhead(0);
    st().setPlaying(true);
    await sleep(2000);
    st().setPlaying(false);
    await sleep(500);
    st().setPlayhead(0);
    await sleep(600);
    startSyncProbe();
    st().setPlaying(true);
    await sleep(1000);
    const rate = runDevAction('audio.nativeRate.rev') as number | undefined;
    const playing = runDevAction('audio.nativePlaying.rev') === true;
    await sleep(2800);
    st().setPlaying(false);
    const { samples } = stopSyncProbe();
    log(playing && rate === 1, 'visszafelé: a szakasz 1×-en szól', `rate ${rate}`);
    for (const [cid, d] of summarizeDrift(samples.filter((x) => x.sinceStart > 2 && x.clipId === 'rev'))) {
      log(d.maxMs <= 45, `szinkron beállás után (${cid})`, `max ${d.maxMs.toFixed(0)} ms, ${d.n} minta`);
    }
    const trace = samples.filter((x) => x.clipId === 'rev');
    log(null, 'nyom rev', trace.filter((_, k) => k % 6 === 0).map((x) => `${x.sinceStart.toFixed(1)}:${(x.drift * 1000).toFixed(0)}`).join(' '));
    // vágás után új szakasz (a jobb él a forrás eleje: a trimIn mozdul); a lejátszó csak a
    // lejátszófej környéki klipet tölti be — a fej a klipen álljon
    st().setPlayhead(0.5);
    st().updateClip('rev', trimAudioRight(rev, 3));
    const cut = st().project?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip;
    const nk = stretchProxyKey(src.uri, cut);
    const n = await waitProxy(nk);
    log(nk !== rk && !!n.uri && cut.trimIn === 1, 'vágás után új szakasz készül (a trimIn a forrás eleje felől mozdult)', `trimIn ${cut.trimIn}, ${n.ms} ms`);
  } finally {
    router.back();
    src.delete();
  }
}

/**
 * 🎛️ Hangmotor-próba (#6/#7): a react-native-audio-api (natív Web Audio) gráfja. Offline:
 * a StereoPanner és a BiquadFilter mintapontos hatása (L/R szint, szűrés). Valós időben: a gráf
 * szól (analyser) és az órája a falióra szerint halad (master-órának alkalmas-e).
 */
async function smokeEngineSpike(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const api = await loadAudioApi();
  if (!api) {
    log(false, 'react-native-audio-api elérhető');
    return;
  }
  const SR = 44100;
  const rms = (x: Float32Array) => 10 * Math.log10(x.reduce((a, v) => a + v * v, 0) / x.length + 1e-30);
  const A = api;
  type Off = InstanceType<typeof A.OfflineAudioContext>;
  const render = async (build: (ctx: Off, src: AudioNode) => AudioNode, freq: number) => {
    const ctx = new A.OfflineAudioContext({ numberOfChannels: 2, length: SR, sampleRate: SR });
    const buf = ctx.createBuffer(2, SR, SR);
    const tone = Float32Array.from({ length: SR }, (_, i) => 0.5 * Math.sin((2 * Math.PI * freq * i) / SR));
    buf.copyToChannel(tone, 0);
    buf.copyToChannel(tone, 1);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    build(ctx, node as unknown as AudioNode).connect(ctx.destination);
    node.start(0);
    const out = await ctx.startRendering();
    return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
  };
  type AudioNode = { connect: (n: unknown) => AudioNode };
  // pan
  for (const pan of [-1, -0.5, 0, 1]) {
    const [l, r] = await render((ctx, src) => {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      return src.connect(p);
    }, 440);
    log(null, `pan ${pan}`, `L ${rms(l).toFixed(1)} dB · R ${rms(r).toFixed(1)} dB`);
  }
  const [hl, hr] = await render((ctx, src) => { const p = ctx.createStereoPanner(); p.pan.value = -1; return src.connect(p); }, 440);
  log(rms(hl) > -10 && rms(hr) < -60, 'pan −1: a hang csak balra szól', `L ${rms(hl).toFixed(1)} · R ${rms(hr).toFixed(1)} dB`);
  // EQ: 5 kHz-es hang 500 Hz-es aluláteresztőn
  const [dry] = await render((_ctx, src) => src, 5000);
  const [wet] = await render((ctx, src) => { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; return src.connect(f); }, 5000);
  log(rms(dry) - rms(wet) > 30, 'EQ (biquad): az 500 Hz-es aluláteresztő az 5 kHz-et elnyomja', `${(rms(dry) - rms(wet)).toFixed(1)} dB`);
  // valós idő: szól + óra
  const ctx = new api.AudioContext({ sampleRate: SR });
  const buf = ctx.createBuffer(2, SR * 4, SR);
  const tone = Float32Array.from({ length: SR * 4 }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 440 * i) / SR));
  buf.copyToChannel(tone, 0);
  buf.copyToChannel(tone, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const pan = ctx.createStereoPanner();
  pan.pan.value = 0.6;
  const an = ctx.createAnalyser();
  src.connect(pan);
  pan.connect(an);
  an.connect(ctx.destination);
  await ctx.resume();
  src.start(ctx.currentTime + 0.05);
  const c0 = ctx.currentTime;
  const w0 = Date.now();
  await sleep(600);
  const td = new Float32Array(an.fftSize);
  an.getFloatTimeDomainData(td);
  log(rms(td) > -40, 'valós idő: a gráf szól (analyser a pan után)', `${rms(td).toFixed(1)} dB`);
  await sleep(2400);
  const dc = ctx.currentTime - c0;
  const dw = (Date.now() - w0) / 1000;
  log(Math.abs(dc - dw) < 0.03, 'valós idő: a hangóra a falióra szerint halad', `hang ${dc.toFixed(3)} s · fal ${dw.toFixed(3)} s`);
  src.stop();
  await ctx.close();
}

/**
 * 🎧 Előre renderelt előnézet (az exporttal azonos keverés): 3 sáv, pan, fade — a szeletek
 * rés nélkül, időben ütemeződnek; a lejátszófej a hangórával halad; a futás közbeni
 * szerkesztés (pan-váltás) a még el nem indult szeleteket cseréli.
 */
async function smokePreviewEngine(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_engine.wav', 12);
  const base = createEmptyProject('smoke motor', '9:16', undefined, 'audio');
  const mk = (id: string, start: number, pan: number): AudioClip => ({ kind: 'audio', id, uri, label: id, start, duration: 8, trimIn: 0, sourceDuration: 12, volume: 0.3, fadeIn: 0.2, fadeOut: 0.3, pan, source: 'imported' });
  const project = (pan: number): Project => ({ ...base, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('a', 0, pan)] } : t.type === 'sfx' ? { ...t, clips: [mk('b', 1, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('c', 2, 0)] } : t)) });
  const t0 = Date.now();
  await previewEngine.setPlan(offlineMixPlan(project(-1)));
  log(null, 'terv + dekódolás', `${Date.now() - t0} ms`);
  previewEngine.takeStats();
  const w0 = Date.now();
  await previewEngine.play(0.5);
  await sleep(1500);
  const p1 = previewEngine.position();
  const w1 = (Date.now() - w0) / 1000;
  // futás közbeni szerkesztés: a pan átvált
  const e0 = Date.now();
  await previewEngine.setPlan(offlineMixPlan(project(1)));
  const editMs = Date.now() - e0;
  await sleep(2500);
  const p2 = previewEngine.position();
  const w2 = (Date.now() - w0) / 1000;
  previewEngine.pause();
  const st = previewEngine.takeStats();
  log(st.late === 0, 'a szeletek rés nélkül, időben szólnak', `${st.chunks} szelet, ${st.late} késett, legkisebb előny ${st.minLeadMs.toFixed(0)} ms`);
  // a két mérés közti haladás (az indítás ideje — a hangmotor ébresztése — kiesik)
  log(Math.abs(p2 - p1 - (w2 - w1)) < 0.03, 'a lejátszófej a hangórával halad (nincs elcsúszás)', `${(p2 - p1).toFixed(3)} s hang · ${(w2 - w1).toFixed(3)} s fal`);
  log(st.replaced > 0 && st.replaced <= 8, 'a szerkesztés csak a még el nem indult szeleteket cseréli', `${st.replaced} szelet, az új terv ${editMs} ms alatt`);
  await sleep(300);
  log(Math.abs(previewEngine.position() - p2) < 0.01, 'szünetnél a lejátszófej megáll', `${previewEngine.position().toFixed(3)} s`);
  new File(uri).delete();
}

/** 🎧 A Hang Stúdió az előre renderelt motorról szól: óra, némítás és ugrás futás közben, megszakítás. */
async function smokeEngineStudio(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_enginestudio';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:engineStudio', caught));
  const uri = toneWav('smoke_enginestudio.wav', 20);
  const base = createEmptyProject('smoke motor-stúdió', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number, pan: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, pan, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.8)] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 1, 0.8)] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = useEditorStore.getState;
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(800);
  {
    const proj = st().project;
    const plan = proj ? offlineMixPlan(proj) : null;
    log(null, 'motor-állapot', `armed ${previewEngine.clock() !== null}, playing ${previewEngine.isPlaying()}, unsupported [${plan?.unsupported.join(',')}], uris ${plan?.clips.map((c) => c.uri.slice(0, 12)).join(' ')}`);
  }
  log(previewEngine.isPlaying() && st().videoVoiceActive, 'a stúdió az előre renderelt motorról szól');
  const h1 = st().playhead;
  const w1 = Date.now();
  await sleep(2000);
  const h2 = st().playhead;
  const w2 = Date.now();
  log(Math.abs(h2 - h1 - (w2 - w1) / 1000) < 0.05, 'a lejátszófej a hangórával halad', `${(h2 - h1).toFixed(3)} s fej · ${((w2 - w1) / 1000).toFixed(3)} s fal`);
  // némítás futás közben → az exporttal azonos terv, a még el nem indult szeletek cserélődnek
  st().toggleTrackFlag('sfx', 'mute');
  await sleep(500);
  // ugrás futás közben
  st().setPlayhead(8);
  await sleep(400);
  log(Math.abs(previewEngine.position() - st().playhead) < 0.05 && st().playhead > 8 && st().playhead < 8.6, 'ugrás futás közben: a motor onnan folytatja', `fej ${st().playhead.toFixed(2)} · motor ${previewEngine.position().toFixed(2)}`);
  const stats = previewEngine.takeStats();
  log(stats.late === 0, 'rés nélkül szólt (némítás és ugrás közben is)', `${stats.chunks} szelet, ${stats.late} késett, ${stats.replaced} cserélve, legkisebb előny ${stats.minLeadMs.toFixed(0)} ms`);
  // rendszer-megszakítás (a hangmotor felfüggesztése, mint híváskor)
  await previewEngine.debugSuspend();
  await sleep(300);
  log(!st().isPlaying && !previewEngine.isPlaying(), 'hívás / Siri: a felfüggesztett motorral a transzport megáll');
  st().setPlaying(true);
  await sleep(1000);
  log(previewEngine.isPlaying() && st().isPlaying, 'újraindítva ismét szól');
  st().setPlaying(false);
  st().toggleTrackFlag('sfx', 'mute');
  // 🎙️ rájátszás: felvétel indul, közben a motor játssza a többi sávot
  const perm = await getRecordingPermissionsAsync();
  if (perm.granted) {
    const voice = () => (st().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
    const h = await new Promise<RecordHandle>((resolve) => setHarness(<RecordHarness onReady={resolve} start={() => st().playhead} />));
    st().setPlayhead(2);
    await startVoiceRecording(h.recorder);
    st().setPlaying(true);
    await sleep(2000);
    const h1 = st().playhead;
    log(previewEngine.isPlaying() && h.recorder.getStatus().isRecording && h1 > 3.5, 'rájátszás: felvétel közben a motor szól és halad', `fej ${h1.toFixed(2)} s`);
    st().setPlaying(false);
    await h.finish.current();
    const v = voice()[0];
    log(!!v && v.duration > 1.5, 'rájátszás: a felvétel klip lett', v ? `${v.duration.toFixed(2)} s` : 'nincs');
    setHarness(null);
    // előbb a klip kerül ki a projektből, csak utána a fájl (különben a hullámforma a hiányzót keresi)
    const files = voice().map((c) => c.uri);
    for (const c of voice()) st().removeClip(c.id);
    await sleep(300);
    for (const f of files) new File(f).delete();
  }
  router.back();
}

/** 🎛️ Szűrők + EQ a közös DSP-ben: a telefonos export = a szerveres (ffmpeg) export, kivonva. */
async function smokeOfflineFx(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  const noiseL = Float32Array.from({ length: 4 * SR }, () => 0.25 * rnd());
  const noiseR = Float32Array.from({ length: 4 * SR }, () => 0.25 * rnd());
  const src = new File(Paths.document, 'smoke_fx_noise.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([noiseL, noiseR], SR, () => 0.5));
  const base = createEmptyProject('smoke fx', '1:1', undefined, 'audio');
  const fx = { highpass: 200, lowpass: 6000, eq: { low: 4, mid: -3, high: 5 } };
  const c: AudioClip = { kind: 'audio', id: 'fx', uri: src.uri, label: 'fx', start: 0.25, duration: 3, trimIn: 0.2, sourceDuration: 4, volume: 0.8, fadeIn: 0.2, fadeOut: 0.3, pan: 0.3, audioFx: fx, source: 'imported' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  log(offlineMixPlan(project).unsupported.length === 0, 'a szűrős-EQ-s projekt az előnézeti motorról és a telefonos exporttal szól');
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_fx_phone.wav'));
  log(null, 'telefonos export', `${Date.now() - t0} ms`);
  const serverFile = new File(projectExportDir(), 'smoke_fx_server.wav');
  await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 44100, channels: 2 }), serverFile);
  const api = await loadAudioApi();
  const mine = await api!.decodeAudioData(out, SR);
  const theirs = await api!.decodeAudioData(serverFile.uri, SR);
  const db = (xs: Float32Array) => 10 * Math.log10(xs.reduce((a, v) => a + v * v, 0) / Math.max(1, xs.length) + 1e-30);
  for (const ch of [0, 1]) {
    const a = mine.getChannelData(ch);
    const b = theirs.getChannelData(ch);
    const n = Math.min(a.length, b.length);
    const diff = Float32Array.from({ length: n }, (_, i) => a[i] - b[i]);
    const snr = db(b.subarray(0, n)) - db(diff);
    log(snr > 60, `szűrők + EQ: telefon = szerver (${ch === 0 ? 'bal' : 'jobb'})`, `${snr.toFixed(1)} dB a jel alatt, hossz ${a.length}/${b.length}`);
  }
  new File(out).delete();
  serverFile.delete();
  src.delete();
}

/** 🗜️ Három sáv, mindegyiken a teljes támogatott effekt-lánc: a motor valós időben, akadás nélkül. */
async function smokeEngineFx(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_enginefx';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:engineFx', caught));
  const uri = toneWav('smoke_enginefx.wav', 20);
  const fx = { highpass: 90, lowpass: 12000, eq: { low: 3, mid: -2, high: 2 }, gate: true, deEsser: true, compressor: true, reverb: 0.5, delay: 0.4, stereoWide: true, limiter: true };
  const base = createEmptyProject('smoke motor-fx', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number, pan: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, pan, audioFx: fx, source: 'imported' });
  const project: Project = { ...base, id, audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: -1, high: 1.5 }, multiband: true }, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.5)] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 0.5, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('v', 1, 0)] } : t)) };
  const plan = offlineMixPlan(project);
  log(plan.unsupported.length === 0, 'a teljes támogatott lánc a motorral szól (nem a régi úton)', `[${plan.unsupported.join(',')}]`);
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = useEditorStore.getState;
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(5000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.late === 0 && stats.minLeadMs > 20, 'valós időben, akadás nélkül (3 sáv × teljes lánc)', `${stats.chunks} szelet, ${stats.late} késett, legkisebb előny ${stats.minLeadMs.toFixed(0)} ms, késések: ${stats.lateAt.join(',')} ms, indulás ${stats.startMs} ms, keverés ${(stats.mixMs / Math.max(1, stats.chunks)).toFixed(0)} ms/szelet (max ${stats.maxMixMs}) — a szelet 125 ms`);
  router.back();
}

/** 🎚️ Próba: a natív nyújtó `detune`-ja hangmagasság-tartással (pitch eltolás, hossz marad?). */
async function smokePitchSpike(log: Log) {
  const api = await loadAudioApi();
  const SR = 44100;
  const tone = Float32Array.from({ length: 2 * SR }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 440 * i) / SR));
  const freq = (x: Float32Array, a: number, b: number) => {
    let n = 0;
    for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
    return n / 2 / (b - a);
  };
  for (const cents of [1200, 700, -500]) {
    const ctx = new api!.OfflineAudioContext({ numberOfChannels: 1, length: 2 * SR, sampleRate: SR });
    const buf = ctx.createBuffer(1, 2 * SR, SR);
    buf.copyToChannel(tone, 0);
    const node = ctx.createBufferSource({ pitchCorrection: true });
    node.buffer = buf;
    node.detune.value = cents;
    node.connect(ctx.destination);
    node.start(0);
    const out = (await ctx.startRendering()).getChannelData(0).slice();
    const want = 440 * Math.pow(2, cents / 1200);
    const f = freq(out, 0.3, 1.7);
    let lastLoud = 0;
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i]) > 0.05) lastLoud = i;
    log(Math.abs(f - want) < 6, `detune ${cents} cent: ${want.toFixed(0)} Hz várt`, `${f.toFixed(1)} Hz, hang vége ${(lastLoud / SR).toFixed(3)} s`);
  }
}

/** 🧹📏 Zajszűrés + normalizálás a telefonon: 60 mp-es zajos klip — idő, hatás és a −16 LUFS. */
async function smokeDenoise(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // valódi fehér zaj (mulberry32; a túlcsorduló LCG rövid ciklusba ragadhat)
  let a = 5;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const n = 60 * SR;
  // 0,5 s hang / 0,5 s szünet, végig halk zaj
  const x = Float32Array.from({ length: n }, (_, i) => (Math.floor(i / (SR / 2)) % 2 === 0 ? 0.05 * Math.sin((2 * Math.PI * 330 * i) / SR) : 0) + 0.005 * rnd());
  const src = new File(Paths.document, 'smoke_denoise.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const base = createEmptyProject('smoke zajszűrés', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'dn', uri: src.uri, label: 'dn', start: 0, duration: 60, trimIn: 0, sourceDuration: 60, volume: 1, fadeIn: 0, fadeOut: 0, audioFx: { denoise: true, normalize: true }, source: 'voiceover' };
  const project: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) };
  log(offlineMixPlan(project).unsupported.length === 0, 'zajszűrés + normalizálás a közös DSP-ben (nem a régi úton)');
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_denoise_out.wav'));
  const ms = Date.now() - t0;
  log(ms < 40000, '60 mp zajszűrése + normalizálása a telefonon', `${(ms / 1000).toFixed(1)} s (${((ms / 60000) * 1000).toFixed(0)} ms / hang-mp)`);
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out, SR);
  const l = buf.getChannelData(0).slice();
  const r = buf.getChannelData(1).slice();
  const lufs = integratedLoudness(l, r, SR);
  log(Math.abs(lufs - -16) < 1, 'a kimenet −16 LUFS', `${lufs.toFixed(2)} LUFS`);
  const gapDb = (y: Float32Array, scale: number) => {
    let s = 0;
    let k = 0;
    for (let i = Math.round(10.6 * SR); i < Math.round(10.9 * SR); i++) {
      s += (y[i] / scale) ** 2;
      k++;
    }
    return 10 * Math.log10(s / k + 1e-30);
  };
  // a normalizálás erősítését kivéve: a szünetben a zaj a bemenethez képest
  const gain = Math.pow(10, (lufs - integratedLoudness(x, x, SR)) / 20);
  log(gapDb(l, gain) - gapDb(x, 1) < -8, 'a szünetekben a zaj legalább 8 dB-lel csökkent', `${(gapDb(l, gain) - gapDb(x, 1)).toFixed(1)} dB`);
  new File(out).delete();
  // 🎙️ hangjavítás + visszhang-csökkentés (egygombos csomagok) ugyanezen a jelen, 20 mp
  const c2: AudioClip = { ...c, id: 've', duration: 20, audioFx: undefined, voiceEnhance: true, deReverb: true };
  const p2: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c2] } : t)) };
  log(offlineMixPlan(p2).unsupported.length === 0, 'hangjavítás + visszhang-csökkentés a közös DSP-ben');
  const t1 = Date.now();
  const { uri: out2 } = await exportOfflineWav(p2, new File(projectExportDir(), 'smoke_voice_out.wav'));
  const b2 = await api!.decodeAudioData(out2, SR);
  const l2 = b2.getChannelData(0).slice();
  const lufs2 = integratedLoudness(l2, b2.getChannelData(1).slice(), SR);
  const g2 = Math.pow(10, (lufs2 - integratedLoudness(x.subarray(0, 20 * SR), x.subarray(0, 20 * SR), SR)) / 20);
  log(Math.abs(lufs2 - -16) < 1 && gapDb(l2, g2) - gapDb(x, 1) < -8, 'hangjavítás: −16 LUFS, a szünetekben kevesebb zaj', `${lufs2.toFixed(2)} LUFS, zaj ${(gapDb(l2, g2) - gapDb(x, 1)).toFixed(1)} dB, ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  new File(out2).delete();
  src.delete();
}

/**
 * 🎧 Pro szerveres export = a telefon keverése: dinamika-effektes, masteres projekt — a szerverre
 * a telefon kész keverése megy fel; a letöltött 24 bites fájl = a telefonos keverés (kivonva).
 */
async function smokeProExport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let a = 3;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const x = Float32Array.from({ length: 4 * SR }, (_, i) => 0.3 * rnd() * (i % 22050 < 11025 ? 1 : 0.2));
  const src = new File(Paths.document, 'smoke_pro_src.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const base = createEmptyProject('smoke pro export', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'p', uri: src.uri, label: 'p', start: 0.2, duration: 3.5, trimIn: 0.1, sourceDuration: 4, volume: 0.8, fadeIn: 0.1, fadeOut: 0.2, pan: -0.3, audioFx: { compressor: true, reverb: 0.4, deEsser: true }, source: 'imported' };
  const project: Project = { ...base, audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', multiband: true }, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  // a telefon saját keverése (referencia)
  const phone = new File(projectExportDir(), 'smoke_pro_phone.wav');
  await exportOfflineWav(project, phone, undefined, undefined, 'float32');
  // a Pro szerveres export (24 bit) — a feltöltött keverésből
  const server = new File(projectExportDir(), 'smoke_pro_server.wav');
  const t0 = Date.now();
  await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 44100, channels: 2 }), server);
  log(null, 'Pro export', `${Date.now() - t0} ms`);
  const api = await loadAudioApi();
  const mine = await api!.decodeAudioData(phone.uri, SR);
  const theirs = await api!.decodeAudioData(server.uri, SR);
  const db = (xs: Float32Array) => 10 * Math.log10(xs.reduce((acc, v) => acc + v * v, 0) / Math.max(1, xs.length) + 1e-30);
  for (const ch of [0, 1]) {
    const m = mine.getChannelData(ch);
    const t = theirs.getChannelData(ch);
    const n = Math.min(m.length, t.length);
    const diff = Float32Array.from({ length: n }, (_, i) => m[i] - t[i]);
    const snr = db(t.subarray(0, n)) - db(diff);
    log(snr > 80, `Pro szerveres export = telefonos keverés (${ch === 0 ? 'bal' : 'jobb'})`, `${snr.toFixed(1)} dB a jel alatt, hossz ${m.length}/${t.length}`);
  }
  phone.delete();
  server.delete();
  src.delete();
}

/**
 * 🎧 20 percnél hosszabb forrás: 25 perces fájl, szakaszos (natív ablak-) dekódolással — a minták
 * a helyükön (szakaszhatáron is), a motor a 22. percnél akadás nélkül szól ≤ 8 szakasszal, és a
 * telefonos export a fájl végéről is pontos.
 */
async function smokeLongSource(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const SEC = 25 * 60;
  // a frekvencia 20 mp-enként lép: f(k) = 200 + 7k Hz — a minta értéke a helyéből számolható
  const value = (i: number) => {
    const k = Math.floor(i / (20 * SR));
    return 0.3 * Math.sin((2 * Math.PI * (200 + 7 * k) * i) / SR);
  };
  const src = new File(Paths.document, 'smoke_long_25min.wav');
  const t0 = Date.now();
  if (!src.exists) {
    src.create();
    const h = src.open();
    h.writeBytes(wavHeader16(SEC * SR, 1, SR));
    const CH = SR * 10;
    for (let a = 0; a < SEC * SR; a += CH) {
      const n = Math.min(CH, SEC * SR - a);
      const buf = new Int16Array(n);
      for (let i = 0; i < n; i++) buf[i] = Math.round(value(a + i) * 32767);
      h.writeBytes(new Uint8Array(buf.buffer));
    }
    h.close();
  }
  log(null, '25 perces forrás', `${((src.size ?? 0) / 1048576).toFixed(0)} MB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(canSegment(), 'a build szakaszosan dekódol (natív ablak)');
  const long = new LongSource(src.uri);
  const check = async (fromSec: number, sec: number) => {
    const a = Math.round(fromSec * SR);
    const b = a + Math.round(sec * SR);
    const t1 = Date.now();
    await long.ensure(a, b);
    const ms = Date.now() - t1;
    const w = long.read(a, b);
    let max = 0;
    for (let i = 0; i < b - a; i++) max = Math.max(max, Math.abs((w?.[0][i] ?? 9) - value(a + i)));
    return { max, ms };
  };
  const edge = await check(39.9, 0.2);
  log(edge.max < 1e-4, 'a szakaszhatáron (40 s) a minták a helyükön', `max eltérés ${edge.max.toExponential(1)}, ${edge.ms} ms`);
  const far = await check(22 * 60 - 0.5, 1);
  log(far.max < 1e-4, 'a 22. percnél a minták a helyükön (szakaszhatár is)', `max eltérés ${far.max.toExponential(1)}, ${far.ms} ms`);
  log(long.loaded() <= 8, 'a memóriában legfeljebb 8 szakasz', `${long.loaded()} szakasz`);
  // a motor a 22. percnél (a teljes 25 perces klip a projektben)
  const id = 'prj_smoke_long';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:long', caught));
  const base = createEmptyProject('smoke hosszú forrás', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'L', uri: src.uri, label: 'podcast', start: 0, duration: SEC, trimIn: 0, sourceDuration: SEC, volume: 0.5, fadeIn: 0, fadeOut: 0, audioFx: { highpass: 80, compressor: true }, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = useEditorStore.getState;
  st().setPlayhead(22 * 60 - 2);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(4500);
  const head = st().playhead;
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(previewEngine.clock() !== null, 'a hosszú forrású projekt az előre renderelt motorról szól');
  // a mérce a 1320 s-os szakaszhatár átlépése akadás nélkül (az indulás eszközönként eltér: az emulátoron ~0,5 s)
  log(stats.late === 0 && head > 22 * 60 + 1, 'a 22. percnél akadás nélkül, a szakaszhatáron át', `${stats.chunks} szelet, ${stats.late} késett (${stats.lateAt.join(',')} ms-nál), indulás ${stats.startMs} ms, fej ${head.toFixed(1)} s`);
  log(previewEngine.loadedSegments().every((n) => n <= 8), 'a motor memóriájában legfeljebb 8 szakasz', previewEngine.loadedSegments().join(','));
  router.back();
  // telefonos export a fájl végéről (2 perces részlet a 21. perctől)
  const ep: Project = { ...base, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [{ ...c, start: 0, duration: 120, trimIn: 21 * 60 }] } : t)) };
  const t2 = Date.now();
  const { uri: out } = await exportOfflineWav(ep, new File(projectExportDir(), 'smoke_long_out.wav'), undefined, undefined, 'float32');
  const api = await loadAudioApi();
  const buf = await api!.decodeAudioData(out, SR);
  const x = buf.getChannelData(0);
  // a kimenet a 21. perctől: a magas-áteresztő miatt a hangnem (frekvencia) a mérce
  const freq = (y: Float32Array, a: number, b: number) => {
    let n = 0;
    for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) if ((y[i - 1] < 0) !== (y[i] < 0)) n++;
    return n / 2 / (b - a);
  };
  const want1 = 200 + 7 * Math.floor((21 * 60 + 5) / 20);
  const want2 = 200 + 7 * Math.floor((21 * 60 + 65) / 20);
  log(Math.abs(buf.duration - 120) < 0.01 && Math.abs(freq(x, 5, 6) - want1) < 2 && Math.abs(freq(x, 65, 66) - want2) < 2, 'telefonos export a 21. perctől: hossz és hangmagasság pontos', `${buf.duration.toFixed(2)} s, ${freq(x, 5, 6).toFixed(1)}/${want1} Hz, ${freq(x, 65, 66).toFixed(1)}/${want2} Hz, ${((Date.now() - t2) / 1000).toFixed(1)} s`);
  new File(out).delete();
}

/** ✖️ Automatikus crossfade: átfedő klipek — a szint folytonos (telefonos export), X a sávon. */
async function smokeCrossfade(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const uri = toneWav('smoke_xfade.wav', 8);
  const id = 'prj_smoke_crossfade';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:crossfade', caught));
  const base = createEmptyProject('smoke crossfade', '9:16', undefined, 'audio');
  // ugyanaz a hang folytatódik: a második klip forrása ott kezdődik, ahol az idővonalon belép
  const a: AudioClip = { kind: 'audio', id: 'xa', uri, label: 'A', start: 0, duration: 4, trimIn: 0, sourceDuration: 8, volume: 0.6, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const b: AudioClip = { ...a, id: 'xb', label: 'B', start: 3, duration: 4, trimIn: 3 };
  const project: Project = { ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [a, b] } : t)) };
  const plan = offlineMixPlan(project);
  log(Math.abs((plan.clips.find((c) => c.id === 'xa')?.fadeOut ?? 0) - 1) < 1e-6 && Math.abs((plan.clips.find((c) => c.id === 'xb')?.fadeIn ?? 0) - 1) < 1e-6, 'az 1 s-os átfedés crossfade lett (A ki, B be)');
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_xfade.wav'));
  const api = await loadAudioApi();
  const x = (await api!.decodeAudioData(out, SR)).getChannelData(0);
  const db = (from: number, to: number) => {
    let acc = 0;
    for (let i = Math.round(from * SR); i < Math.round(to * SR); i++) acc += x[i] * x[i];
    return 10 * Math.log10(acc / ((to - from) * SR) + 1e-30);
  };
  const before = db(2.0, 2.8);
  const levels = [3.1, 3.4, 3.7].map((t) => db(t, t + 0.1) - before);
  const after = db(4.2, 5.0) - before;
  log(levels.every((d) => Math.abs(d) < 0.5) && Math.abs(after) < 0.5, 'a szint az átfedésen át folytonos (nincs lyuk, nincs dupla hangerő)', `${levels.map((d) => d.toFixed(2)).join(' / ')} dB, utána ${after.toFixed(2)} dB`);
  new File(out).delete();
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  useEditorStore.getState().setPlayhead(2);
  log(true, 'FOTÓZHATÓ', 'a crossfade X-e a zene sávon (3–4 s)');
  await sleep(4000);
  router.back();
}

/** 🅰️🅱️ A/B: lejátszás közben eredeti ↔ feldolgozott (zajszűrés + normalizálás) — gyors, akadás nélkül. */
async function smokeAbCompare(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let a = 11;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const x = Float32Array.from({ length: 12 * SR }, (_, i) => (Math.floor(i / (SR / 2)) % 2 === 0 ? 0.05 * Math.sin((2 * Math.PI * 330 * i) / SR) : 0) + 0.005 * rnd());
  const src = new File(Paths.document, 'smoke_ab.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_ab';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:ab', caught));
  const base = createEmptyProject('smoke A/B', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'ab', uri: src.uri, label: 'beszéd', start: 0, duration: 12, trimIn: 0, sourceDuration: 12, volume: 1, fadeIn: 0, fadeOut: 0, audioFx: { denoise: true, normalize: true }, source: 'voiceover' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [c] } : t)) });
  const st = useEditorStore.getState;
  st().setFxBypass(false);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  // az első terv a zajszűréssel (előmenet)
  for (let i = 0; i < 100 && previewEngine.lastPlanMs === 0; i++) await sleep(100);
  await sleep(6000);
  const first = previewEngine.lastPlanMs;
  log(null, 'első terv (zajszűrés + normalizálás)', `${first} ms`);
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(1500);
  st().setFxBypass(true);
  await sleep(1200);
  const toOriginal = previewEngine.lastPlanMs;
  st().setFxBypass(false);
  await sleep(1200);
  const back = previewEngine.lastPlanMs;
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(toOriginal < 300, 'A/B: az eredetire váltás gyors', `${toOriginal} ms`);
  log(back < 300, 'A/B: a visszaváltás nem számolja újra a zajszűrést', `${back} ms (az első ${first} ms volt)`);
  log(stats.late === 0 && stats.replaced > 0, 'a váltások lejátszás közben, akadás nélkül', `${stats.chunks} szelet, ${stats.late} késett, ${stats.replaced} cserélve`);
  router.back();
  src.delete();
}

/** 🔖 Markerek a Hang Stúdióban: a gomb a lejátszófejnél, undo, a közös projektben; képernyőkép. */
async function smokeAudioMarkers(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_markers.wav', 12);
  const id = 'prj_smoke_markers';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:markers', caught));
  const base = createEmptyProject('smoke markerek', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'mk', uri, label: 'dal', start: 0, duration: 12, trimIn: 0, sourceDuration: 12, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().setPlayhead(2);
  runDevAction('audio.marker');
  await sleep(200);
  const m1 = st().project?.markers ?? [];
  log(m1.length === 1 && Math.abs(m1[0].time - 2) < 1e-6, 'a Marker gomb a lejátszófejnél jelöl', m1.map((m) => `${m.label}@${m.time}`).join(', '));
  st().undo();
  log((st().project?.markers ?? []).length === 0, 'a marker visszavonható (parancs-busz)');
  st().redo();
  st().setPlayhead(6);
  runDevAction('audio.marker');
  st().setPlayhead(9.5);
  runDevAction('audio.marker');
  // zenei szakasz-címke (ugyanaz, amit a hosszan nyomás menüje állít)
  const list = st().project?.markers ?? [];
  st().dispatch({ type: 'SET_MARKERS', markers: list.map((m, i) => (i === 1 ? { ...m, label: 'Refrén', color: '#f472b6' } : m)) });
  await sleep(300);
  log((st().project?.markers ?? []).length === 3, 'több marker, időrendben', (st().project?.markers ?? []).map((m) => `${m.label}@${m.time}`).join(', '));
  log(true, 'FOTÓZHATÓ', 'markerek a vonalzón (2 s, Refrén 6 s, 9,5 s)');
  await sleep(4000);
  router.back();
}

/** 🎛️ Effekt-automáció: aluláteresztő-söprés a telefonos exportban és a motorban (valós időben). */
async function smokeFxAutomation(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let a = 21;
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
  const noise = Float32Array.from({ length: 6 * SR }, () => 0.3 * rnd());
  const src = new File(Paths.document, 'smoke_sweep.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([noise, noise], SR, () => 0.5));
  const id = 'prj_smoke_sweep';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sweep', caught));
  const base = createEmptyProject('smoke söprés', '9:16', undefined, 'audio');
  const sweep = [{ time: 0, value: 20000, easing: 'linear' as const }, { time: 6, value: 300, easing: 'linear' as const }];
  const c: AudioClip = { kind: 'audio', id: 'sw', uri: src.uri, label: 'söprés', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 0.6, fadeIn: 0, fadeOut: 0, keyframes: { fxLowpass: sweep, fxReverb: [{ time: 0, value: 0, easing: 'linear' }, { time: 6, value: 1, easing: 'linear' }] }, source: 'imported' };
  const project: Project = { ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_sweep_out.wav'));
  const api = await loadAudioApi();
  const y = (await api!.decodeAudioData(out, SR)).getChannelData(0);
  const hf = (from: number, to: number) => {
    let e = 0;
    for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) e += (y[i] - y[i - 1]) ** 2;
    return 10 * Math.log10(e / ((to - from) * SR) + 1e-30);
  };
  const drop = hf(0.2, 0.7) - hf(5.2, 5.7);
  // az 5,2–5,7 s-os ablakban a söprés kb. 2 kHz-nél jár (300 Hz-et 6 s-nál éri el), és nő a zengés is
  log(drop > 15, 'telefonos export: a szűrő-söprés a magas tartományt elnyomja', `${drop.toFixed(1)} dB`);
  new File(out).delete();
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const st = useEditorStore.getState;
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(4000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.late === 0, 'a motor valós időben, akadás nélkül játssza (szűrő + zengés automáció)', `${stats.chunks} szelet, ${stats.late} késett`);
  router.back();
  src.delete();
}

/** 🎚️ Több sáv + effekt-busz: „+ Sáv”, a negyedik sáv klipje és a zengés-busz szól (motor + export). */
async function smokeTracksBuses(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // rövid hangcsomag 0,5 s-onként (a zengés a szünetekben hallható)
  const burst = Float32Array.from({ length: 4 * SR }, (_, i) => (i % (SR / 2) < 2205 ? 0.5 * Math.sin((2 * Math.PI * 660 * i) / SR) : 0));
  const src = new File(Paths.document, 'smoke_bursts.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([burst, burst], SR, () => 0.5));
  const id = 'prj_smoke_tracks';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tracks', caught));
  const base = createEmptyProject('smoke sávok + busz', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.addLane');
  await sleep(200);
  const aux = st().project?.tracks.find((t) => t.type === 'aux1');
  log(!!aux, 'a „+ Sáv” gomb új hangsávot ad', aux?.name ?? 'nincs');
  st().undo();
  log(!st().project?.tracks.some((t) => t.type === 'aux1'), 'az új sáv visszavonható');
  st().redo();
  const c: AudioClip = { kind: 'audio', id: 'b4', uri: src.uri, label: 'csomagok', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  st().dispatch({ type: 'ADD_CLIP', trackType: 'aux1', clip: c });
  st().dispatch({ type: 'SET_AUDIO_BUSES', buses: [{ id: 'rv', name: 'Zengés-busz', fx: { reverb: 0.8 }, gain: 1 }] });
  st().dispatch({ type: 'SET_TRACK_SEND', trackType: 'aux1', busId: 'rv', amount: 0.8 });
  await sleep(600);
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(3000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.chunks > 10 && stats.late === 0, 'a negyedik sáv és a busz a motorral szól, akadás nélkül', `${stats.chunks} szelet, ${stats.late} késett`);
  // export: a busz zengése a hangcsomag UTÁN (50–90 ms) hallható; küldés nélkül csend
  const tail = async (project: Project) => {
    const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_tracks.wav'));
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    let e = 0;
    const a = Math.round(0.56 * SR);
    const b = Math.round(0.6 * SR);
    for (let i = a; i < b; i++) e += y[i] * y[i];
    return 10 * Math.log10(e / (b - a) + 1e-30);
  };
  const p = st().project!;
  const wet = await tail(p);
  const dry = await tail({ ...p, audioSends: {} });
  log(wet > -45 && dry < -80, 'telefonos export: a busz zengése a hang után szól, küldés nélkül nem', `küldéssel ${wet.toFixed(1)} dB, nélküle ${dry.toFixed(1)} dB`);
  runDevAction('audio.mixer');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a keverő: 4 sáv, küldés a zengés-buszra, a busz szintje');
  await sleep(4000);
  router.back();
  src.delete();
}

/** 📑 Másol / Beilleszt / Duplikál a Hang Stúdió eszköztárán (parancs-busz, undo). */
async function smokeClipboard(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_clip.wav', 6);
  const id = 'prj_smoke_clipboard';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:clipboard', caught));
  const base = createEmptyProject('smoke vágólap', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'cb', uri, label: 'minta', start: 1, duration: 2, trimIn: 0, sourceDuration: 6, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'sfx' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const sfx = () => (st().project?.tracks.find((t) => t.type === 'sfx')?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('cb');
  runDevAction('audio.duplicate');
  await sleep(200);
  log(sfx().length === 2 && Math.abs(sfx()[1].start - 3) < 1e-6, 'Duplikál: a másolat közvetlenül utána (3 s)', sfx().map((x) => x.start).join(', '));
  log(st().clipClipboard === null, 'a duplikálás a vágólapot nem írja felül');
  st().undo();
  log(sfx().length === 1, 'a duplikálás visszavonható');
  st().selectClip('cb');
  runDevAction('audio.copy');
  // a lejátszófej a projekt hosszán belül (a store a végére korlátozza)
  st().setPlayhead(2.5);
  runDevAction('audio.paste');
  await sleep(200);
  log(sfx().length === 2 && Math.abs(sfx()[1].start - 2.5) < 0.05, 'Másol + Beilleszt: a lejátszófejnél, a kijelölt klip sávjára', sfx().map((x) => x.start.toFixed(2)).join(', '));
  runDevAction('audio.fit');
  log(true, 'FOTÓZHATÓ', 'az eszköztár: Másol · Beilleszt · Duplikál');
  await sleep(4000);
  router.back();
}

/** 🎼 Ütemjelzés: a gomb 4/4 → 3/4 → 2/4 → 6/8; a kijelzés és a rács követi; undo. */
async function smokeMeter(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_meter.wav', 8);
  const id = 'prj_smoke_meter';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:meter', caught));
  const base = createEmptyProject('smoke ütemjelzés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri, label: 'dal', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  for (let i = 0; i < 3; i++) {
    runDevAction('audio.meter');
    await sleep(150);
  }
  const ts = st().project?.timeSignature;
  log(ts?.beatsPerBar === 6 && ts.beatUnit === 8, 'a gomb háromszor: 4/4 → 3/4 → 2/4 → 6/8', `${ts?.beatsPerBar}/${ts?.beatUnit}`);
  st().setPlayhead(1.75);
  await sleep(200);
  log(barsBeatsLabel(120, 1.75, ts) === '2.2', 'a kijelzés 6/8-ban: 1,75 s = 2. ütem 2. nyolcad', barsBeatsLabel(120, 1.75, ts));
  st().undo();
  log(st().project?.timeSignature?.beatsPerBar === 2, 'az ütemjelzés visszavonható (2/4)', `${st().project?.timeSignature?.beatsPerBar}/${st().project?.timeSignature?.beatUnit}`);
  st().redo();
  runDevAction('audio.fit');
  log(true, 'FOTÓZHATÓ', '6/8: nyolcados rács, ütemvonal 1,5 s-onként, a kijelző „6/8”');
  await sleep(4000);
  router.back();
}

/** van-e felhő ebben a buildben (dev: a helyi worker; release: csak beállított `EXPO_PUBLIC_CLOUD_URL`-lel) */
function cloudInThisBuild(): boolean {
  return cloudAvailable();
}

/** 🧪 a Mac próbafájl-szervere (8799) a Metro címén — Wi-Fin és USB-n (169.254) is */
function smokeFileHost(): string {
  // release-mérésnél nincs Metro-cím: a build idején megadott Mac-cím
  const fixed = process.env.EXPO_PUBLIC_SMOKE_HOST?.trim();
  return `http://${fixed || serverHost(undefined, Constants.expoConfig?.hostUri, true)}:8799`;
}

/** a sáv megjelenített neve (a stem-fájlnévhez) */
function laneLabelFor(type: string, t: TFunction): string {
  const lane = audioLanes(useEditorStore.getState().project).find((l) => l.type === type);
  return lane ? laneLabel(lane, t) : type;
}

/** kulcs-sorrendtől független JSON (szerkezeti egyezéshez) */
function sortedJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
}

/** 🎧 Hosszú tömörített forrás szakaszosan (mp3 44,1/48 kHz, m4a 48 kHz): időzítés (eltolás) és pontosság a jel ismert értékéhez. */
async function smokeLongCodec(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(canSegment(), 'a build szakaszosan dekódol (natív ablak)', `${Platform.OS}`);
  const SR = 44100;
  // a frekvencia 0,1 s-onként vált (200 + 37·(k mod 50) Hz): a mérőablakban az eltolás egyértelmű
  const value = (i: number) => 0.3 * Math.sin((2 * Math.PI * (200 + 37 * (Math.floor((i / SR) * 10) % 50)) * i) / SR);
  for (const name of ['hop_44k.mp3', 'hop_48k.mp3', 'hop_48k.m4a']) {
    const t0 = Date.now();
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `smoke_${name}`);
    if (!local) {
      log(false, `${name}: letöltés`, '-');
      continue;
    }
    const long = new LongSource(local);
    // a mérőablakok frekvencia-határon (20 s-onként vált) — a tiszta szinuszon a korreláció periodikus, ott az eltolás nem egyértelmű
    for (const [label, from] of [['1 s', 1.0], ['40 s (szakaszhatár)', 39.95], ['22. perc (1320 s)', 22 * 60 - 0.05]] as const) {
      const a = Math.round(from * SR);
      const n = 4410;
      const pad = 6000;
      const t1 = Date.now();
      await long.ensure(a - pad, a + n + pad);
      const w = long.read(a - pad, a + n + pad);
      const ms = Date.now() - t1;
      if (!w) {
        log(false, `${name} @ ${label}`, 'nincs adat');
        continue;
      }
      const x = w[0];
      // az eltolás: a legjobb egyezés a referenciával ±6000 mintán belül
      let bestLag = 0;
      let best = -Infinity;
      for (let lag = -pad; lag <= pad; lag++) {
        let c = 0;
        for (let i = 0; i < n; i += 2) c += x[pad + lag + i] * value(a + i);
        if (c > best) {
          best = c;
          bestLag = lag;
        }
      }
      let sig = 0;
      let err = 0;
      for (let i = 0; i < n; i++) {
        const r = value(a + i);
        sig += r * r;
        err += (x[pad + i] - r) * (x[pad + i] - r);
      }
      const snr = 10 * Math.log10(sig / Math.max(1e-20, err));
      let errB = 0;
      for (let i = 0; i < n; i++) errB += (x[pad + bestLag + i] - value(a + i)) ** 2;
      log(null, `${name} @ ${label}: a legjobb illesztés`, `eltolás ${bestLag}, SNR ott ${(10 * Math.log10(sig / Math.max(1e-20, errB))).toFixed(1)} dB`);
      log(Math.abs(bestLag) <= 1 && snr > 25, `${name} @ ${label}: a minták a helyükön`, `eltolás ${bestLag} minta, SNR ${snr.toFixed(1)} dB, ${ms} ms`);
    }
    log(long.loaded() <= 8, `${name}: a memóriában legfeljebb 8 szakasz`, `${long.loaded()} (letöltés+mérés ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}

/** ↩️🤖 AI-műveletek visszavonása + hiba utáni helyreállítás: minden AI-lépés EGY visszavonás (pontosan az eredeti), újra = az eredmény; a hang a végén mintára az eredeti; megszakítás, hiányzó fájl, zárolt sáv. */
async function smokeAiUndo(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // beszéd: nagy dinamika, dübörgés, zaj (a mixjavaslatnak); a „hang” sávon csendek (a csendkeresésnek)
  const voice = Float32Array.from({ length: 13 * SR }, (_, i) => {
    const t = i / SR;
    const lvl = Math.floor(t / 1.3) % 2 === 0 ? 0.4 : 0.04;
    const v = t % 1.3 < 1 ? lvl * (0.6 * Math.sin(2 * Math.PI * 150 * t) + 0.3 * Math.sin(2 * Math.PI * 450 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    return v + 0.2 * Math.sin(2 * Math.PI * 35 * t) + 0.01 * rnd();
  });
  const talk: [number, number][] = [[0, 1.5], [3, 4.5], [5.2, 8]];
  const fxPcm = Float32Array.from({ length: 8 * SR }, (_, i) => {
    const t = i / SR;
    return talk.some(([a, b]) => t >= a && t < b) ? 0.3 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0.001 * rnd();
  });
  const write = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  const vUri = write('smoke_aiu_voice.wav', voice);
  const fUri = write('smoke_aiu_fx.wav', fxPcm);
  const mUri = toneWav('smoke_aiu_music.wav', 13);
  const id = 'prj_smoke_aiundo';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:aiundo', caught));
  const base = createEmptyProject('smoke AI-visszavonás', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', uri: vUri, start: 0, duration: 13, sourceDuration: 13, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    bpm: 120,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] }
        : t.type === 'music'
          ? { ...t, clips: [ac({ id: 'm', label: 'zene', uri: mUri, volume: 0.5 })] }
          : t.type === 'sfx'
            ? { ...t, clips: [ac({ id: 'f', label: 'hang', uri: fUri, duration: 8, sourceDuration: 8, volume: 0.5 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(p, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  const audioBefore = await render(st().project!, 'smoke_aiu_a.wav');
  const snap = () => JSON.stringify(st().project);
  const origin = snap();
  /** egy AI-művelet: változtat, EGY history-lépés, a visszavonás = előtte, az újra = utána; a végén visszavonva */
  const check = async (name: string, run: () => unknown) => {
    const b = snap();
    const d = st().past.length;
    const n = await run();
    await sleep(300);
    const a = snap();
    const steps = st().past.length - d;
    const actor = st().events.at(-1)?.actor;
    st().undo();
    const u = snap() === b;
    st().redo();
    const r = snap() === a;
    st().undo();
    await sleep(200);
    log(a !== b && steps === 1 && u && r, `${name}: egy lépés — a visszavonás pontosan az előtte, az újra pontosan az utána`, `${typeof n === 'number' ? `${n} parancs, ` : ''}${steps} lépés, szereplő ${actor}, vissza ${u ? '=' : '≠'}, újra ${r ? '=' : '≠'}`);
    return a !== b && steps === 1 && u && r;
  };

  // 1) hang-asszisztens: négy lépés egy mondatból
  runDevAction('audio.assistant');
  await sleep(400);
  devTypeAssistant('Tegyél zengést a beszédre, halkítsd a zenét 3 dB-lel, halkuljon a zene a beszéd alatt és masterelj Spotify-ra');
  await sleep(400);
  await check('hang-asszisztens (4 lépés)', () => runDevAction('assistant.apply'));
  devTypeAssistant('');

  // 2) mixjavaslat: mind; visszavonás után a javaslatok újra alkalmazhatók
  runDevAction('audio.mixAssist');
  let keys: string[] = [];
  for (let i = 0; i < 160 && keys.length === 0; i++) {
    await sleep(250);
    keys = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  }
  await check(`mixjavaslat — mind (${keys.join(', ')})`, () => runDevAction('mixAssist.applyAll'));
  await sleep(300);
  const reAppliedKeys = (runDevAction('mixAssist.appliedKeys') as string[]) ?? [];
  const again = runDevAction('mixAssist.applyAll') as number;
  log(keys.length > 0 && reAppliedKeys.length === 0 && again > 0, 'visszavonás után a javaslat nem marad „✓”, újra alkalmazható', `alkalmazottnak jelölt: ${reAppliedKeys.length}, újra: ${again} parancs`);
  st().undo();
  await sleep(300);

  // 3) mastering-segéd: alkalmazás + mérés; visszavonás után a mérés-eredmény sem látszik
  runDevAction('mixAssist.targetSpotify');
  await sleep(200);
  await check('mastering-segéd (Spotify)', () => runDevAction('mixAssist.applyMaster'));
  await sleep(400);
  log(runDevAction('mixAssist.verifiedShown') === false, 'visszavont master: a „cél elérve” mérés nem látszik tovább', '');

  // 4) megszakítás: az elemzés közben — a projekt változatlan, nem marad futó feladat, utána újra megy
  const b4 = snap();
  const pending = runDevAction('mixAssist.reanalyze') as Promise<unknown>;
  let cancelled = false;
  for (let i = 0; i < 100 && !cancelled; i++) {
    await sleep(20);
    const task = useProgressStore.getState().tasks.find((x) => x.cancel);
    if (task) {
      task.cancel!();
      cancelled = true;
    }
  }
  const res = await pending;
  await sleep(300);
  log(cancelled && res === null && snap() === b4 && useProgressStore.getState().tasks.length === 0, 'megszakított elemzés: a projekt változatlan, nem marad futó feladat', `megszakítva ${cancelled}, eredmény ${res === null ? 'nincs' : 'van'}, feladat ${useProgressStore.getState().tasks.length}`);
  const back = (await runDevAction('mixAssist.reanalyze')) as unknown;
  await sleep(400);
  log(!!back && ((runDevAction('mixAssist.suggestions') as string[]) ?? []).length > 0, 'a megszakítás után az elemzés újra fut', '');
  runDevAction('audio.mixAssistClose');
  await sleep(400);

  // 5) csendek kivágása a jóváhagyás után
  st().selectClip('f');
  const found = (await runDevAction('audio.silenceFind')) as number | null;
  await check(`csendek kivágása (${found} csend)`, () => runDevAction('audio.silenceApply'));

  // 6) ütemenkénti vágás
  st().selectClip('m');
  await check('vágás ütemenként', () => runDevAction('audio.beatSplitBars'));

  // a hang a lépések és visszavonások után mintára az eredeti (a forrásfájlokhoz semmi nem nyúlt)
  const audioAfter = await render(st().project!, 'smoke_aiu_b.wav');
  let maxD = 0;
  for (let i = 0; i < Math.min(audioBefore.length, audioAfter.length); i++) maxD = Math.max(maxD, Math.abs(audioBefore[i] - audioAfter[i]));
  log(snap() === origin && audioBefore.length === audioAfter.length && maxD === 0, 'minden visszavonva: a projekt és a hang mintára az eredeti', `max eltérés ${maxD}, ${audioAfter.length} minta`);

  // 7) hiányzó fájl: a csendkeresés és a beszédvágás nem indul, a projekt változatlan, nem marad futó feladat
  const gone: AudioClip = ac({ id: 'gone', label: 'hiányzó', uri: `${Paths.document.uri}smoke_aiu_missing.wav`, start: 9, duration: 3, sourceDuration: 3 });
  st().addClip('sfx', gone);
  st().selectClip('gone');
  const b7 = snap();
  const sil = await runDevAction('audio.silenceFind');
  const sp = await runDevAction('audio.speechStart');
  await sleep(300);
  log(sil === null && sp === null && snap() === b7 && useSilenceReview.getState().review === null && useProgressStore.getState().tasks.length === 0, 'hiányzó fájl: a csendkeresés és a beszédvágás hibát jelez, a projekt változatlan', `csend ${String(sil)}, beszéd ${String(sp)}`);
  runDevAction('audio.mixAssist');
  let fin: string[] = [];
  for (let i = 0; i < 240 && fin.length === 0; i++) {
    await sleep(250);
    fin = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  }
  await sleep(300);
  // a hiányzó klip kimarad, a többi sáv elemzése ugyanazt adja
  log(snap() === b7 && useProgressStore.getState().tasks.length === 0 && fin.slice().sort().join() === keys.slice().sort().join(), 'hiányzó fájl a mixjavaslatban: kimarad, a többi sáv javaslatai ugyanazok, a projekt változatlan', `javaslatok: ${fin.join(', ') || '—'}`);
  runDevAction('audio.mixAssistClose');
  st().undo();
  await sleep(300);

  // 8) zárolt sáv: az asszisztens nem írja (a többi lépés igen), egy visszavonás
  st().toggleTrackFlag('music', 'lock');
  const music0 = JSON.stringify(st().project!.tracks.find((t) => t.type === 'music'));
  devTypeAssistant('tegyél zengést a beszédre és halkuljon a zene a beszéd alatt');
  await sleep(400);
  const ok8 = await check('zárolt zene-sáv mellett az asszisztens', () => runDevAction('assistant.apply'));
  st().redo();
  const music1 = JSON.stringify(st().project!.tracks.find((t) => t.type === 'music'));
  const vfx = (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip).audioFx?.reverb;
  st().undo();
  log(ok8 && music0 === music1 && !!vfx, 'zárolt sáv: a zene érintetlen, a beszéd zengést kap', `zengés ${vfx}`);
  st().toggleTrackFlag('music', 'lock');
  devTypeAssistant('');
  log(snap() === origin, 'a próba végén a projekt pontosan az eredeti', '');
  await sleep(800);
  router.back();
}

/** 〰️🎧 Hosszú forrás hullámformája szakaszosan: 30 perces mp3/m4a, percenként 0,25 s-os impulzus a 30. mp-nél — a csúcsok a helyükön a fájl végén is. */
async function smokeLongWave(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  for (const name of ['env_44k.mp3', 'env_48k.m4a']) {
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `smoke_${name}`);
    if (!local) {
      log(false, `${name}: letöltés`, '-');
      continue;
    }
    const f = new File(local);
    const cached = new File(Paths.cache, `${waveformCacheKey(local, f.size ?? 0, f.modificationTime ?? 0)}.json`);
    if (cached.exists) cached.delete();
    clearWaveformMemory();
    const t0 = Date.now();
    const w = await getWaveform(local, { userInitiated: true });
    const ms = Date.now() - t0;
    if (!w) {
      log(false, `${name}: hullámforma`, 'null');
      continue;
    }
    log(lastWaveformMode() === 'segmented' && Math.abs(w.peaks.length - 1800 * 64) <= 2, `${name}: szakaszosan számolva, 30 perc × 64 csúcs`, `${lastWaveformMode()}, ${w.peaks.length} csúcs, ${(ms / 1000).toFixed(1)} s`);
    // az impulzus a perc 30,00–30,25 mp-e = a 1920–1935. csúcs; a széleken ±1 csúcs (16 ms) tűrés
    const rows: string[] = [];
    let ok = true;
    for (const m of [1, 15, 29]) {
      const b = m * 3840 + 1920;
      const inside = w.peaks.slice(b + 1, b + 15);
      const before = w.peaks.slice(b - 6, b - 1);
      const after = w.peaks.slice(b + 17, b + 22);
      // a próbafájl szintjei: alap 0,1·0,707, impulzus 0,8·0,707 (az ffmpeg mono→sztereó −3 dB)
      const good = inside.every((x) => x >= 0.45) && before.every((x) => x <= 0.15) && after.every((x) => x <= 0.15);
      ok &&= good;
      rows.push(`${m}. perc: bent ${Math.min(...inside).toFixed(2)}–${Math.max(...inside).toFixed(2)}, előtte ≤ ${Math.max(...before).toFixed(2)}, utána ≤ ${Math.max(...after).toFixed(2)}`);
    }
    log(ok, `${name}: az impulzusok a helyükön (1., 15., 29. perc, ±16 ms)`, rows.join(' · '));
    const again = Date.now();
    clearWaveformMemory();
    const w2 = await getWaveform(local, { userInitiated: true });
    log(!!w2 && w2.peaks.length === w.peaks.length && Date.now() - again < 3000, `${name}: másodszor a lemez-cache-ből`, `${Date.now() - again} ms`);
  }
}

/** ⚡ T1 a valós menetben: a Hang Stúdió megnyitása (hidegen), majd export — a leghosszabb képkocka-szünet mindkettőben. */
async function smokeExportGap(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // a forrás megmarad a futások között (a hullámforma lemez-cache-e a módosítás idejéhez kötött)
  const keep = new File(Paths.document, 'smoke_xgap_keep.wav');
  const uri = keep.exists ? keep.uri : toneWav('smoke_xgap_keep.wav', 60);
  const id = 'prj_smoke_xgap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:xgap', caught));
  const base = createEmptyProject('smoke export-akadás', '1:1', undefined, 'audio');
  const mk = (cid: string, start: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 40, trimIn: 0, sourceDuration: 60, volume: 0.5, fadeIn: 1, fadeOut: 1, source: 'imported' });
  const project: Project = { ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('a', 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('b', 10)] } : tr.type === 'voiceover' ? { ...tr, clips: [mk('c', 20)] } : tr)) };
  await saveProject(project);
  // a hullámforma a lemez-cache-ből jöjjön (mint egy már megnyitott projektnél) — az első futás
  // kiszámolja (és betölti a modult), ezért a mérés csak lemez-cache találatkor érvényes
  const wf = new File(Paths.cache, `${waveformCacheKey(uri, new File(uri).size ?? 0, new File(uri).modificationTime ?? 0)}.json`);
  const cold = wf.exists;
  if (!cold) await getWaveform(uri, { userInitiated: true });
  const watch = () => {
    let gap = 0;
    let at = 0;
    let last = Date.now();
    const t0 = last;
    let on = true;
    const tick = () => {
      const now = Date.now();
      if (now - last > gap) {
        gap = now - last;
        at = last - t0;
      }
      last = now;
      if (on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      on = false;
      return { gap, at };
    };
  };
  // a megnyitás utáni 8 s: minden > 30 ms-os képkocka-szünet időbélyeggel
  const gaps: string[] = [];
  let lastF = Date.now();
  const tOpen = lastF;
  let onF = true;
  const tickF = () => {
    const now = Date.now();
    if (now - lastF > 30) gaps.push(`${now - lastF} ms @${lastF - tOpen}`);
    lastF = now;
    if (onF) requestAnimationFrame(tickF);
  };
  requestAnimationFrame(tickF);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(100);
  await sleep(8000);
  onF = false;
  log(null, 'megnyitás utáni 8 s (> 30 ms-os szünetek)', gaps.join(' · ') || '—');
  // ellenpróba: 3 s üresjárat (nincs képkocka-kérés) után munka NÉLKÜL indított figyelő
  await sleep(3000);
  const idle = watch();
  await sleep(300);
  const idleRes = idle();
  log(null, 'ellenpróba: munka nélkül, üresjárat után', `leghosszabb szünet ${idleRes.gap} ms @${idleRes.at} ms`);
  await sleep(3000);
  // a megnyitott stúdió már betöltötte a hang-modult (a lejátszó-motor) — az export nem fizeti meg
  const tl = Date.now();
  await loadAudioApi();
  log(cold ? Date.now() - tl < 10 : null, 'a hang-modul a megnyitott stúdióban már betöltve (az export nem tölti be hidegen)', `${Date.now() - tl} ms${cold ? '' : ' — első futás: a hullámforma számolása töltötte be, nem mérvadó'}`);
  const stopExport = watch();
  await sleep(80);
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_xgap.wav'));
  const ms = Date.now() - t0;
  const exp = stopExport();
  new File(out).delete();
  log(exp.gap <= 50, 'T1 export a megnyitott stúdióból: a felület nem akad (leghosszabb képkocka-szünet ≤ 50 ms)', `${exp.gap} ms @${exp.at} ms, export ${ms} ms`);
  router.back();
}

/** ⏸️🎙️ T2 felvétel szünettel: 1 s felvétel → 1 s szünet → 1 s felvétel = EGY klip (~2 s), a szintmérő él, a szünet nem zárja le. */
async function smokeRecPause(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const id = 'prj_smoke_recpause';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:recpause', caught));
  const base = createEmptyProject('smoke felvétel-szünet', '9:16', undefined, 'audio');
  const bed: AudioClip = { kind: 'audio', id: 'bed', uri: toneWav('smoke_recpause_bed.wav', 8), label: 'alap', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [bed] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  st().setPlayhead(1);
  await sleep(200);
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const state = () => runDevAction('audio.recordState') as { active: boolean; recording: boolean; paused: boolean; metering?: number; hot: boolean; durationMillis: number };
  const pastBefore = st().past.length;
  await runDevAction('audio.recordToggle');
  const meters: number[] = [];
  for (let i = 0; i < 10; i++) {
    await sleep(100);
    const m = state().metering;
    if (typeof m === 'number') meters.push(m);
  }
  log(state().recording && meters.length > 0 && meters.some((m) => m > -160), 'felvétel közben a szintmérő él (dBFS)', `${meters.map((m) => m.toFixed(0)).join(' ')}`);
  const loud = meters.some((m) => m >= -3);
  log(state().hot === loud, `„túl hangos” jelzés pontosan a −3 dBFS fölötti szintnél (${loud ? 'itt bekapcsol' : 'itt nincs'})`, `jelzés ${state().hot}, legnagyobb ${Math.max(...meters).toFixed(1)} dBFS`);
  log(true, 'FOTÓZHATÓ', 'a felvételi sáv: szünet-gomb, idő, szintmérő');
  await sleep(2500);
  runDevAction('audio.recordPause');
  await sleep(200);
  const p0 = state();
  await sleep(1500);
  const p1 = state();
  log(p0.paused && !p0.recording && p0.active && Math.abs(p1.durationMillis - p0.durationMillis) < 150 && voice().length === 0, 'szünet: a take él (nem zárul le magától), az idő áll', `${p0.durationMillis} → ${p1.durationMillis} ms, klip ${voice().length}`);
  runDevAction('audio.recordPause');
  await sleep(1000);
  const recorded = state().durationMillis;
  await runDevAction('audio.recordToggle');
  await sleep(800);
  const v = voice();
  const c = v[0];
  const fileDur = c ? await probeAudioDuration(c.uri) : 0;
  // felvett idő: ~1,1 s (a mérő-minták) + 2,5 s (kép) a szünet előtt, ~1 s utána
  log(v.length === 1 && !!c && Math.abs(c.duration - recorded / 1000) < 0.25 && Math.abs(fileDur - c.duration) < 0.25, 'szünet után folytatva: EGY klip, a hossza a felvett idő (a szünet nélkül), a fájl is', `${v.length} klip, klip ${c?.duration.toFixed(2)} s, felvett ${(recorded / 1000).toFixed(2)} s, fájl ${fileDur.toFixed(2)} s`);
  log(!!c && c.start === 1 && !state().active, 'a klip a felvétel kezdeténél (1 s), a felvételi sáv eltűnt', `start ${c?.start}`);
  log(st().past.length === pastBefore + 1, 'egy history-lépés', `${st().past.length - pastBefore}`);
  st().undo();
  log(voice().length === 0, 'egy visszavonás: a klip vissza', '');
  router.back();
}

/**
 * ⏱️🎯 T3 count-in + punch-in. Mindkét take kétszer: (1) az áthallás-illesztéssel (az app a hallott
 * kattanásokhoz / zenéhez igazít és kalibrál), (2) KIKAPCSOLT illesztéssel, csak a tárolt kalibrációval —
 * ezt a füstteszt a felvett hangon FÜGGETLENÜL méri (kattanás-kezdetek / a zene keresztkorrelációja).
 */
async function smokePunch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const SR = 44100;
  // zene: a frekvencia 0,1 s-onként ugrik — az áthallásban az eltolás egyértelmű
  const music = (tt: number) => 0.45 * Math.sin(2 * Math.PI * (300 + 40 * (Math.floor(tt * 10) % 25)) * tt);
  const mPcm = Float32Array.from({ length: 12 * SR }, (_, i) => music(i / SR));
  const mFile = new File(Paths.document, 'smoke_punch_music.wav');
  if (mFile.exists) mFile.delete();
  mFile.create();
  mFile.write(encodeWav16([mPcm, mPcm], SR, () => 0.5));
  const old = toneWav('smoke_punch_old.wav', 12);
  const id = 'prj_smoke_punch';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:punch', caught));
  const base = createEmptyProject('smoke punch-in', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'x', uri: old, label: 'x', start: 0, duration: 10, trimIn: 0, sourceDuration: 12, volume: 0.05, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'old', label: 'régi' })] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'm', uri: mFile.uri, label: 'zene', duration: 12, volume: 1 })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  const state = () => runDevAction('audio.recordState') as { active: boolean };
  const api = (await loadAudioApi())!;
  const mono = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0).slice();
  const ms = (x: number) => `${(x * 1000).toFixed(1)} ms`;

  // ── count-in: 1 ütem 120 BPM-en = 2,0 s ──
  useRecordPrefs.getState().setPunch(false);
  useRecordPrefs.getState().setCountIn(1);
  const countInTake = async (alignOn: boolean) => {
    setTakeAlignForTest(alignOn);
    st().setPlayhead(1);
    await sleep(300);
    await runDevAction('audio.recordToggle');
    await sleep(3800);
    await runDevAction('audio.recordToggle');
    for (let k = 0; k < 100 && !voice().some((c) => c.id !== 'old'); k++) await sleep(100);
    await sleep(300);
    const ci = voice().find((c) => c.id !== 'old');
    const info = lastTakeAlign();
    if (!ci) return { ci: null, info, err: null as number[] | null };
    // független mérés: a kattanások kezdete a felvett hangban (a legnagyobb csúcs negyede fölött)
    const y = await mono(ci.uri);
    let peak = 0;
    for (let k = 0; k < Math.min(y.length, 2.6 * SR); k++) peak = Math.max(peak, Math.abs(y[k]));
    const onsets: number[] = [];
    for (let k = 0; k < Math.min(y.length, 2.6 * SR) && onsets.length < 4; k++) {
      if (Math.abs(y[k]) > Math.max(0.02, peak * 0.25)) {
        onsets.push(k / SR);
        k += Math.round(0.3 * SR);
      }
    }
    const e0 = (ci.trimIn ?? 0) - 2;
    const err = onsets.length === 4 ? onsets.map((o, k) => o - (e0 + k * 0.5)) : null;
    return { ci, info, err };
  };
  const c1 = await countInTake(true);
  log(!!c1.ci && c1.ci.start === 1 && Math.abs(c1.ci.duration + (c1.ci.trimIn ?? 0) - (c1.ci.sourceDuration ?? 0)) < 0.01, 'count-in: a take a lejátszófejnél, az előszámlálás levágva', `trimIn ${c1.ci?.trimIn?.toFixed(3)} s, hossz ${c1.ci?.duration.toFixed(2)} s; igazítás: ${c1.info?.measured ? `a hallott kattanásokból (${ms(c1.info.shift)}, ρ ${c1.info.rho?.toFixed(2)})` : `tárolt kalibráció (próbált ρ ${c1.info?.rho?.toFixed(2) ?? '—'})`}`);
  log(c1.err ? c1.err.every((e) => Math.abs(e) <= 0.02) : null, 'count-in (illesztéssel): a 4 hallott kattanás a levágás előtt pontosan 0,5 s-onként (±20 ms, független mérés)', c1.err ? `eltérés ${c1.err.map(ms).join(' / ')}` : 'nincs áthallás — nem mérhető');
  st().undo();
  await sleep(300);
  const c2 = await countInTake(false);
  log(c2.err ? c2.err.every((e) => Math.abs(e) <= 0.02) : null, 'count-in CSAK a tárolt kalibrációval (a hangot az app nem nézte): a hallott kattanásokhoz igazítva (±20 ms)', c2.err ? `eltérés ${c2.err.map(ms).join(' / ')} (kalibráció ${ms(c2.info?.shift ?? 0)})` : 'nincs áthallás — nem mérhető');
  st().undo();
  await sleep(300);

  // ── punch-in 4–6 s között, 2 s preroll ──
  useRecordPrefs.getState().setCountIn(0);
  useRecordPrefs.getState().setPunch(true);
  st().setPlayhead(4);
  st().setRangeIn();
  st().setPlayhead(6);
  st().setRangeOut();
  const punchTake = async (alignOn: boolean) => {
    setTakeAlignForTest(alignOn);
    await sleep(300);
    const pastBefore = st().past.length;
    const t0 = Date.now();
    await runDevAction('audio.recordToggle');
    const RR = requireOptionalNativeModule<{ ioLatency?: () => { route?: string; category: string; options?: number } }>('RemixRender');
    const routes = new Set<string>();
    for (let k = 0; k < 120 && (Date.now() - t0 < 1000 || state().active); k++) {
      await sleep(100);
      const io = RR?.ioLatency?.();
      if (io) routes.add(`${io.route}/${io.category.replace('AVAudioSessionCategory', '')}/${io.options}`);
    }
    log(null, 'kimeneti útvonal a punch alatt', [...routes].join(' | ') || '—');
    // a take a take-illesztés (dekódolás + korreláció) után kerül a projektbe
    for (let k = 0; k < 100 && !voice().some((c) => c.uri !== old); k++) await sleep(100);
    await sleep(300);
    const v = voice();
    const take = v.find((c) => c.uri !== old) ?? null;
    const info = lastTakeAlign();
    let resid: number | null = null;
    let rho = 0;
    if (take) {
      // független mérés: a take-ben áthallott zene keresztkorrelációja a projekt idejében
      const y = await mono(take.uri);
      const recStart = take.start - (take.trimIn ?? 0);
      const from = Math.round(((take.trimIn ?? 0) + 0.7) * SR);
      const n = Math.round(0.5 * SR);
      const corrAt = (lag: number, step: number) => {
        let c = 0;
        let e1 = 0;
        let e2 = 0;
        for (let k = 0; k < n; k += step) {
          const x = y[from + k] ?? 0;
          const r = music(recStart + (from + k + lag) / SR);
          c += x * r;
          e1 += x * x;
          e2 += r * r;
        }
        return c / Math.sqrt(Math.max(1e-20, e1 * e2));
      };
      let bl = 0;
      let bv = -Infinity;
      for (let lag = -Math.round(0.3 * SR); lag <= Math.round(0.3 * SR); lag += 8) {
        const c = corrAt(lag, 4);
        if (c > bv) {
          bv = c;
          bl = lag;
        }
      }
      let fl = bl;
      let fv = -Infinity;
      for (let lag = bl - 8; lag <= bl + 8; lag++) {
        const c = corrAt(lag, 2);
        if (c > fv) {
          fv = c;
          fl = lag;
        }
      }
      rho = fv;
      resid = fv > 0.3 ? fl / SR : null;
    }
    return { v, take, info, resid, rho, steps: st().past.length - pastBefore };
  };
  const p1 = await punchTake(true);
  const geo = (v: AudioClip[], take: AudioClip | null) => v.length === 3 && !!take && Math.abs(take.start + take.duration - 6) < 1e-6 && Math.abs(take.start - 4) < 0.1 && v[0].id === 'old' && Math.abs(v[0].duration - 4) < 1e-6 && Math.abs(v[2].start - 6) < 1e-6 && Math.abs((v[2].trimIn ?? 0) - 6) < 1e-6;
  log(geo(p1.v, p1.take) && p1.steps === 1 && !st().isPlaying, 'punch: a take 4–6 s között, a régi klip 0–4 és 6–10 darabra (a forrás-pozíció 6 s), egy lépés, a lejátszás leállt', `${p1.v.map((c) => `${c.uri === old ? 'régi' : 'take'} ${c.start.toFixed(3)}+${c.duration.toFixed(3)} (trimIn ${(c.trimIn ?? 0).toFixed(3)})`).join(' · ')}; igazítás: ${p1.info?.measured ? `az áthallott zenéből (${ms(p1.info.shift)}, ρ ${p1.info.rho?.toFixed(2)})` : `tárolt kalibráció (próbált ρ ${p1.info?.rho?.toFixed(2) ?? '—'})`}`);
  log(p1.resid !== null ? Math.abs(p1.resid) <= 0.02 : null, 'punch (illesztéssel): a take a projekt idejében ott, amit a felhasználó hallott (±20 ms, független mérés)', p1.resid !== null ? `maradék eltérés ${ms(p1.resid)} (ρ ${p1.rho.toFixed(2)})` : `nincs áthallás (ρ ${p1.rho.toFixed(2)}) — nem mérhető`);
  st().undo();
  await sleep(300);
  const p2 = await punchTake(false);
  log(p2.resid !== null ? Math.abs(p2.resid) <= 0.02 : null, 'punch CSAK a tárolt kalibrációval (a hangot az app nem nézte): a hallotthoz igazítva (±20 ms)', p2.resid !== null ? `maradék eltérés ${ms(p2.resid)} (kalibráció ${ms(p2.info?.shift ?? 0)}, ρ ${p2.rho.toFixed(2)})` : `nincs áthallás (ρ ${p2.rho.toFixed(2)}) — nem mérhető`);
  st().undo();
  log(voice().length === 1 && voice()[0].id === 'old' && voice()[0].duration === 10, 'egy visszavonás: a régi klip egészben vissza', '');
  setTakeAlignForTest(true);
  useRecordPrefs.getState().setPunch(false);
  router.back();
}

/** 🔬 Áthallás-kísérlet: felvétel közben mit „hall” a mikrofon — (a) expo-audio lejátszó, (b) a stúdió lejátszó-motorja. */
async function smokeBleed(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const tone = toneWav('smoke_bleed_tone.wav', 6);
  const id = 'prj_smoke_bleed';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bleed', caught));
  const base = createEmptyProject('smoke áthallás', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri: tone, label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const api = (await loadAudioApi())!;
  const env = async (uri: string) => {
    const y = (await api.decodeAudioData(uri, SR)).getChannelData(0);
    const out: string[] = [];
    for (let b = 0; b < y.length; b += Math.round(0.25 * SR)) {
      let m = 0;
      for (let k = b; k < b + 0.25 * SR && k < y.length; k++) m = Math.max(m, Math.abs(y[k]));
      out.push(m.toFixed(3));
    }
    return out.join(' ');
  };
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]);
  const take = async (label: string, during: () => Promise<void>) => {
    await runDevAction('audio.recordToggle');
    await during();
    await runDevAction('audio.recordToggle');
    await sleep(700);
    const v = voice();
    const last = v[v.length - 1];
    log(null, `áthallás — ${label} (csúcs 250 ms-onként)`, last ? await env(last.uri) : 'nincs take');
    st().undo();
    await sleep(300);
  };
  await take('csend (alapzaj)', async () => {
    await sleep(2500);
  });
  await take('expo-audio lejátszó (440 Hz, 0,5)', async () => {
    const p = createAudioPlayer(tone);
    await sleep(200);
    p.play();
    await sleep(2300);
    p.remove();
  });
  await take('a stúdió lejátszó-motorja (a projekt szól)', async () => {
    st().setPlayhead(0);
    st().setPlaying(true);
    await sleep(2500);
    st().setPlaying(false);
  });
  router.back();
}

/** 🎙️🔁 T4 take-ek: 3 punch ugyanarra a helyre = 3 take (nem vágás), a 2. választva az export a 2. take hangja; egy undo; mentés után is megvan mind. */
async function smokeTakes(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const SR = 44100;
  const id = 'prj_smoke_takes';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:takes', caught));
  const base = createEmptyProject('smoke take-ek', '9:16', undefined, 'audio');
  const bed: AudioClip = { kind: 'audio', id: 'bed', uri: toneWav('smoke_takes_bed.wav', 8), label: 'alap', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.02, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [bed] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const voice = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]);
  const state = () => runDevAction('audio.recordState') as { active: boolean };
  useRecordPrefs.getState().setCountIn(0);
  useRecordPrefs.getState().setPunch(true);
  st().setPlayhead(2);
  st().setRangeIn();
  st().setPlayhead(4);
  st().setRangeOut();
  const takes: string[] = [];
  for (let k = 0; k < 3; k++) {
    const before = voice()[0]?.uri;
    const t0 = Date.now();
    await runDevAction('audio.recordToggle');
    for (let i = 0; i < 120 && (Date.now() - t0 < 1000 || state().active); i++) await sleep(100);
    for (let i = 0; i < 100 && voice()[0]?.uri === before; i++) await sleep(100);
    await sleep(300);
    takes.push(voice()[0]?.uri ?? '');
    const al = lastTakeAlign();
    log(null, `${k + 1}. take igazítása`, al ? `${al.measured ? 'mért' : 'kalibráció'} ${(al.shift * 1000).toFixed(1)} ms, ρ ${al.rho?.toFixed(2) ?? '—'}` : '—');
  }
  const c = voice()[0];
  log(voice().length === 1 && c?.takes?.length === 3 && c.activeTake === c.takes[2].id && c.uri === takes[2] && new Set(takes).size === 3, '3 punch ugyanarra a helyre: EGY klip 3 take-kel, az utolsó szól', `${voice().length} klip, ${c?.takes?.length ?? 0} take, aktív ${(c?.takes?.findIndex((x) => x.id === c?.activeTake) ?? -1) + 1}.`);
  if (!c?.takes || c.takes.length !== 3) {
    router.back();
    return;
  }
  // a take-választó a klipszerkesztőben (képernyőkép)
  st().selectClip(c.id);
  runDevAction('audio.editClip');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a klipszerkesztő tetején a take-választó (3 take, előhallgatással)');
  await sleep(2500);
  // a 2. take választása (a lap útja: függő beállítás nélkül egy lépés)
  const past0 = st().past.length;
  st().dispatch(selectTakeCommand(voice()[0], c.takes[1].id)!);
  const c2 = voice()[0];
  log(st().past.length === past0 + 1 && c2.uri === takes[1] && c2.activeTake === c.takes[1].id && Math.abs(c2.start - c.takes[1].start) < 1e-9 && Math.abs((c2.trimIn ?? 0) - c.takes[1].trimIn) < 1e-9, 'a 2. take választva: a klip a 2. take hangja és helye, egy lépés', `trimIn ${c2.trimIn?.toFixed(3)} s`);
  await sleep(600);
  runDevAction('clipEdit.done');
  await sleep(400);
  // az export a választott take hangja: korreláció mindhárom take fájljával (a take-ek külön felvételek)
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_takes.wav'), undefined, undefined, 'float32');
  const api = (await loadAudioApi())!;
  const y = (await api.decodeAudioData(out, SR)).getChannelData(0);
  new File(out).delete();
  const corr = async (take: { uri: string; trimIn: number; start: number }) => {
    const x = (await api.decodeAudioData(take.uri, SR)).getChannelData(0);
    // a klip közepe (a mikro-fade-ek nélkül): export[start + j] ↔ take[trimIn + j]
    const a = Math.round((c2.start + 0.1) * SR);
    const n = Math.round(1.6 * SR);
    const off = Math.round(take.trimIn * SR) - Math.round(take.start * SR);
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let j = a; j < a + n; j++) {
      const p = y[j] ?? 0;
      const q = x[j + off] ?? 0;
      xy += p * q;
      xx += p * p;
      yy += q * q;
    }
    return xy / Math.sqrt(Math.max(1e-30, xx * yy));
  };
  const rs: number[] = [];
  for (const tk of c.takes) rs.push(await corr({ uri: tk.uri, trimIn: c2.trimIn ?? 0, start: c2.start }));
  const distinct = Math.max(Math.abs(rs[0]), Math.abs(rs[2])) < 0.9;
  log(rs[1] > 0.99 ? (distinct ? true : null) : false, 'az export a 2. take hangja (korreláció ≥ 0,99), a másik kettőé nem', `take 1/2/3: ${rs.map((r) => r.toFixed(3)).join(' / ')}${distinct ? '' : ' — a take-ek hangja itt nem különböztethető meg (azonos bemenet)'}`);
  // egy visszavonás: az előző (3.) take
  st().undo();
  log(voice()[0].uri === takes[2] && voice()[0].activeTake === c.takes[2].id, 'egy visszavonás: az előző take szól újra', '');
  st().redo();
  // mentés + újratöltés a tárból
  await saveProject(st().project!);
  const re = await loadProject(id);
  const rc = re?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip | undefined;
  log(rc?.takes?.length === 3 && rc.activeTake === c.takes[1].id && rc.uri === takes[1] && rc.takes.every((x) => new File(x.uri).exists), 'mentés után újratöltve: mind a 3 take megvan (a fájlok is), a 2. szól', `${rc?.takes?.length ?? 0} take`);
  useRecordPrefs.getState().setPunch(false);
  router.back();
}

/** 📊 T5 élő LUFS + true-peak: a lejátszott (exporttal azonos) keverésből — ismert jeleken a mért érték az elméleti. */
async function smokeLiveLufs(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const write = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  // 0–5 s: 1 kHz −14 dBFS (sztereó) = −14 LUFS; 5–10 s: fs/4 szinusz 45°-os fázissal, 0,5 → true-peak −6,02 dBTP (mintacsúcs −9,03)
  const a14 = Math.pow(10, -14 / 20);
  const x = Float32Array.from({ length: 10 * SR }, (_, i) => (i < 5 * SR ? a14 * Math.sin((2 * Math.PI * 1000 * i) / SR) : 0.5 * Math.sin((Math.PI / 2) * i + Math.PI / 4)));
  const uri = write('smoke_lufs_ref.wav', x);
  const id = 'prj_smoke_lufs';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:lufs', caught));
  const base = createEmptyProject('smoke élő LUFS', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri, label: 'ref', start: 0, duration: 10, trimIn: 0, sourceDuration: 10, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  st().setPlayhead(0);
  previewEngine.takeStats();
  const tPlay = Date.now();
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  log(null, 'az előnézet-motor szól', `${previewEngine.isPlaying()} (${Date.now() - tPlay} ms után)`);
  await sleep(4200);
  const r1 = previewEngine.loudness();
  log(true, 'FOTÓZHATÓ', 'a transzporton az élő short-term LUFS és true-peak');
  await sleep(600);
  log(!!r1 && Math.abs(r1.shortTerm - -14) <= 0.5 && Math.abs(r1.momentary - -14) <= 0.5, 'élő hangosság: 1 kHz −14 dBFS sztereó → short-term és momentary −14 ± 0,5 LUFS', r1 ? `S ${r1.shortTerm.toFixed(2)} · M ${r1.momentary.toFixed(2)} · I ${r1.integrated.toFixed(2)} LUFS` : 'null');
  st().setPlaying(false);
  await sleep(300);
  st().setPlayhead(5.2);
  await sleep(200);
  st().setPlaying(true);
  await sleep(2500);
  const r2 = previewEngine.loudness();
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(!!r2 && Math.abs(r2.truePeak - -6.02) <= 0.2, 'élő true-peak: fs/4 szinusz 45°-kal, 0,5 → −6,02 ± 0,2 dBTP (a mintacsúcs −9,03 dB — a minták közti csúcsot is látja)', r2 ? `TP ${r2.truePeak.toFixed(2)} dBTP (max ${r2.truePeakMax.toFixed(2)})` : 'null');
  log(stats.late === 0, 'a mérés mellett sem késik szelet', `${stats.chunks} szelet, ${stats.late} késett`);
  router.back();
}

/** ⏸️➕✂️↩️ T6 csend beszúrása + összeillesztés: az export mintára (a beszúrás pontosan 1 s-mal tolja a folytatást; a vágás + összeillesztés = az eredeti, bitre). */
async function smokeGapEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // a beszéd: a frekvencia 0,1 s-onként ugrik (a tolás mintára ellenőrizhető)
  const v = Float32Array.from({ length: 8 * SR }, (_, i) => 0.4 * Math.sin(2 * Math.PI * (220 + 30 * (Math.floor((i / SR) * 10) % 20)) * (i / SR)));
  const f = new File(Paths.document, 'smoke_gap_voice.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([v, v], SR, () => 0.5));
  const id = 'prj_smoke_gap';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:gap', caught));
  const base = createEmptyProject('smoke csend + illesztés', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'v', uri: f.uri, label: 'beszéd', start: 0, duration: 4, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  await saveProject({ ...base, id, markers: [{ id: 'mk', time: 3, label: 'jel' }], tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({})] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'mu', uri: toneWav('smoke_gap_bed.wav', 8), duration: 6, volume: 0.2 })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(voOnly(p), new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  const origin = JSON.stringify(st().project);
  const A = await render(st().project!, 'smoke_gap_a.wav');
  const maxDiff = (x: Float32Array, y: Float32Array, from: number, to: number, shift = 0) => {
    let d = 0;
    for (let i = from; i < to; i++) d = Math.max(d, Math.abs((x[i] ?? 0) - (y[i + shift] ?? 0)));
    return d;
  };
  // 1) csend 1 s a 2. mp-nél, csak a beszéd-sávon
  st().selectClip('v');
  st().setPlayhead(2);
  const n1 = runDevAction('audio.insertSilence1Track') as number;
  const vClips = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  log(n1 === 1 && vClips().length === 2 && vClips()[1].start === 3 && Math.abs((vClips()[1].trimIn ?? 0) - 2) < 1e-9, 'csend beszúrása (csak ez a sáv): a klip kettéválik, a jobb fele 1 s-mal később, a forrás folytatásával', vClips().map((c) => `${c.start}+${c.duration} (trimIn ${c.trimIn})`).join(' · '));
  const B = await render(st().project!, 'smoke_gap_b.wav');
  const seam = Math.round(0.012 * SR);
  const before = maxDiff(A, B, 0, 2 * SR - seam);
  const after = maxDiff(A, B, 2 * SR + seam, 4 * SR - seam, SR);
  let gapPeak = 0;
  for (let i = 2 * SR + seam; i < 3 * SR - seam; i++) gapPeak = Math.max(gapPeak, Math.abs(B[i]));
  log(before === 0 && after === 0 && gapPeak === 0 && B.length - A.length === SR, 'a hang: előtte változatlan, a beszúrás néma, utána ugyanaz pontosan 44 100 mintával később (a varratok 10 ms-os mikro-fade-je nélkül)', `eltérés ${before} / ${after}, csend csúcsa ${gapPeak}, hossz +${B.length - A.length} minta`);
  log(st().project!.markers?.[0]?.time === 3 && (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).duration === 6, 'csak ez a sáv: a zene és a jelölő a helyén', '');
  st().undo();
  log(JSON.stringify(st().project) === origin, 'egy visszavonás: pontosan az eredeti', '');
  // 2) minden sáv
  st().setPlayhead(2);
  runDevAction('audio.insertSilence1All');
  const mus = (st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  log(mus.length === 2 && mus[1].start === 3 && st().project!.markers?.[0]?.time === 4, 'minden sáv: a zene is kettéválik és tolódik, a jelölő 3 → 4 s', mus.map((c) => `${c.start}+${c.duration}`).join(' · '));
  st().undo();
  // 3) vágás → összeillesztés = az eredeti (bitre)
  st().splitClipAt('v', 1.7);
  st().selectClip('v');
  const parts = vClips().length;
  const n3 = runDevAction('audio.join') as number;
  const C = await render(st().project!, 'smoke_gap_c.wav');
  log(parts === 2 && n3 === 2 && vClips().length === 1 && vClips()[0].duration === 4 && maxDiff(A, C, 0, A.length) === 0 && A.length === C.length, 'vágás (1,7 s) → összeillesztés: egy klip, a hang bitre az eredeti', `${parts} → ${vClips().length} klip, eltérés ${maxDiff(A, C, 0, A.length)}`);
  st().undo();
  st().undo();
  log(JSON.stringify(st().project) === origin, 'két visszavonás: pontosan az eredeti', '');
  router.back();
}

/** 🔊 T7 klip-erősítés 0 dB fölé: −20 dBFS jel +6 dB-lel → az export −14,0 dBFS, az élő motor −14 LUFS; a régi (0–1) hangerő változatlan. */
async function smokeClipGain(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const a20 = Math.pow(10, -20 / 20);
  const x = Float32Array.from({ length: 6 * SR }, (_, i) => a20 * Math.sin((2 * Math.PI * 1000 * i) / SR));
  const f = new File(Paths.document, 'smoke_gain_ref.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_gain';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:gain', caught));
  const base = createEmptyProject('smoke klip-erősítés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'g', uri: f.uri, label: 'ref', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const peakDb = async () => {
    const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_gain.wav'), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    let m = 0;
    for (let i = Math.round(0.1 * SR); i < y.length - Math.round(0.1 * SR); i++) m = Math.max(m, Math.abs(y[i]));
    return 20 * Math.log10(m);
  };
  const old = await peakDb();
  log(Math.abs(old - -26.02) <= 0.05, 'régi projekt (hangerő 0,5 = −6,02 dB): az export −26,02 dBFS, változatlan', `${old.toFixed(2)} dBFS`);
  // a csúszka útja: dB → szorzó (ugyanaz a függvény), egy lépés
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'g', patch: { volume: dbToVolume(6) } });
  const boosted = await peakDb();
  log(Math.abs(boosted - -14.0) <= 0.05, '+6 dB: az export −14,0 dBFS (−20 + 6)', `${boosted.toFixed(2)} dBFS, szorzó ${dbToVolume(6).toFixed(4)}`);
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(3800);
  const r = previewEngine.loudness();
  st().setPlaying(false);
  log(!!r && Math.abs(r.shortTerm - -14) <= 0.1 && Math.abs(r.truePeak - -14) <= 0.1, 'az előnézet is erősít: élő short-term −14 ± 0,1 LUFS, true-peak −14 ± 0,1 dBTP', r ? `S ${r.shortTerm.toFixed(2)} LUFS, TP ${r.truePeak.toFixed(2)} dBTP` : 'null (a motor nem szólt)');
  st().undo();
  log((st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).volume === 0.5, 'egy visszavonás: 0,5', '');
  router.back();
}

/** 🎬→🎵 T8 hang videóból: a kinyert M4A = a videó hangja (eltolás 0, korreláció ≥ 0,99), a projekt-mappában; hangsáv nélkül érthető hiba, nincs maradék. */
async function smokeFromVideo(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(canExtractAudio(), 'a build tud hangot kinyerni (natív)', '');
  const SR = 44100;
  const id = 'prj_smoke_fromvideo';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fromvideo', caught));
  const base = createEmptyProject('smoke hang videóból', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(800);
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, 'smoke_vid_audio.mp4');
  const noa = await downloadToCache(`${smokeFileHost()}/vid_noaudio.mp4`, 'smoke_vid_noaudio.mp4');
  if (!vid || !noa) {
    log(false, 'a próbavideók letöltése', '-');
    return;
  }
  const t0 = Date.now();
  const r = await extractVideoAudio(vid, 'próba videó.mp4');
  const ms = Date.now() - t0;
  if (!r.ok) {
    log(false, 'kinyerés', `${r.reason} ${r.message ?? ''}`);
    return;
  }
  const inFolder = r.uri.startsWith(projectMediaDir().uri) && new File(r.uri).exists;
  log(inFolder && r.uri.endsWith('.m4a') && Math.abs(r.duration - 6) <= 1 / 30, 'a videó hangja M4A-ként a projekt-mappában, a hossza a videóé (± 1 képkocka)', `${r.duration.toFixed(3)} s, ${((new File(r.uri).size ?? 0) / 1024).toFixed(0)} kB, ${ms} ms, ${r.uri.split('/').slice(-2).join('/')}`);
  const api = (await loadAudioApi())!;
  const ex = (await api.decodeAudioData(r.uri, SR)).getChannelData(0);
  const orig = (await api.decodeAudioData(vid, SR)).getChannelData(0);
  const ref = (i: number) => 0.4 * Math.sin(2 * Math.PI * (300 + 40 * (Math.floor((i / SR) * 10) % 25)) * (i / SR));
  const best = (get: (i: number) => number) => {
    const a = SR;
    const n = SR;
    let bl = 0;
    let bv = -Infinity;
    for (let lag = -2000; lag <= 2000; lag++) {
      let xy = 0;
      for (let j = a; j < a + n; j += 8) xy += ex[j + lag] * get(j);
      if (xy > bv) {
        bv = xy;
        bl = lag;
      }
    }
    let xy = 0;
    let xx = 0;
    let yy = 0;
    for (let j = a; j < a + n; j++) {
      const p = ex[j + bl];
      const q = get(j);
      xy += p * q;
      xx += p * p;
      yy += q * q;
    }
    return { lag: bl, rho: xy / Math.sqrt(xx * yy) };
  };
  const vsVideo = best((j) => orig[j] ?? 0);
  log(vsVideo.lag === 0 && vsVideo.rho >= 0.99, 'a kinyert hang = a videó hangja (eltolás 0, korreláció ≥ 0,99)', `eltolás ${vsVideo.lag} minta, ρ ${vsVideo.rho.toFixed(4)}`);
  const vsRef = best(ref);
  log(null, 'a kinyert hang az ismert jelhez (az AAC kódolói késleltetésével együtt)', `eltolás ${vsRef.lag} minta, ρ ${vsRef.rho.toFixed(4)}`);
  // hangsáv nélküli videó: érthető hiba, nincs maradék fájl, a projekt változatlan
  const before = JSON.stringify(st().project);
  const extracted = () => projectMediaDir().list().filter((x) => x.name.endsWith('_hang.m4a')).length;
  const files0 = extracted();
  const r2 = await extractVideoAudio(noa, 'néma.mp4');
  log(!r2.ok && r2.reason === 'noAudio' && extracted() === files0 && JSON.stringify(st().project) === before, 'hangsáv nélküli videó: „nincs hangsáv” hiba, nincs maradék fájl, a projekt változatlan', `${r2.ok ? 'ok?!' : r2.reason}; kinyert fájlok ${files0} → ${extracted()}; projekt ${JSON.stringify(st().project) === before ? 'változatlan' : 'változott'}`);
  router.back();
}

/** 🥁↔️ T9 ütemhez nyújtás: 120 BPM-es kattanás 100 BPM-es projektben → az exportban 0,600 s-onként, a hangmagasság változatlan (1000 Hz ± 1 %). */
async function smokeTempoMatch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 1 kHz-es, 40 ms-os ütések 0,5 s-onként (120 BPM), szinusz-burkolóval (nincs kattanás a széleken)
  const x = Float32Array.from({ length: 8 * SR }, (_, i) => {
    const ph = (i / SR) % 0.5;
    return ph < 0.04 ? 0.5 * Math.sin(Math.PI * (ph / 0.04)) * Math.sin(2 * Math.PI * 1000 * (i / SR)) : 0;
  });
  const f = new File(Paths.document, 'smoke_tempo_click120.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_tempo';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tempo', caught));
  const base = createEmptyProject('smoke tempó-illesztés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: f.uri, label: 'klikk 120', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 100, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  const before = JSON.stringify(st().project);
  // a gomb útja: ugyanaz a függvény, egy lépés
  st().selectClip('k');
  runDevAction('audio.editClip');
  await sleep(600);
  log(true, 'FOTÓZHATÓ', 'a klipszerkesztőben a tempó-illesztés (forrás 120, „Illeszd: 100 BPM”)');
  await sleep(2500);
  // ellenpróba: az első ütés energia-középpontja nyújtás NÉLKÜL (a klip-eleji mikro-fade hatása)
  {
    const { uri: o0 } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_tempo0.wav'), undefined, undefined, 'float32');
    const y0 = (await (await loadAudioApi())!.decodeAudioData(o0, SR)).getChannelData(0);
    new File(o0).delete();
    const cAt = (from: number) => {
      let e = 0;
      let te = 0;
      for (let i = Math.round(from * SR); i < Math.round((from + 0.13) * SR); i++) {
        const p = y0[i] * y0[i];
        e += p;
        te += (i / SR) * p;
      }
      return te / e;
    };
    log(null, 'nyújtás nélkül: az 1. és a 2. ütés energia-középpontja', `${(cAt(0) * 1000).toFixed(1)} / ${((cAt(0.47) - 0.5) * 1000).toFixed(1)} ms (az ütés elejéhez)`);
  }
  const patch = tempoMatchPatch(st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip, 120, 100)!;
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'k', patch });
  runDevAction('clipEdit.done');
  await sleep(300);
  const k = st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
  log(Math.abs((k.speed ?? 1) - 100 / 120) < 1e-9 && Math.abs(k.duration - 9.6) < 1e-9 && k.sourceBpm === 120, 'illesztve: sebesség 0,8333, a klip 9,6 s (ugyanaz a forrás)', `×${k.speed?.toFixed(4)}, ${k.duration.toFixed(3)} s`);
  const t0 = Date.now();
  const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_tempo.wav'), undefined, undefined, 'float32');
  const ms = Date.now() - t0;
  const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
  new File(out).delete();
  // az ütések kezdete (a legnagyobb csúcs negyedénél)
  let peak = 0;
  for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
  const onsets: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (Math.abs(y[i]) > peak * 0.25) {
      onsets.push(i / SR);
      i += Math.round(0.3 * SR);
    }
  }
  // az ütés ideje = az energia-középpontja (a nyújtás az ütés elejét elkeni — a küszöb-átlépés ütésenként mást mérne)
  const centroid = (o: number) => {
    let e = 0;
    let te = 0;
    for (let i = Math.max(0, Math.round((o - 0.03) * SR)); i < Math.min(y.length, Math.round((o + 0.1) * SR)); i++) {
      const p = y[i] * y[i];
      e += p;
      te += (i / SR) * p;
    }
    return te / e;
  };
  const cs = onsets.map(centroid);
  {
    const pr = await probeStretchTiming(100 / 120);
    log(null, 'szonda: burstönkénti késés 0,5 s-onként (0,8333×)', pr ? pr.map((x) => `${((x / SR) * 1000).toFixed(1)}`).join(' / ') + ' ms' : '—');
  }
  log(null, 'a nyújtó mért késése (0,8333×)', `${(((await measureStretchLatency(100 / 120)) ?? 0) / SR * 1000).toFixed(1)} ms`);
  log(null, 'nyújtva: az 1. és a 2. ütés energia-középpontja', `${(cs[0] * 1000).toFixed(1)} / ${((cs[1] - 0.6) * 1000).toFixed(1)} ms`);
  const gaps = cs.slice(1).map((o, i) => o - cs[i]);
  const worst = gaps.reduce((m, g) => Math.max(m, Math.abs(g - 0.6)), 0);
  const drift = cs.length > 1 ? cs[cs.length - 1] - cs[0] - 0.6 * (cs.length - 1) : NaN;
  log(onsets.length === 16 && worst <= 0.005 && Math.abs(drift) <= 0.005, 'az exportban az ütések 0,600 s-onként (100 BPM): ütésenként ± 5 ms, 15 ütésen át sincs csúszás', `${onsets.length} ütés, a legnagyobb eltérés ${(worst * 1000).toFixed(1)} ms, összcsúszás ${(drift * 1000).toFixed(1)} ms; közök ${gaps.map((g) => (g * 1000).toFixed(0)).join(' ')} ms (export ${ms} ms)`);
  // a hangmagasság: az ütésen belüli nullátmenetek (a középső 24 ms)
  const hz: number[] = [];
  for (const o of onsets.slice(1, 6)) {
    const a = Math.round((o + 0.008) * SR);
    const b = a + Math.round(0.024 * SR);
    let zc = 0;
    for (let i = a + 1; i < b; i++) if ((y[i - 1] < 0) !== (y[i] < 0)) zc++;
    hz.push(zc / 2 / 0.024);
  }
  const worstHz = hz.reduce((m, h) => Math.max(m, Math.abs(h - 1000) / 1000), 0);
  log(worstHz <= 0.01 ? true : worstHz <= 0.03 ? null : false, 'a hangmagasság változatlan: 1000 Hz ± 1 % (nem lassult le a hang)', `${hz.map((h) => h.toFixed(0)).join(' / ')} Hz`);
  st().undo();
  log(JSON.stringify(st().project) === before, 'egy visszavonás: az eredeti tempó', '');
  router.back();
}

/** 👤 ki van bejelentkezve ezen az eszközön (a kétkészülékes collab-próbához) */
async function smokeWhoAmI(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const u = useAuth.getState().user;
  log(null, 'fiók', u ? `${u.email} (${u.id.slice(0, 8)}…)` : 'nincs bejelentkezve');
  log(null, 'megosztás (collab) engedélyezett', String(canUseCloud('collab')));
}

const COLLAB_PID = 'prj_smoke_collab_audio';
const trackDump = (p: Project | null) =>
  JSON.stringify((p?.tracks ?? []).filter((t) => t.clips.length > 0).map((t) => [t.type, t.clips.map((c) => { const { uri, ...rest } = c as AudioClip; return { ...rest, uri: uri.split('/').pop() }; })]));
// a tartalom ujjlenyomata: rendezett kulcsok, eszközfüggő uri nélkül (a felhőből letöltött projekt
// JSON-jában más a kulcsok sorrendje, és a társnál a média helyi fájlra mutat)
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'uri').sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
const fingerprint = (p: Project | null) => {
  const str = JSON.stringify(canon(p?.tracks ?? []));
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/** 👥 T10 tulaj (iPad): megosztja és meghívja a társat, a Hang Stúdióban szerkeszt; méri az oda-vissza időt, a visszavonást és a végső egyezést. */
async function smokeCollabOwner(log: Log) {
  const me = useAuth.getState().user;
  log(null, '[tulaj] fiók', me?.email ?? '—');
  if (!me) return;
  const base = createEmptyProject('smoke közös hang', '9:16', undefined, 'audio');
  const tone = toneWav('smoke_collab_tone.wav', 6);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'm', uri: tone, label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  const project: Project = { ...base, id: COLLAB_PID, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [ac({})] } : t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd', duration: 3 })] } : t)) };
  await saveProject(project);
  await ensureShared(project);
  const inv = await inviteMember({ ownerId: me.id, projectId: COLLAB_PID, projectName: project.name, email: 'h3nz3l@gmail.com', role: 'editor' }).catch((e: Error) => ({ status: `hiba: ${e.message}` }));
  log(null, '[tulaj] megosztva + meghívás', String(inv.status));
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  let peers: { name: string }[] = [];
  const tw = Date.now();
  for (let i = 0; i < 240 && peers.length === 0; i++) {
    await sleep(500);
    peers = useCollabLive.getState().participants;
  }
  log(peers.length > 0, '[tulaj] a társ belépett a hang-projekt élő szobájába (közvetlenül megnyitott Hang Stúdió)', `${peers.map((p) => p.name).join(', ') || '—'} (${((Date.now() - tw) / 1000).toFixed(1)} s várakozás)`);
  if (peers.length === 0) return;
  await sleep(2000);
  // E1 → a társ E2-vel válaszol (pan −0,5 a beszéden): oda-vissza idő
  const t1 = Date.now();
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.4 } });
  const v = () => st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  for (let i = 0; i < 300 && v().pan !== -0.5; i++) await sleep(50);
  const rtt = Date.now() - t1;
  log(v().pan === -0.5 && rtt <= 4000, '[tulaj] oda-vissza: a szerkesztésem a társnál, az övé nálam (≤ 4 s)', `${rtt} ms`);
  // E3: asszisztens-szerű köteg (egy undo) → a társ látja; utána visszavonom → a társnál is vissza
  st().applyBatch([{ type: 'UPDATE_CLIP', clipId: 'v', patch: { audioFx: { reverb: 0.4 } } }, { type: 'SET_TRACK_GAIN', trackType: 'music', gain: 0.5 }], 'ai');
  await sleep(3000);
  st().undo();
  await sleep(4000);
  log(null, '[tulaj] ujjlenyomat a végén', fingerprint(st().project));
  await sleep(4000);
  router.back();
}

/** 👥 T10 tag (iPhone): elfogadja a meghívást, megnyitja a hang-projektet; válaszol a tulaj szerkesztésére, figyeli a köteget és a visszavonást. */
async function smokeCollabMember(log: Log) {
  const me = useAuth.getState().user;
  log(null, '[tag] fiók', me?.email ?? '—');
  if (!me || !supabase) return;
  let owner: string | null = null;
  for (let i = 0; i < 240 && !owner; i++) {
    const { data } = await supabase.from('project_members').select('owner_id,status').eq('project_id', COLLAB_PID).eq('member_id', me.id).maybeSingle();
    if (data?.owner_id) {
      owner = data.owner_id as string;
      if (data.status === 'invited') await respondToInvite(owner, COLLAB_PID, true);
    } else await sleep(500);
  }
  if (!owner) {
    log(false, '[tag] meghívás', 'nem érkezett');
    return;
  }
  const pulled = await pullSharedProject(owner, COLLAB_PID);
  if (!pulled) {
    log(false, '[tag] a megosztott projekt letöltése', 'null');
    return;
  }
  await saveProject(pulled);
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  const m = () => st().project?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip | undefined;
  const v = () => st().project?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip | undefined;
  for (let i = 0; i < 1200 && m()?.volume !== 0.4; i++) await sleep(100);
  log(m()?.volume === 0.4, '[tag] a tulaj szerkesztése megérkezett (zene 0,4)', '');
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'v', patch: { pan: -0.5 } });
  for (let i = 0; i < 200 && v()?.audioFx?.reverb !== 0.4; i++) await sleep(50);
  const gotBatch = v()?.audioFx?.reverb === 0.4 && st().project?.trackMix?.music?.gain === 0.5;
  log(gotBatch, '[tag] a tulaj köteg-szerkesztése (zengés + sáv-hangerő) megérkezett', '');
  for (let i = 0; i < 200 && v()?.audioFx?.reverb === 0.4; i++) await sleep(50);
  log(!v()?.audioFx?.reverb && st().project?.trackMix?.music?.gain !== 0.5, '[tag] a tulaj visszavonása nálam is visszavonta', '');
  await sleep(2500);
  log(null, '[tag] ujjlenyomat a végén', fingerprint(st().project));
  await sleep(5000);
  router.back();
}

/** 🧹 a T10 tesztadatának törlése az app saját útján (tulaj: tagságok + felhős projekt + helyi; tag: helyi másolat) */
async function smokeCollabCleanup(log: Log) {
  const me = useAuth.getState().user;
  if (!me || !supabase) {
    log(false, 'fiók', 'nincs');
    return;
  }
  const { data: rows } = await supabase.from('project_members').select('owner_id,member_id,role').eq('project_id', COLLAB_PID);
  const mine = (rows ?? []).filter((r) => r.owner_id === me.id);
  if (mine.length > 0) {
    for (const r of mine.filter((x) => x.member_id !== me.id)) await removeMember(me.id, COLLAB_PID, r.member_id as string);
    await removeMember(me.id, COLLAB_PID, me.id);
  }
  // a felhős példány (a saját sor) mindig — egy félbeszakadt takarítás után is
  const cloud = await deleteCloudProject(COLLAB_PID).catch((caught) => { logCaught('lib/imageSmoke.tsx:cleanup', caught); return false; });
  log(null, 'felhős példány törlése', String(cloud));
  await deleteProject(COLLAB_PID).catch((caught) => logCaught('lib/imageSmoke.tsx:cleanup', caught));
  const { data: left } = await supabase.from('project_members').select('member_id').eq('project_id', COLLAB_PID);
  log(mine.length === 0 || (left ?? []).length === 0, `${me.email}: a tesztprojekt tagságai és a helyi példány törölve`, `maradt tagság-sor (látható): ${(left ?? []).length}`);
}

/** 🌐🔊 R1: távoli (http) forrású klip +6 dB-lel — a motor átveszi (letöltve a cache-be), az élő mérés −14 LUFS (a tartalék lejátszó nem erősítene). */
async function smokeRemoteGain(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const url = `${smokeFileHost()}/gain_ref12.wav`;
  const id = 'prj_smoke_remotegain';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:remotegain', caught));
  const base = createEmptyProject('smoke távoli klip', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'r', uri: url, label: 'távoli', start: 0, duration: 12, trimIn: 0, sourceDuration: 12, volume: dbToVolume(6), fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  const t0 = Date.now();
  for (let i = 0; i < 100 && !previewLocalUri(url); i++) await sleep(100);
  log(!!previewLocalUri(url), 'a távoli forrás letöltve az előnézeti cache-be (nem a projekt-mappába)', `${Date.now() - t0} ms`);
  // a lejátszás AZONNAL a megnyitás után (a motor még indulhat) — a tartalék → motor átváltás nem állíthatja le
  const stops: string[] = [];
  const origSet = st().setPlaying;
  useEditorStore.setState({
    setPlaying: (p: boolean) => {
      if (!p) stops.push((new Error().stack ?? '').split('\n').slice(1, 6).map((l) => l.trim().replace(/\(.*\)/, '')).join(' < '));
      origSet(p);
    },
  });
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 60 && !previewEngine.isPlaying(); i++) await sleep(50);
  const onEngine = previewEngine.isPlaying();
  const probe: string[] = [];
  for (let i = 0; i < 19; i++) {
    await sleep(200);
    if (i % 4 === 0) probe.push(`${(st().playhead).toFixed(2)}:${st().isPlaying ? 'P' : '-'}${previewEngine.isPlaying() ? 'E' : '-'}`);
  }
  const r = previewEngine.loudness();
  log(null, 'állapot lejátszás közben (lejátszófej:transzport/motor)', probe.join(' '));
  log(null, 'ki állította le', stops.slice(0, 2).join(' || ') || '—');
  useEditorStore.setState({ setPlaying: origSet });
  st().setPlaying(false);
  const wf = await getWaveform(url, { userInitiated: true });
  log(!!wf && wf.peaks.length >= 12 * 64 - 2, 'a távoli klipnek is van hullámformája (a helyi másolatból)', `${wf?.peaks.length ?? 0} csúcs`);
  log(onEngine && !!r && Math.abs(r.shortTerm - -14) <= 0.1, 'a távoli klipet a motor játssza, a +6 dB hallható: −20 dBFS → élő −14 ± 0,1 LUFS', r ? `S ${r.shortTerm.toFixed(2)} LUFS, TP ${r.truePeak.toFixed(2)} dBTP` : `motor ${onEngine}`);
  router.back();
}

/** 🔒 R2 tulaj (iPad): megosztja a hang-projektet, zárolja a zenét, majd felold; ellenőrzi, hogy a tag zene-szerkesztése csak feloldás után jön át. */
async function smokeLockOwner(log: Log) {
  const me = useAuth.getState().user;
  if (!me) return;
  const base = createEmptyProject('smoke közös zár', '9:16', undefined, 'audio');
  const tone = toneWav('smoke_lock_tone.wav', 6);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'm', uri: tone, label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over });
  const project: Project = { ...base, id: COLLAB_PID, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [ac({})] } : t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd', duration: 3 })] } : t)) };
  await saveProject(project);
  await ensureShared(project);
  await inviteMember({ ownerId: me.id, projectId: COLLAB_PID, projectName: project.name, email: 'h3nz3l@gmail.com', role: 'editor' }).catch((e: Error) => log(null, '[tulaj] meghívás', e.message));
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  for (let i = 0; i < 240 && useCollabLive.getState().participants.length === 0; i++) await sleep(500);
  log(useCollabLive.getState().participants.length > 0, '[tulaj] a társ a szobában', '');
  await sleep(2000);
  st().toggleTrackFlag('music', 'lock');
  log(null, '[tulaj] zene zárolva', '');
  const m = () => st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
  const v = () => st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  for (let i = 0; i < 300 && v().pan !== -0.3; i++) await sleep(50);
  await sleep(1500);
  log(v().pan === -0.3 && m().volume === 1, '[tulaj] zárolt zene: a tag zene-szerkesztése NEM jött át, a beszéd-szerkesztése igen', `zene ${m().volume}, beszéd pan ${v().pan}`);
  st().toggleTrackFlag('music', 'lock');
  log(null, '[tulaj] zene feloldva', '');
  for (let i = 0; i < 300 && m().volume !== 0.25; i++) await sleep(50);
  log(m().volume === 0.25, '[tulaj] feloldás után a tag zene-szerkesztése átjött', `zene ${m().volume}`);
  await sleep(2500);
  log(null, '[tulaj] ujjlenyomat a végén', fingerprint(st().project));
  log(null, '[tulaj] sávok', trackDump(st().project));
  log(null, '[tulaj] a kapott távoli parancsok', st().events.filter((e) => e.actor === 'remote').map((e) => `${e.command.type}${'clipId' in e.command ? `:${(e.command as { clipId: string }).clipId}` : ''}`).join(', ') || '—');
  await sleep(4000);
  router.back();
}

/** 🔒 R2 tag (iPhone): a tulaj zárolása nála is zár; a zárolt sávra írás nem megy át, a többi igen; feloldás után a zene is. */
async function smokeLockMember(log: Log) {
  const me = useAuth.getState().user;
  if (!me || !supabase) return;
  let owner: string | null = null;
  for (let i = 0; i < 240 && !owner; i++) {
    const { data } = await supabase.from('project_members').select('owner_id,status').eq('project_id', COLLAB_PID).eq('member_id', me.id).maybeSingle();
    if (data?.owner_id) {
      owner = data.owner_id as string;
      if (data.status === 'invited') await respondToInvite(owner, COLLAB_PID, true);
    } else await sleep(500);
  }
  if (!owner) {
    log(false, '[tag] meghívás', 'nem érkezett');
    return;
  }
  const pulled = await pullSharedProject(owner, COLLAB_PID);
  if (!pulled) return;
  await saveProject(pulled);
  router.push(`/studio/audio/${COLLAB_PID}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== COLLAB_PID; i++) await sleep(200);
  for (let i = 0; i < 1200 && !st().lockedTracks.includes('music'); i++) await sleep(100);
  log(st().lockedTracks.includes('music'), '[tag] a tulaj zárolása nálam is zár (zene)', st().lockedTracks.join(',') || '—');
  const okMusic = st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.25 } });
  const okPan = st().dispatch({ type: 'UPDATE_CLIP', clipId: 'v', patch: { pan: -0.3 } });
  log(null, '[tag] a beszéd pan helyben', `dispatch → ${okPan}, pan most ${(st().project?.tracks.find((t) => t.type === 'voiceover')?.clips[0] as AudioClip | undefined)?.pan}`);
  log(!okMusic, '[tag] a zárolt zenére írás nálam is no-op', `dispatch → ${okMusic}`);
  for (let i = 0; i < 600 && st().lockedTracks.includes('music'); i++) await sleep(100);
  log(!st().lockedTracks.includes('music'), '[tag] a feloldás nálam is felold', '');
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.25 } });
  await sleep(3000);
  log(null, '[tag] ujjlenyomat a végén', fingerprint(st().project));
  log(null, '[tag] sávok', trackDump(st().project));
  await sleep(4000);
  router.back();
}

/** 🔒 R2 egy eszközön (prod nélkül): a sáv-zár a projekt része — mentés + újratöltés után is zár, a zárolt sávra írás no-op. */
async function smokeLockPersist(log: Log) {
  const id = 'prj_smoke_lockpersist';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:lockpersist', caught));
  const base = createEmptyProject('smoke zár mentése', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', uri: toneWav('smoke_lockp.wav', 4), label: 'zene', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(800);
  st().toggleTrackFlag('music', 'lock');
  const blocked = !st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } });
  log(st().project?.lockedTracks?.includes('music') === true && blocked, 'zárolás: a projektben (parancs-buszon), a zárolt sávra írás no-op', `lockedTracks ${JSON.stringify(st().project?.lockedTracks)}`);
  await saveProject(st().project!);
  router.back();
  await sleep(1200);
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(800);
  log(st().lockedTracks.includes('music') && !st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } }), 'újranyitás után is zárolt (a mentett projektből)', st().lockedTracks.join(','));
  log(true, 'FOTÓZHATÓ', 'a zárolt zene-sáv (lakat) újranyitás után');
  await sleep(2500);
  st().toggleTrackFlag('music', 'lock');
  log(st().dispatch({ type: 'UPDATE_CLIP', clipId: 'm', patch: { volume: 0.3 } }), 'feloldás után írható', '');
  router.back();
}

/** 🔀 R3 effekt-sorrend: kompresszor→zengés vs. zengés→kompresszor mérhetően más, az élő előnézet = az export (az adott sorrendben), egy undo. */
async function smokeFxOrder(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 0,25 s-os hangos ütések 1 s-onként (a zengés farka a csendben látszik)
  const x = Float32Array.from({ length: 10 * SR }, (_, i) => ((i / SR) % 1 < 0.25 ? 0.6 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0));
  const f = new File(Paths.document, 'smoke_fxorder.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_fxorder';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fxorder', caught));
  const base = createEmptyProject('smoke effekt-sorrend', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: f.uri, label: 'ütések', start: 0, duration: 10, trimIn: 0, sourceDuration: 10, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: { compressor: true, reverb: 0.8 } };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const render = async (name: string) => {
    const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  // a zengés farkának energiája (az ütések utáni csendben, 0,3–0,9 s)
  const tail = (y: Float32Array) => {
    let e = 0;
    for (let k = 1; k < 9; k++) for (let i = Math.round((k + 0.3) * SR); i < Math.round((k + 0.9) * SR); i++) e += y[i] * y[i];
    return 10 * Math.log10(e / (8 * 0.6 * SR) + 1e-20);
  };
  const a = await render('smoke_fxo_a.wav');
  const before = JSON.stringify(st().project);
  st().dispatch({ type: 'UPDATE_CLIP', clipId: 'k', patch: { audioFx: { compressor: true, reverb: 0.8, order: moveStage(undefined, 'reverb', -1) } } });
  st().selectClip('k');
  runDevAction('audio.editClip');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a klipszerkesztőben az effekt-sorrend (zengés a kompresszor előtt)');
  await sleep(2500);
  runDevAction('clipEdit.done');
  const b = await render('smoke_fxo_b.wav');
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
  log(d > 0.01 && Math.abs(tail(a) - tail(b)) > 1, 'a sorrend számít: kompresszor→zengés vs. zengés→kompresszor mérhetően más (a zengés farka)', `max eltérés ${d.toFixed(3)}, farok ${tail(a).toFixed(1)} vs ${tail(b).toFixed(1)} dB`);
  // az élő előnézet a választott sorrendben = az export (short-term LUFS)
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(4000);
  const live = previewEngine.loudness();
  const pos = st().playhead;
  st().setPlaying(false);
  // ugyanaz a mérő (short-term, kapu nélküli 3 s) az export ugyanazon pontjáig
  const end = Math.round(pos * SR);
  const meter = new LiveLoudness(SR);
  meter.push(0, b.subarray(0, end), b.subarray(0, end));
  const ref = meter.readAt(end).shortTerm;
  log(!!live && Math.abs(live.shortTerm - ref) <= 0.5, 'az élő előnézet a választott sorrendben szól: a short-term = az export ugyanazon 3 s-a (± 0,5 LU)', live ? `élő ${live.shortTerm.toFixed(2)} vs export ${ref.toFixed(2)} LUFS` : 'null');
  st().undo();
  log(JSON.stringify(st().project) === before, 'egy visszavonás: az alap sorrend', '');
  router.back();
}

/** 🗜️🔥 R4 master-kompresszor + szaturáció: a hangos/halk különbség csökken, megjelenik a 3. felharmonikus; az élő előnézet = az export. */
async function smokeMasterDyn(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 1 kHz, 1 s-onként váltva −6 / −26 dBFS (20 dB különbség)
  const x = Float32Array.from({ length: 8 * SR }, (_, i) => (Math.floor(i / SR) % 2 === 0 ? 0.5 : 0.05) * Math.sin((2 * Math.PI * 1000 * i) / SR));
  const f = new File(Paths.document, 'smoke_masterdyn.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_masterdyn';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:masterdyn', caught));
  const base = createEmptyProject('smoke master-dinamika', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: f.uri, label: 'jel', start: 0, duration: 8, trimIn: 0, sourceDuration: 8, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const render = async (name: string) => {
    const { uri: out } = await exportOfflineWav(st().project!, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0).slice();
    new File(out).delete();
    return y;
  };
  const rmsDb = (y: Float32Array, a: number, b: number) => {
    let e = 0;
    for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) e += y[i] * y[i];
    return 10 * Math.log10(e / ((b - a) * SR) + 1e-20);
  };
  // a hangos (2. s) és a halk (3. s) rész különbsége (a beállás után)
  const spread = (y: Float32Array) => rmsDb(y, 2.3, 2.9) - rmsDb(y, 3.3, 3.9);
  const goertzel = (y: Float32Array, hz: number, a: number, n: number) => {
    const w = (2 * Math.PI * hz) / SR;
    const cw = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = a; i < a + n; i++) {
      const s0 = y[i] + cw * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    return Math.sqrt(s1 * s1 + s2 * s2 - cw * s1 * s2);
  };
  const h3 = (y: Float32Array) => 20 * Math.log10(goertzel(y, 3000, Math.round(2.3 * SR), 22050) / Math.max(1e-12, goertzel(y, 1000, Math.round(2.3 * SR), 22050)));
  const master = { ...masterPreset('youtube'), target: 'custom' as const };
  st().dispatch({ type: 'SET_AUDIO_MASTER', audioMaster: master });
  const plain = await render('smoke_md_a.wav');
  st().dispatch({ type: 'SET_AUDIO_MASTER', audioMaster: { ...master, compressor: { threshold: -24, ratio: 4 }, saturation: 0.6 } });
  const dyn = await render('smoke_md_b.wav');
  log(spread(plain) > 19 && spread(dyn) < spread(plain) - 6, 'master-kompresszor: a hangos/halk különbség érezhetően csökken', `${spread(plain).toFixed(1)} → ${spread(dyn).toFixed(1)} dB`);
  log(h3(plain) < -60 && h3(dyn) > -40, 'szaturáció: megjelenik a 3. felharmonikus (3 kHz)', `${h3(plain).toFixed(1)} → ${h3(dyn).toFixed(1)} dB (az alaphanghoz)`);
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(4000);
  const live = previewEngine.loudness();
  const pos = st().playhead;
  st().setPlaying(false);
  const end = Math.round(pos * SR);
  const meter = new LiveLoudness(SR);
  meter.push(0, dyn.subarray(0, end), dyn.subarray(0, end));
  const ref = meter.readAt(end).shortTerm;
  log(!!live && Math.abs(live.shortTerm - ref) <= 0.5, 'az élő előnézet a kompresszorral és a szaturációval szól: = az export (± 0,5 LU)', live ? `élő ${live.shortTerm.toFixed(2)} vs export ${ref.toFixed(2)} LUFS` : 'null');
  runDevAction('audio.master');
  await sleep(800);
  log(true, 'FOTÓZHATÓ', 'a master-lapon a kompresszor (küszöb, arány) és a szaturáció');
  await sleep(2500);
  router.back();
}

/** 🎧🅰️🅱️ R5 referencia A/B: a referencia (−8 LUFS) a keverés (−20 LUFS) hangosságára illesztve szól, ugyanott, lejátszás közben váltva; a projekt nem változik. */
async function smokeRefAB(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const write = (name: string, amp: number, hz: number) => {
    const x = Float32Array.from({ length: 14 * SR }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
    const f = new File(Paths.cache, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  const mixUri = write('smoke_ref_mix.wav', 0.1, 1000);
  const refUri = write('smoke_ref_song.wav', 0.4, 440);
  const id = 'prj_smoke_refab';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:refab', caught));
  const base = createEmptyProject('smoke referencia', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'k', uri: mixUri, label: 'keverés', start: 0, duration: 14, trimIn: 0, sourceDuration: 14, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const before = JSON.stringify(st().project);
  // a felület útja: a referencia mérése + a keverés hangossága (ugyanazok a függvények)
  const m = await measureReference(refUri);
  const mixStats = await measureMastered(st().project!, { isTrackAudible: st().isTrackAudible, masterVolume: st().masterVolume });
  log(!!m && Math.abs(m.lufs - -8) <= 1 && !!mixStats && Math.abs(mixStats.lufs - -20) <= 0.3, 'a referencia és a keverés hangossága mérve', `referencia ${m?.lufs.toFixed(2)} LUFS, keverés ${mixStats?.lufs.toFixed(2)} LUFS`);
  if (!m || !mixStats) return;
  await applyReference({ uri: refUri, name: 'referencia', ...m });
  useReference.getState().setMixLufs(mixStats.lufs);
  st().setPlayhead(0);
  st().setPlaying(true);
  for (let i = 0; i < 40 && !previewEngine.isPlaying(); i++) await sleep(50);
  await sleep(3600);
  const a = previewEngine.loudness();
  const headA = st().playhead;
  useReference.getState().setListening(true);
  await sleep(3600);
  const b = previewEngine.loudness();
  const headB = st().playhead;
  log(true, 'FOTÓZHATÓ', 'B: a referencia szól (a master-lapon)');
  useReference.getState().setListening(false);
  await sleep(300);
  st().setPlaying(false);
  log(!!a && !!b && Math.abs(a.shortTerm - mixStats.lufs) <= 0.5 && Math.abs(b.shortTerm - mixStats.lufs) <= 0.5, 'A: a keverés, B: a referencia — mindkettő a keverés hangosságán (± 0,5 LU); illesztés nélkül a B 12 dB-lel hangosabb volna', a && b ? `A ${a.shortTerm.toFixed(2)} · B ${b.shortTerm.toFixed(2)} LUFS (a referencia saját: ${m.lufs.toFixed(1)})` : 'null');
  log(headB > headA + 3, 'a váltás nem ugrik vissza: a lejátszás ugyanott folytatódik', `${headA.toFixed(2)} → ${headB.toFixed(2)} s`);
  log(JSON.stringify(st().project) === before, 'a projekt nem változott', '');
  useReference.getState().setRef(null);
  router.back();
}

/** 🎵 R6 hang-poszt remixe: a poszt videójának hangja kinyerve → hang-projekt (a Hang Stúdióban nyílik), a forrás megjelölve. Prod nélkül: szintetikus poszt a teszt-szerver videójával. */
async function smokeAudioRemix(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const post = { id: 'post_smoke_audio', title: 'Hang-poszt', description: '', hashtags: [], videoUri: `${smokeFileHost()}/vid_audio.mp4`, posterUri: null, aspectRatio: '9:16', durationSec: 6, projectId: 'orig_audio', rendered: true, remixable: true, sourceKind: 'audio', visibility: 'public', moderationStatus: 'approved', createdAt: new Date().toISOString(), counts: { likes: 0, comments: 0, shares: 0, saves: 0, views: 0, remixes: 0 }, creator: { id: 'c', username: 'kata', displayName: 'Kata' } } as unknown as FeedPost;
  const t0 = Date.now();
  const pid = await remixFromPost(post);
  const p = pid ? await loadProject(pid) : null;
  const clip = p?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip | undefined;
  log(!!p && p.kind === 'audio' && !!clip && clip.uri.endsWith('.m4a') && new File(clip.uri).exists && Math.abs(clip.duration - 6) <= 1 / 30 && p.remixOf?.postId === post.id, 'a hang-poszt remixe hang-projekt: a videó hangja M4A-ként, a forrás megjelölve', `${p?.kind}, ${clip?.duration.toFixed(3)} s, ${clip?.uri.split('/').pop()}, ${Date.now() - t0} ms`);
  if (!pid || !p) return;
  const route = remixRoute(post, pid);
  router.push(route as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== pid; i++) await sleep(200);
  await sleep(800);
  log(route === `/studio/audio/${pid}` && st().project?.id === pid, 'a Hang Stúdióban nyílik meg', route);
  log(true, 'FOTÓZHATÓ', 'a hang-remix a Hang Stúdióban');
  await sleep(2500);
  router.back();
  await deleteProject(pid).catch((caught) => logCaught('lib/imageSmoke.tsx:audioremix', caught));
}

/** 🎚️ Keverőpult tableten: függőleges faderek egymás mellett (képernyőkép), a fader akadálymentes állítása. */
async function smokeConsole(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_console';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:console', caught));
  const base = createEmptyProject('smoke keverőpult', '9:16', undefined, 'audio');
  const uri = toneWav('smoke_console.wav', 4);
  const ac = (cid: string): AudioClip => ({ kind: 'audio', id: cid, label: cid, uri, start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, trackMix: { music: { gain: 0.5 }, voiceover: { gain: 1 }, sfx: { gain: 0.25 } }, tracks: base.tracks.map((t) => (['music', 'voiceover', 'sfx'].includes(t.type) ? { ...t, clips: [ac(t.type)] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.mixer');
  await sleep(1200);
  log(Dimensions.get('window').width >= 700, 'tablet-szélesség: keverőpult-nézet', `${Dimensions.get('window').width} pt`);
  log(true, 'FOTÓZHATÓ', 'a keverőpult: zene −6 dB, beszéd 0 dB, effekt −12 dB függőleges faderen');
  await sleep(3000);
  router.back();
}

/** ✋✂️↔️ Érintéses módok (Android emulátoron valódi adb-koppintással/-húzással): vágás, kijelölés, mozgatás; nagy sávok. */
/**
 * ♿ S8 (AUDIO-PROD): minden hang-vezérlőnek van neve a képernyőolvasónak. A Hang Stúdió lapjai
 * SORBAN nyitva maradnak; mindegyiknél `READY <név>` → a héj (`adb shell uiautomator dump`) a
 * `content-desc`/`text` mezőket menti és a címkézetlen érinthető elemeket számolja. A statikus
 * őrteszt (`a11yGuard.test.ts`) a forrást zárja, ez a VALÓDI natív a11y-fát.
 */
async function smokeA11y(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_a11y';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:a11y', caught));
  const base = createEmptyProject('smoke a11y', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_a11y.wav', 4), start: 1, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  runDevAction('audio.fit');
  const HOLD = 8000;
  const views: string[] = [];
  const hold = async (name: string, open?: string, close?: string) => {
    if (open) {
      runDevAction(open);
      await sleep(900);
    }
    log(null, 'READY', name);
    views.push(name);
    await sleep(HOLD);
    if (close) {
      runDevAction(close);
      await sleep(500);
    }
  };
  try {
    await hold('studio');
    await hold('drums', 'audio.openDrums', 'audio.closeDrums');
    await hold('pianoroll', 'audio.openPianoRoll', 'audio.closePianoRoll');
    await hold('sampler', 'audio.openSampler', 'audio.closeSampler');
    await hold('master', 'audio.master', 'audio.closeMaster');
    await hold('mixer', 'audio.mixer', 'audio.closeMixer');
    await hold('addmedia', 'audio.openAddMedia', 'audio.closeAddMedia');
    await hold('tts', 'audio.openTts', 'audio.closeTts');
    st().selectClip('c');
    await sleep(200);
    await hold('clipedit', 'audio.editClip', 'clipEdit.done');
    log(true, 'a lapok sorban nyitva voltak (a címkéket a héj a uiautomator-dumpból számolja)', views.join(', '));
  } finally {
    router.back();
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:a11y-del', caught));
  }
}

/**
 * 🔗 C2 (ReMix.md 5.3 mérce): a hang-projekt → videó HIVATKOZÁSSAL; a zene módosítása után a videóban
 * „Frissítés elérhető”, egy koppintás = az új mixdown (egy köteg), egy visszavonás; a hossz-szabály.
 * Újraimport és kézi szinkron nélkül, felhő nélkül.
 */
async function smokeLinkedMix(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const rms = (a: Float32Array) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / Math.max(1, a.length));
  };
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  const audioId = 'prj_smoke_linked_audio';
  let videoId: string | null = null;
  await deleteProject(audioId).catch((caught) => logCaught('lib/imageSmoke.tsx:linkedmix', caught));
  const base = createEmptyProject('smoke dal', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_linked.wav', 3), start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const audio: Project = { ...base, id: audioId, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  await saveProject(audio);
  const st = useEditorStore.getState;
  try {
    // 📊 C5: tiszta napló; a Hang Stúdió megnyitása = a lánc 1. stúdiója (az útvonal naplózza)
    await clearCswcrLog();
    router.push(`/studio/audio/${audioId}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== audioId; i++) await sleep(200);
    await sleep(800);
    router.back();
    await sleep(600);
    // 1) küldés hivatkozással egy ÚJ videó-projektbe (a menü „Új videó — hivatkozással” útja)
    const video = await sendMixdownToVideo(audio, null, { newName: 'smoke klip' });
    videoId = video?.id ?? null;
    const asset = video ? linkedAssets(video)[0] : undefined;
    const v0 = mixdownVersion(audio);
    log(!!video && !!asset && asset.source?.projectId === audioId && asset.source.version === v0 && asset.source.output === 'mixdown', 'a videó a hang-projekt mixdownjára hivatkozik (verzióval), nem a sávok másolatára', `verzió ${asset?.source?.version}, ${video?.tracks.find((t) => t.type === 'music')?.clips.length} klip`);
    if (!video) throw new Error('nincs videó');
    const vClip0 = video.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
    const rms0 = rms(await left(vClip0.uri));
    // 2) a zene módosul a Hang Stúdióban (hangerő 0,5 → 1) és mentődik — a videó még nem tud róla
    const changed = applyCommand(audio, { type: 'UPDATE_CLIP', clipId: 'c', patch: { volume: 1 } })!;
    await saveProject(changed);
    log(mixdownVersion(changed) !== v0 && mixdownVersion({ ...changed, name: 'más' } as Project) === mixdownVersion(changed), 'a hang módosítása új kimenet-verziót ad (a név nem)', `${v0} → ${mixdownVersion(changed)}`);
    // 3) a videó megnyitása → a „Frissítés elérhető” sáv (helyben, felhő nélkül)
    router.push(`/editor/${video.id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== video.id; i++) await sleep(200);
    await sleep(1500);
    const stale = await waitFor(() => ((runDevAction('linked.stale') as string[] | undefined)?.length ?? 0) === 1, 10000);
    // a forrás TÁROLT (betöltött, mappába vett) verziója = a memóriabeli — a mentés nem adhat hamis frissítést
    const storedVersion = await sourceVersionOf(audioId);
    log(stale && storedVersion === mixdownVersion(changed), '„Frissítés elérhető”: a videó észleli a forrás új verzióját (a tárolt verzió = a tartalomé)', `${JSON.stringify(runDevAction('linked.stale'))}, tárolt ${storedVersion}`);
    log(true, 'FOTÓZHATÓ', 'a „Frissítés elérhető” sáv a videó-szerkesztő tetején');
    await sleep(1500);
    // 4) egy koppintás: az új mixdown (2× hangosabb), a verzió a forrásé, egy köteg
    const clips = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
    const loadedUri = clips()[0].uri; // a betöltött (mappába vett) fájl — ehhez képest mérjük a cserét és a visszavonást
    await runDevAction('linked.update');
    const updated = await waitFor(() => clips()[0]?.uri !== loadedUri, 30000);
    const vClip1 = clips()[0];
    const asset1 = st().project!.assets.find((a) => a.id === vClip1.assetId);
    const rms1 = rms(await left(vClip1.uri));
    log(updated && asset1?.source?.version === storedVersion && Math.abs(rms1 / rms0 - 2) < 0.05, 'egy koppintás: a klip az új mixdownt kapja (2× hangosabb), a verzió a forrásé', `RMS ${rms0.toFixed(4)} → ${rms1.toFixed(4)} (×${(rms1 / rms0).toFixed(3)}), ${asset1?.source?.version}`);
    const cleared = await waitFor(() => ((runDevAction('linked.stale') as string[] | undefined)?.length ?? 0) === 0, 8000);
    log(cleared, 'a sáv eltűnik a frissítés után');
    // 5) egy visszavonás: a régi hang és a régi verzió
    st().undo();
    await sleep(300);
    const vClip2 = clips()[0];
    const asset2 = st().project!.assets.find((a) => a.id === vClip2.assetId);
    log(vClip2.uri === loadedUri && asset2?.source?.version === v0, 'egy visszavonás: a régi mixdown és verzió', `${asset2?.source?.version}`);
    st().redo();
    await sleep(300);
    // 6) hossz-szabály (pure, a mentett videón): rövidebb forrás → a klip vége a forrás végére, jelezve
    const plan = relinkPlan(st().project!, vClip1.assetId!, { uri: vClip1.uri, durationSec: 1.5, version: 'rövid' });
    log(plan.shortened.length === 1 && plan.commands.some((x) => x.type === 'UPDATE_CLIP' && (x.patch as AudioClip).duration === 1.5), 'rövidebb kimenet: a klip vége a forrás végére vágva és jelezve (hosszabb: változatlan)', `${plan.shortened.length} rövidült`);
    // 7) 📊 C5 / F1: a CSWCR a telefonon — a lánc (hang → videó hivatkozással) elkezdett (2 stúdió), a link-arány 1,
    //    a „Frissítés" elfogadása számolva; egy export után befejezett
    logCswcr({ type: 'export', projectId: video.id, kind: 'video' });
    const stats = (await runDevAction('cswcr.stats')) as CswcrStats;
    log(stats.link.link >= 1 && stats.link.copy === 0 && stats.link.ratio === 1, 'CSWCR: az átadás hivatkozás volt (link-arány 1)', `link ${stats.link.link}, másolat ${stats.link.copy}`);
    log(stats.flow.multiStudio >= 1 && stats.flow.started >= 1 && stats.flow.completed >= 1 && stats.flow.relinks >= 1, 'CSWCR: a hang→videó lánc többstúdiós, elkezdett és (export után) befejezett; a frissítés elfogadva', `láncok ${stats.flow.chains}, többstúdiós ${stats.flow.multiStudio}, elkezdett ${stats.flow.started}, befejezett ${stats.flow.completed}, relink ${stats.flow.relinks}, CSWCR ${stats.flow.cswcr?.toFixed(2)}`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(audioId).catch((caught) => logCaught('lib/imageSmoke.tsx:linkedmix-del', caught));
    if (videoId) await deleteProject(videoId).catch((caught) => logCaught('lib/imageSmoke.tsx:linkedmix-del2', caught));
  }
}

async function smokeTouchModes(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_touch';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:touch', caught));
  const base = createEmptyProject('smoke érintés', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_touch.wav', 6), start: 1, duration: 6, trimIn: 0, sourceDuration: 6, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  await sleep(500);
  const clips = () => (st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[]).slice().sort((a, b) => a.start - b.start);
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  // 1) vágás-mód: egy koppintás a klip közepén → két darab (a vágás a koppintás helyén, a rácson)
  useAudioEditMode.getState().setMode('cut');
  log(null, 'READY', 'cut');
  const cut = await waitFor(() => clips().length === 2, 25000);
  const at = cut ? clips()[1].start : NaN;
  log(cut && Math.abs(at - 4) < 0.6 && Math.abs(at * 30 - Math.round(at * 30)) < 1e-6, 'vágás-mód: egy koppintás a klipen → ott vág, a frame-rácson', `${clips().length} darab, vágás ${at.toFixed(3)} s`);
  st().undo();
  await sleep(300);
  // 2) kijelölés-mód: a gyors (hosszú nyomás nélküli) húzás NEM mozdítja a klipet
  useAudioEditMode.getState().setMode('select');
  log(null, 'READY', 'select');
  await sleep(6000);
  log(clips().length === 1 && clips()[0].start === 1, 'kijelölés-mód: a gyors húzás nem mozdítja a klipet (véletlen mozgatás ellen)', `kezdet ${clips()[0].start} s`);
  // 3) mozgatás-mód: ugyanez a húzás azonnal mozgat
  useAudioEditMode.getState().setMode('move');
  log(null, 'READY', 'move');
  const moved = await waitFor(() => clips()[0].start !== 1, 25000);
  log(moved && clips()[0].start > 1.5, 'mozgatás-mód: a gyors húzás azonnal mozgatja a klipet', `kezdet 1 → ${clips()[0].start.toFixed(3)} s`);
  st().undo();
  useAudioEditMode.getState().setMode('select');
  // 4) nagy sávok
  if (!useAudioEditMode.getState().large) useAudioEditMode.getState().toggleLarge();
  await sleep(500);
  log(true, 'FOTÓZHATÓ', 'nagy sávok (nagyobb hullámforma), a módváltó gombok a transzporton');
  await sleep(3000);
  useAudioEditMode.getState().toggleLarge();
  router.back();
}

/** ⬇️ Modell-letöltés fájlba (nem memóriába): a 181 MB-os Whisper small újratöltve, ellenőrizve; hibás checksum → elutasítva, nincs maradék. */
async function smokeModelDownload(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const entry = catalogEntry('whisper-small-q5')!.manifest!;
  removeModel('whisper-small-q5');
  const t0 = Date.now();
  const res = await downloadModel(entry);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(res.ok && res.sizeBytes === entry.sizeBytes && !!res.uri && new File(res.uri).exists, 'a 181 MB-os modell fájlba töltve, a mérete pontos, a checksum egyezik', res.ok ? `${res.sizeBytes} B, ${dt} s` : `${res.reason}`);
  const smoke = res.ok ? await runWhisperSmokeTest('whisper-small-q5') : false;
  log(smoke && bestUsableWhisperModelId() === 'whisper-small-q5', 'a letöltött modell fut (próba) és ez lett a legjobb', `${bestUsableWhisperModelId()}`);
  // hibás checksum: elutasítva, a félkész fájl sem marad
  const tiny = catalogEntry('whisper-tiny-q8')!.manifest!;
  const bad = await downloadModel({ ...tiny, id: 'smoke-bad', sha256: '0'.repeat(64) });
  const leftovers = (listCachedModels().some((m) => m.id === 'smoke-bad') ? 1 : 0) + (new File(Paths.document, 'models', 'smoke-bad-1.0.0.bin.part').exists ? 1 : 0);
  log(!bad.ok && bad.reason === 'checksum' && leftovers === 0, 'hibás checksum: elutasítva, nincs maradék fájl', `${bad.ok ? 'ok?!' : bad.reason}, maradék ${leftovers}`);
}

/** 🎚️🤖 Mixjavaslat és mastering-segéd: egy rossz keverés javaslatai, alkalmazás után eltűnnek; a master eléri a célt. */
async function smokeMixAssist(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  // a beszéd: nagy dinamikájú (váltakozó hangos/halk mondatok), zajos és dübörgő
  const voice = Float32Array.from({ length: 13 * SR }, (_, i) => {
    const t = i / SR;
    const on = t % 1.3 < 1;
    const lvl = Math.floor(t / 1.3) % 2 === 0 ? 0.4 : 0.04;
    let v = on ? lvl * (0.6 * Math.sin(2 * Math.PI * 150 * t) + 0.3 * Math.sin(2 * Math.PI * 450 * t) + 0.15 * Math.sin(2 * Math.PI * 1200 * t)) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0;
    return v + 0.2 * Math.sin(2 * Math.PI * 35 * t) + 0.01 * rnd();
  });
  const musicPcm = Float32Array.from({ length: 13 * SR }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / SR));
  const write = (name: string, x: Float32Array) => {
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, x], SR, () => 0.5));
    return f.uri;
  };
  const vUri = write('smoke_mix_voice.wav', voice);
  const mUri = write('smoke_mix_music.wav', musicPcm);
  const id = 'prj_smoke_mixassist';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:mixassist', caught));
  const base = createEmptyProject('smoke mixjavaslat', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', uri: vUri, start: 0, duration: 13, sourceDuration: 13, id: 'x', ...over });
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'm', label: 'zene', uri: mUri })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const t0 = Date.now();
  runDevAction('audio.mixAssist');
  let keys: string[] = [];
  for (let i = 0; i < 120 && keys.length === 0; i++) {
    await sleep(250);
    keys = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  }
  const ms = Date.now() - t0;
  const want = ['duckMusic', 'compressVoice', 'highpassVoice', 'denoiseVoice'];
  log(want.every((k) => keys.includes(k)), 'a rossz keverés javaslatai: zene a beszéd alatt, dinamika, dübörgés, zaj', `${keys.join(', ')} (${ms} ms)`);
  log(true, 'FOTÓZHATÓ', 'a mixjavaslat-lap a javaslatokkal és a mastering-segéddel');
  await sleep(3000);
  const n = runDevAction('mixAssist.applyAll') as number;
  const v = st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  const m = st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip;
  log(n >= 4 && m.autoDuck === true && !!v.audioFx?.compressor && v.audioFx?.highpass === 80 && !!v.audioFx?.denoise, 'mind alkalmazva (egy visszavonás): halkítás, kompresszor, felüláteresztő, zajszűrés', `${n} parancs`);
  await runDevAction('mixAssist.reanalyze');
  await sleep(600); // a lap újrarajzol (a javaslat-lista a render után frissül)
  const after = (runDevAction('mixAssist.suggestions') as string[]) ?? [];
  log(!['duckMusic', 'compressVoice', 'highpassVoice', 'denoiseVoice'].some((k) => after.includes(k)), 'újramérés: az alkalmazott javaslatok nem térnek vissza', after.join(', ') || '—');
  runDevAction('mixAssist.targetSpotify');
  await sleep(200);
  const res = (await runDevAction('mixAssist.applyMaster')) as { stats: { lufs: number; peak: number }; lufs: number; tp: number } | null;
  const peakDb = res ? 20 * Math.log10(res.stats.peak) : 99;
  log(!!res && Math.abs(res.stats.lufs - -14) <= 1 && peakDb <= -1 + 0.3 && st().project!.audioMaster?.target === 'spotify', 'mastering-segéd (Spotify): alkalmazás után a mérés −14 ± 1 LUFS, csúcs ≤ −1 dBFS', res ? `${res.stats.lufs.toFixed(2)} LUFS, csúcs ${peakDb.toFixed(2)} dBFS` : 'null');
  st().undo();
  st().undo();
  log(!st().project!.audioMaster && !(st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).autoDuck, 'két visszavonás: a master és a javaslatok is vissza', '');
  runDevAction('audio.mixAssistClose');
  router.back();
}

/** 🎙️🤖 Hang-asszisztens: beírt mondat → lépések → végrehajtás egy undo-ban; kimondott parancs a Whisperrel → ugyanaz. */
async function smokeAudioAssistant(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_assistant';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:assistant', caught));
  const base = createEmptyProject('smoke asszisztens', '9:16', undefined, 'audio');
  const uri = toneWav('smoke_assist.wav', 8);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri, start: 0, duration: 8, sourceDuration: 8, id: 'x', ...over });
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] } : t.type === 'music' ? { ...t, clips: [ac({ id: 'm', label: 'zene' })] } : t.type === 'sfx' ? { ...t, clips: [ac({ id: 'f', label: 'effekt', start: 2, duration: 1 })] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  runDevAction('audio.assistant');
  await sleep(500);
  const sentence = 'Tegyél zengést a beszédre, halkítsd a zenét 3 dB-lel, halkuljon a zene a beszéd alatt és masterelj Spotify-ra';
  // a sáv felcsatolása (a lassú eszközön 0,5 s-nál tovább tart): addig a beírásnak nincs címzettje
  for (let i = 0; i < 50 && runDevAction('assistant.text') === undefined; i++) await sleep(100);
  for (let k = 0; k < 5 && runDevAction('assistant.text') !== sentence; k++) {
    devTypeAssistant(sentence);
    await sleep(300);
  }
  const tt = i18nT as unknown as (k: string) => string;
  const parsed = parseNow(sentence, tt);
  log(parsed.unknown.length === 0 && parsed.steps.map((x) => x.key).join(',') === 'fxOn,trackGain,duckOn,master', 'a mondat 4 lépésre bomlik, nincs nem értett rész', parsed.steps.map((x) => x.key).join(' · '));
  log(true, 'FOTÓZHATÓ', 'az asszisztens-sáv a felismert lépésekkel');
  await sleep(3000);
  const before = st().project!;
  const n = runDevAction('assistant.apply') as number;
  const p = st().project!;
  const clipOf = (cid: string) => p.tracks.flatMap((x) => x.clips).find((c) => c.id === cid) as AudioClip;
  const ok = clipOf('v').audioFx?.reverb === 0.4 && Math.abs((p.trackMix?.music?.gain ?? 1) - Math.pow(10, -3 / 20)) < 1e-3 && clipOf('m').autoDuck === true && p.audioMaster?.target === 'spotify';
  log(n === 4 && ok, 'végrehajtva: zengés a beszéden, zene −3 dB, a zene halkul a beszéd alatt, Spotify-master', `${n} parancs; gain ${p.trackMix?.music?.gain}, master ${p.audioMaster?.target}`);
  st().undo();
  log(JSON.stringify(st().project!.tracks) === JSON.stringify(before.tracks) && !st().project!.audioMaster && !st().project!.trackMix?.music, 'egyetlen visszavonás mindent visszaállít', '');
  devTypeAssistant('némítsd a zenét');
  await sleep(300);
  runDevAction('assistant.apply');
  log(!st().isTrackAudible('music'), 'művelet: a zene némítva (munkamenet)', '');
  st().toggleTrackFlag('music', 'mute');
  // 🎤 kimondott parancsok: a telefon Whisperje írja át (a mikrofon helyett felolvasott fájl)
  // ellenőrző mondatok: a hu2/hu3/hu5 kimenetére általános tűrés készült; a hu4, hu6, hu7 egyikre sem volt hangolva
  const sig = (r: AudioIntentResult) => [...r.steps.map((x) => (x.key === 'master' ? `master:${x.params?.target}` : x.key)), ...r.actions.map((a) => a.kind)].join(',');
  const cases: [string, string][] = [
    ['cmd_hu.wav', 'fxOn,trackGain'],
    ['cmd_en.wav', 'fxOn,master:spotify'],
    ['cmd_hu2.wav', 'fxOn,master:spotify'],
    ['cmd_hu3.wav', 'duckOn,fadeIn'],
    ['cmd_hu4.wav', 'fxOn,trackGain'],
    ['cmd_hu5.wav', 'master:youtube,marker'],
    ['cmd_hu6.wav', 'fxOn,master:tiktok'],
    ['cmd_hu7.wav', 'trackGain,silence'],
  ];
  let hits = 0;
  for (const [file, expected] of cases) {
    const local = await downloadToCache(`${smokeFileHost()}/${file}`, `smoke_${file}`);
    const t0 = Date.now();
    const r = local ? await transcribeMediaOnDevice(local, { prompt: ASR_HINT }) : null;
    const said = (r?.lines ?? []).map((l) => l.text).join(' ').trim();
    const res = parseNow(said, tt);
    const ok = res.unknown.length === 0 && sig(res) === expected;
    if (ok) hits++;
    // egyenként naplózva (INFO): a felismerés a modell és a hang függvénye, a mérce az arány
    log(null, `kimondott parancs ${ok ? '✓' : '✗'} (${file})`, `„${said}” → ${sig(res)}${res.unknown.length ? ` ?${res.unknown.join('|')}` : ''} (várt: ${expected}; ${Date.now() - t0} ms, ${bestUsableWhisperModelId()})`);
  }
  log(hits >= 7, 'kimondott parancsok: legalább 7/8 helyesen értelmezve (a lépések végrehajtás előtt mindig látszanak)', `${hits}/${cases.length}`);
  devTypeAssistant('');
  router.back();
}

/** 🩺 Hangellenőrzés: egy szándékosan hibás projekt minden hibája a helyén, a hangosság = a WAV-exporté; a jó projekt hibátlan. */
async function smokeAudioCheck(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const wav = (name: string, sec: number, amp: number, invertRight = false) => {
    const x = Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * 330 * i) / SR));
    const f = new File(Paths.document, name);
    if (f.exists) f.delete();
    f.create();
    f.write(encodeWav16([x, invertRight ? x.map((v) => -v) : x], SR, () => 0.5));
    return f.uri;
  };
  const loud = wav('smoke_chk_loud.wav', 3, 0.7);
  const anti = wav('smoke_chk_anti.wav', 2, 0.4, true);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', uri: loud, start: 0, duration: 3, sourceDuration: 3, id: 'x', ...over });
  const id = 'prj_smoke_check';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:check', caught));
  const base = createEmptyProject('smoke hangellenőrzés', '9:16', undefined, 'audio');
  const bad: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'a' }), ac({ id: 'ph', uri: anti, start: 8, duration: 2, sourceDuration: 2 }), ac({ id: 'sl', start: 10.2, duration: 0.05 })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'b', start: 2, duration: 2 }), ac({ id: 'gone', uri: 'file:///nincs/ilyen.wav', start: 4.5, duration: 1 }), ac({ id: 'z', start: 10.5, duration: 1, volume: 0 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'm', start: 10, duration: 2 })] }
            : t
    ),
  };
  await saveProject(bad);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  if (!st().mutedTracks.includes('music')) st().toggleTrackFlag('music', 'mute');
  const t0 = Date.now();
  const issues = ((await runDevAction('audio.runCheck')) as CheckIssue[] | null) ?? [];
  const ms = Date.now() - t0;
  const at = (k: string) => issues.find((i) => i.kind === k);
  const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) <= 0.11;
  log(near(at('clipping')?.start, 2) && near(at('clipping')?.end, 3), 'túlvezérlés a két átfedő hang alatt (2–3 s)', `${at('clipping')?.start?.toFixed(2)}–${at('clipping')?.end?.toFixed(2)} s`);
  log(near(at('silence')?.start, 4) && near(at('silence')?.end, 8), 'hosszú csend (4–8 s: a 4 s-nál véget érő hang és a 8 s-nál induló közt; a hiányzó fájl helyén is)', `${at('silence')?.start?.toFixed(2)}–${at('silence')?.end?.toFixed(2)} s`);
  log(near(at('phase')?.start, 8) && near(at('phase')?.end, 10), 'fázis-kioltás (8–10 s)', `${at('phase')?.start}–${at('phase')?.end} s`);
  log(at('missing')?.start === 4.5 && at('sliver')?.start === 10.2 && at('zeroVolume')?.start === 10.5 && at('muted')?.params?.track === 'music', 'szerkezeti: hiányzó fájl (4,5 s), vágási maradék (10,2 s), néma klip (10,5 s), némított zene-sáv', issues.map((i) => i.kind).join(', '));
  log(issues.findIndex((i) => i.severity === 'warn') > issues.findIndex((i) => i.severity === 'error') && issues.filter((i) => i.severity === 'error').every((i, k, a) => k === 0 || (a[k - 1].start ?? -1) <= (i.start ?? -1)), 'a lista: hibák elöl, időrendben', `${issues.length} tétel, ${ms} ms alatt`);
  log(true, 'FOTÓZHATÓ', 'a hangellenőrzés eredmény-lapja');
  await sleep(3000);
  runDevAction('audio.closeCheck');
  // a mért hangosság = a WAV-exporté (ugyanaz a keverés)
  const mix = mixForExport(st().project!, st().isTrackAudible, st().masterVolume)!;
  const playable = { ...mix, tracks: mix.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== 'gone') })) };
  const out = await exportOfflineWav(playable, new File(projectExportDir(), 'smoke_chk.wav'), undefined, undefined, 'float32');
  const buf = await (await loadAudioApi())!.decodeAudioData(out.uri, SR);
  const ref = integratedLoudness(buf.getChannelData(0), buf.getChannelData(1), SR);
  new File(out.uri).delete();
  const measured = (await runAudioCheck(st().project!, { isTrackAudible: st().isTrackAudible, masterVolume: st().masterVolume, mutedTracks: st().mutedTracks, soloTracks: st().soloTracks })).stats!.lufs;
  log(Math.abs(measured - ref) < 0.01, 'a mért hangosság = a WAV-export hangossága (BS.1770)', `${measured.toFixed(3)} / ${ref.toFixed(3)} LUFS`);
  st().toggleTrackFlag('music', 'mute');
  router.back();
  await sleep(800);
  // a jó projekt (masterrel): nincs hiba
  const id2 = 'prj_smoke_check_ok';
  await deleteProject(id2).catch((caught) => logCaught('lib/imageSmoke.tsx:check2', caught));
  const good: Project = {
    ...base,
    id: id2,
    audioMaster: { target: 'custom', lufs: -16, truePeak: -1, dynamics: 'balanced' },
    tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [ac({ id: 'g', uri: wav('smoke_chk_ok.wav', 6, 0.3), duration: 6, sourceDuration: 6 })] } : t)),
  };
  await saveProject(good);
  router.push(`/studio/audio/${id2}` as Href);
  for (let i = 0; i < 60 && st().project?.id !== id2; i++) {
    await sleep(200);
  }
  await sleep(1000);
  const okIssues = ((await runDevAction('audio.runCheck')) as CheckIssue[] | null) ?? ['x'];
  log(Array.isArray(okIssues) && okIssues.length === 0, 'a rendben lévő, masterelt projektre nincs hiba', JSON.stringify(okIssues));
  runDevAction('audio.closeCheck');
  router.back();
}

/** ⭐ A klipszerkesztő presetsora (képernyőkép): beépített presetek alatt a saját. */
async function smokePresetPhoto(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const backup = await AsyncStorage.getItem(USER_PRESETS_KEY);
  try {
    await AsyncStorage.removeItem(USER_PRESETS_KEY);
    useUserPresets.setState({ list: [], loaded: false });
    await useUserPresets.getState().save('clipFx', 'Meleg hang', { compressor: true, eq: { low: 2, mid: 0, high: -1 } });
    await useUserPresets.getState().save('clipFx', 'Termi beszéd', { reverb: 0.5, highpass: 90 });
    const id = 'prj_smoke_presetphoto';
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:presetphoto', caught));
    const base = createEmptyProject('smoke preset-sor', '9:16', undefined, 'audio');
    const vo: AudioClip = { kind: 'audio', id: 'vo', label: 'hang', uri: toneWav('smoke_presetphoto.wav', 3), start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
    await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [vo] } : t)) });
    router.push(`/studio/audio/${id}` as Href);
    const st = useEditorStore.getState;
    for (let i = 0; i < 60 && st().project?.id !== id; i++) {
      await sleep(200);
    }
    await sleep(1200);
    st().selectClip('vo');
    runDevAction('audio.editClip');
    await sleep(1000);
    runDevAction('clipEdit.scrollToPresets');
    await sleep(400);
    log(true, 'FOTÓZHATÓ', 'a klipszerkesztő: beépített presetek, alattuk a két saját (csillag) + Mentés');
    await sleep(3000);
    runDevAction('clipEdit.done');
    router.back();
  } finally {
    if (backup !== null) await AsyncStorage.setItem(USER_PRESETS_KEY, backup);
    else await AsyncStorage.removeItem(USER_PRESETS_KEY);
    useUserPresets.setState({ list: [], loaded: false });
  }
}

/** ⭐ Saját presetek: klip-effekt és dobminta mentése, alkalmazása, megmaradása „újraindítás” után, sérült tár. */
async function smokeUserPresets(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // a teszteszköz meglévő presetjei a végén visszakerülnek
  const backup = await AsyncStorage.getItem(USER_PRESETS_KEY);
  await AsyncStorage.removeItem(USER_PRESETS_KEY);
  useUserPresets.setState({ list: [], loaded: false });
  try {
    const id = 'prj_smoke_presets';
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:presets', caught));
    const base = createEmptyProject('smoke presetek', '9:16', undefined, 'audio');
    const fx = { compressor: true, reverb: 0.4, eq: { low: 2, mid: 0, high: 1 } };
    const vo: AudioClip = { kind: 'audio', id: 'vo', label: 'hang', uri: toneWav('smoke_presets.wav', 4), start: 0, duration: 4, trimIn: 0, sourceDuration: 4, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', audioFx: fx };
    await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [vo] } : t)) });
    router.push(`/studio/audio/${id}` as Href);
    const st = useEditorStore.getState;
    for (let i = 0; i < 60 && st().project?.id !== id; i++) {
      await sleep(200);
    }
    await sleep(1200);
    const clipFx = () => (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip).audioFx ?? {};
    // klip-effekt: mentés → a klip effektjei törölve → alkalmazás → a „Kész” a klipre írja
    st().selectClip('vo');
    runDevAction('audio.editClip');
    await sleep(800);
    const saved = await runDevAction('presets.clipFx.saveAs');
    runDevAction('clipEdit.done');
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'vo', patch: { audioFx: {} } }, 'user');
    await sleep(300);
    runDevAction('audio.editClip');
    await sleep(800);
    const applied = runDevAction('presets.clipFx.applyFirst');
    await sleep(300); // a lap az új effektekkel újrarajzol (mint egy valódi koppintás után)
    runDevAction('clipEdit.done');
    await sleep(300);
    log(saved === true && applied === 'Füstteszt clipFx' && sortedJson(clipFx()) === sortedJson(fx), 'klip-effekt preset: mentés, a klip effektjei törölve, alkalmazás → a klipen újra a mentett lánc', JSON.stringify(clipFx()));
    st().undo();
    log(JSON.stringify(clipFx()) === '{}', 'az alkalmazás egy visszavonással visszavonható', JSON.stringify(clipFx()));
    // dobminta
    runDevAction('audio.openDrums');
    await sleep(800);
    runDevAction('drums.demo');
    await sleep(200);
    const demo = runDevAction('drums.hits') as string;
    await runDevAction('presets.drums.saveAs');
    log(true, 'FOTÓZHATÓ', 'a dobgép a saját preset csillagos chipjével');
    await sleep(2500);
    runDevAction('audio.closeDrums');
    await sleep(400);
    // „újraindítás”: a memória üres, a tárból töltődik
    useUserPresets.setState({ list: [], loaded: false });
    await useUserPresets.getState().load();
    const kinds = useUserPresets.getState().list.map((p) => p.kind).sort().join(',');
    log(kinds === 'clipFx,drums', 'a presetek megmaradnak (a tárból újratöltve)', kinds);
    runDevAction('audio.openDrums');
    await sleep(800);
    const empty = runDevAction('drums.hits') as string;
    runDevAction('presets.drums.applyFirst');
    await sleep(200);
    const back = runDevAction('drums.hits') as string;
    log(empty === '' && back === demo && demo.length > 0, 'dobminta preset: az újranyitott üres gépen alkalmazva = a mentett ütem', `${demo.split(',').length} ütés`);
    runDevAction('audio.closeDrums');
    // sérült tár: csak az érvényes bejegyzés töltődik be
    await AsyncStorage.setItem(USER_PRESETS_KEY, JSON.stringify([{ kind: 'clipFx', id: 'x', name: 'Jó', value: { gate: true } }, { kind: 'bad' }, 'x', { kind: 'master', id: 'm', name: 'M', value: { lufs: 'sok' } }]));
    await useUserPresets.getState().load();
    log(useUserPresets.getState().list.length === 1, 'sérült tár: csak az érvényes bejegyzés töltődik be, nincs összeomlás', `${useUserPresets.getState().list.length} preset`);
    router.back();
  } finally {
    if (backup !== null) await AsyncStorage.setItem(USER_PRESETS_KEY, backup);
    else await AsyncStorage.removeItem(USER_PRESETS_KEY);
    useUserPresets.setState({ list: [], loaded: false });
  }
}

/** 🎹🥁🎛️ Hangszerek offline: beégetés a telefonon (WAV = az előhallgatott PCM), élő előhallgatás, a dobgép szól. */
async function smokeInstruments(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const maxDiff = (a: Float32Array, b: Float32Array) => {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  // 1) beégetés a telefonon — a fájl az, amit az előhallgatás játszik
  const notes = [{ id: 'a', midi: 60, startBeat: 0, lengthBeats: 1 }, { id: 'b', midi: 64, startBeat: 1, lengthBeats: 1 }, { id: 'c', midi: 67, startBeat: 2, lengthBeats: 2, velocity: 80 }];
  let t0 = Date.now();
  const syn = await renderSynthToClip(notes, { bpm: 120, wave: 'square' });
  const synMs = Date.now() - t0;
  const synD = syn ? maxDiff(await left(syn.uri), renderSynthPcm(notes, 'square', 120)[0]) : 1;
  log(!!syn && syn.uri.endsWith('.wav') && synD < 1e-4 && Math.abs(syn.durationSec - 2) < 1e-6, 'synth: a telefonon (WAV, szerver nélkül), a fájl = az előhallgatott hang', `${synMs} ms, ${syn?.durationSec} s, eltérés ${synD.toExponential(1)} (16 bit)`);
  const hits = [{ voice: 'kick' as const, step: 0 }, { voice: 'snare' as const, step: 4 }, { voice: 'hihat' as const, step: 2 }, { voice: 'clap' as const, step: 12 }];
  t0 = Date.now();
  const dr = await renderDrumsToClip(hits, { bpm: 120, bars: 1 });
  const drD = dr ? maxDiff(await left(dr.uri), renderDrumsPcm(hits, 1, 120)[0]) : 1;
  log(!!dr && dr.uri.endsWith('.wav') && drD < 1e-4 && Math.abs(dr.durationSec - 2) < 1e-6, 'dobgép: a telefonon, pontosan a rács hossza (loopolható)', `${Date.now() - t0} ms, ${dr?.durationSec} s, eltérés ${drD.toExponential(1)}`);
  const sampleUri = toneWav('smoke_instr_sample.wav', 0.2);
  t0 = Date.now();
  const pattern = Array.from({ length: 16 }, (_, i) => i % 4 === 0);
  const sm = await renderSamplerToClip(sampleUri, pattern, { bpm: 120, bars: 1 });
  const sample = await decodeSample(sampleUri);
  const smD = sm && sample ? maxDiff(await left(sm.uri), renderSamplerPcm(sample, [0, 4, 8, 12], 1, 120)[0]) : 1;
  log(!!sm && sm.uri.endsWith('.wav') && smD < 1e-4, 'sampler: a saját minta a telefonon a lépésekre', `${Date.now() - t0} ms, ${sm?.durationSec} s, eltérés ${smD.toExponential(1)}`);
  for (const c of [syn, dr, sm]) if (c) new File(c.uri).delete();
  // 2) élő előhallgatás (a lap megnyitása előkészíti a hangkontextust)
  await warmPreview();
  const a1 = await auditionNote(64, 'triangle', 120);
  log(a1 && lastStartMs < 30, 'koppintás (a lap nyitása után): a hang azonnal megszólal', `indítás ${lastStartMs} ms`);
  const a2 = await auditionDrum('snare');
  log(a2 && lastStartMs < 30, 'koppintás: a dob azonnal megszólal', `indítás ${lastStartMs} ms`);
  const loopPcm = renderDrumsPcm(hits, 1, 120);
  await playPcm(loopPcm, true);
  await sleep(700);
  const p1 = previewPosition() ?? -1;
  log(previewLooping() && p1 > 0.5 && p1 < 0.95, 'a minta loopolva szól, a lejátszófej halad (a hangkimenet órája)', `${p1.toFixed(3)} s 700 ms után`);
  await playPcm(renderDrumsPcm([...hits, { voice: 'kick', step: 8 }], 1, 120), true, true);
  const p2 = previewPosition() ?? -1;
  log(Math.abs(p2 - p1) < 0.15, 'szerkesztés közben: az új minta a lejátszófej helyéről folytatódik', `${p1.toFixed(3)} → ${p2.toFixed(3)} s`);
  await sleep(1800);
  const p3 = previewPosition() ?? -1;
  log(p3 >= 0 && p3 < 2, 'a loop körbefordul (2 s-os rács)', `${p3.toFixed(3)} s`);
  stopPreview();
  log(!previewLooping(), 'Állj: elhallgat', '');
  // 3) a dobgép a stúdióban, a „▶” gombbal
  const id = 'prj_smoke_instruments';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instruments', caught));
  const base = createEmptyProject('smoke hangszerek', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.openDrums');
  await sleep(800);
  const n = runDevAction('drums.demo') as number;
  await sleep(300);
  const playing = (await runDevAction('preview.drums-play')) as boolean;
  await sleep(600);
  log(n === 12 && playing && previewLooping() && (previewPosition() ?? 0) > 0.3, 'a dobgép „▶” gombja: a demó-ütem (12 ütés) loopolva szól', `${n} ütés, ${(previewPosition() ?? -1).toFixed(2)} s`);
  log(true, 'FOTÓZHATÓ', 'a dobgép a demó-ütemmel, a „Lejátszás” gomb aktív');
  await sleep(3000);
  await runDevAction('preview.drums-play');
  log(!previewLooping(), 'a gomb újra: elhallgat', '');
  router.back();
}

/**
 * 🥁🎹 R7: velocity + swing — a dobgép és a piano roll a felületen át (dev-akciók) beállítva,
 * „Sávra” sütve, a fájlon mérve: a velocity a csúcsszintben, a swing a páros 16-odok késésében
 * (± 1 ms); az élő előhallgatás („▶”) PCM-je = a beégetett klip.
 */
async function smokeVelSwing(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const peakOf = (x: Float32Array, a: number, b: number) => {
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) m = Math.max(m, Math.abs(x[i]));
    return m;
  };
  const maxDiff = (a: Float32Array, b: Float32Array) => {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  const id = 'prj_smoke_velswing';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:velswing', caught));
  const base = createEmptyProject('smoke velocity swing', '9:16', undefined, 'audio');
  await saveProject({ ...base, id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const musicClips = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const waitClip = async (n: number) => {
    for (let i = 0; i < 100 && musicClips().length < n; i++) await sleep(100);
    return musicClips()[n - 1];
  };
  const created: string[] = [];
  try {
    // 1) dobgép: hihat az 1–4. 16-odon; a 2. hangsúlyos, a 3. halk; swing 40 %
    runDevAction('audio.openDrums');
    await sleep(800);
    const pattern = { ...emptyPattern(1), hihat: Array.from({ length: 16 }, (_, i) => i < 4) };
    runDevAction('drums.set', { pattern, velocity: { hihat: [undefined, DRUM_ACCENT, DRUM_SOFT] }, swing: 0.4 });
    await sleep(300);
    const hits = runDevAction('drums.hits') as string;
    log(hits === 'hihat0,hihat1.4v127,hihat2v64,hihat3.4', 'a dobgép ütései: a páros 16-odok 40 %-kal később, a szint ütésenként', hits);
    // élő előhallgatás (a „Sávra” bezárja a lapot → előtte)
    const playing = (await runDevAction('preview.drums-play')) as boolean;
    await sleep(500);
    const dLive = playing && previewLooping() ? (lastLoopPcm?.[0] ?? null) : null;
    log(true, 'FOTÓZHATÓ', 'a dobgép: a hangsúlyos (fehér keret) és a halk (halvány) ütés, swing 40 %');
    await sleep(2500);
    await runDevAction('preview.drums-play');
    runDevAction('drums.bake');
    const dc = await waitClip(1);
    if (!dc?.uri) {
      log(false, 'a dobminta a sávra kerül', 'nincs klip');
      return;
    }
    created.push(dc.uri);
    const d = await left(dc.uri);
    const step = 0.125; // 120 BPM, 16-od
    const onsetMs = (fromSec: number) => {
      const i0 = Math.round(fromSec * SR);
      for (let i = i0; i < d.length; i++) if (Math.abs(d[i]) > 1e-4) return (i / SR) * 1000;
      return -1;
    };
    const on = [0, 1, 2, 3].map((k) => onsetMs(k * step - (k ? 0.002 : 0)));
    const late = [on[1] - 125, on[3] - 375];
    const pk = on.map((ms) => peakOf(d, Math.round((ms / 1000) * SR), Math.round((ms / 1000 + 0.06) * SR)));
    log(Math.abs(on[0]) <= 1 && Math.abs(on[2] - 250) <= 1 && late.every((l) => Math.abs(l - 50) <= 1), 'swing 40 %: a páros 16-odok 50 ms-mal később (± 1 ms), a páratlanok a rácson', `kezdetek ${on.map((x) => x.toFixed(2)).join(' · ')} ms → késés ${late.map((x) => x.toFixed(2)).join(' / ')} ms`);
    const r1 = pk[1] / pk[0];
    const r2 = pk[2] / pk[0];
    log(Math.abs(r1 - 1 / 0.9) < 0.02 && Math.abs(r2 - DRUM_SOFT / 127 / 0.9) < 0.02 && Math.abs(pk[3] / pk[0] - 1) < 0.02, 'velocity: a csúcsszint a hangsúlyosnál ×1,11, a halknál ×0,56 (a normálhoz)', `csúcsok ${pk.map((x) => x.toFixed(3)).join(' · ')} → ×${r1.toFixed(3)} / ×${r2.toFixed(3)} (várt ×1,111 / ×0,560)`);
    const dd = dLive ? maxDiff(dLive, d) : 1;
    log(!!dLive && dd < 1e-4 && Math.abs(dLive.length - d.length) <= 1, 'az élő előhallgatás („▶”) = a beégetett klip', `eltérés ${dd.toExponential(1)} (16 bit), ${(d.length / SR).toFixed(3)} s`);
    await sleep(400);
    // 2) piano roll: A4 három erősséggel (halk · közepes · erős)
    runDevAction('audio.openPianoRoll');
    await sleep(800);
    runDevAction('synth.set', { wave: 'sine', bars: 1, notes: [{ midi: 69, startBeat: 0, lengthBeats: 1, velocity: 50 }, { midi: 69, startBeat: 1, lengthBeats: 1, velocity: 100 }, { midi: 69, startBeat: 2, lengthBeats: 1, velocity: 127 }] });
    await sleep(300);
    const notes = runDevAction('synth.notes') as string;
    const sPlaying = (await runDevAction('preview.pianoroll-play')) as boolean;
    await sleep(500);
    const live = lastLoopPcm?.[0] ?? null;
    await runDevAction('preview.pianoroll-play');
    runDevAction('synth.bake');
    const sc = await waitClip(2);
    if (!sc?.uri) {
      log(false, 'a dallam a sávra kerül', 'nincs klip');
      return;
    }
    created.push(sc.uri);
    const sx = await left(sc.uri);
    const spk = [0, 1, 2].map((b) => peakOf(sx, Math.round((b * 0.5 + 0.1) * SR), Math.round((b * 0.5 + 0.4) * SR)));
    log(Math.abs(spk[0] / spk[2] - 50 / 127) < 0.01 && Math.abs(spk[1] / spk[2] - 100 / 127) < 0.01, 'piano roll velocity: a csúcsszint a velocity-vel arányos (50 · 100 · 127)', `${notes} → csúcsok ${spk.map((x) => x.toFixed(3)).join(' · ')} (×${(spk[0] / spk[2]).toFixed(3)} / ×${(spk[1] / spk[2]).toFixed(3)}, várt ×0,394 / ×0,787)`);
    const sd = live ? maxDiff(live, sx) : 1;
    log(sPlaying && sd < 1e-4, 'az élő előhallgatás = a beégetett dallam (a közös hossz)', `eltérés ${sd.toExponential(1)}`);
    runDevAction('audio.closePianoRoll');
    // 3) egy visszavonás: a dallam-klip eltűnik
    st().undo();
    log(musicClips().length === 1, 'a beégetés egy visszavonással visszavonható', `${musicClips().length} klip`);
  } finally {
    stopPreview();
    for (const u of created) {
      try {
        const f = new File(u);
        if (f.exists) f.delete();
      } catch (caught) {
        logCaught('lib/imageSmoke.tsx:velswing-clean', caught);
      }
    }
    router.back();
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:velswing-del', caught));
  }
}

/** 👆 R7 valódi érintéssel (adb / ember): hosszú nyomás = ütés-szint, a swing-gomb lépked. */
async function smokeVelTouch(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_veltouch';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:veltouch', caught));
  await saveProject({ ...createEmptyProject('smoke veltouch', '9:16', undefined, 'audio'), id });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  runDevAction('audio.openDrums');
  await sleep(800);
  const hits = () => runDevAction('drums.hits') as string;
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  try {
    log(null, 'READY', 'long1');
    const a = await waitFor(() => hits() === 'hihat5v127', 25000);
    log(a, 'hosszú nyomás az üres cellán: hangsúlyos ütés', hits());
    log(null, 'READY', 'long2');
    const b = await waitFor(() => hits() === 'hihat5v64', 25000);
    log(b, 'újra hosszan: halk', hits());
    log(null, 'READY', 'swing');
    const c = await waitFor(() => hits() === 'hihat5.2v64', 25000);
    log(c, 'swing + ×2 (20 %): a páros 16-od 0,2 lépéssel később', hits());
    log(null, 'READY', 'tap');
    const d = await waitFor(() => hits() === '', 25000);
    log(d, 'rövid koppintás: az ütés ki', hits() || '(üres)');
  } finally {
    runDevAction('audio.closeDrums');
    router.back();
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:veltouch-del', caught));
  }
}

/** 📐 AP1: az újabb app-verzió projektje csak olvasható — a szerkesztés nem megy át, a tárolt bájtok változatlanok. */
async function smokeNewerSchema(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_newer';
  const key = `vided.project.v1.${id}`;
  const base = createEmptyProject('smoke újabb séma', '9:16', undefined, 'audio');
  const stored = { ...base, id, schemaVersion: 99, futureField: { x: 1 } };
  const raw = JSON.stringify(stored);
  await AsyncStorage.setItem(key, raw);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const opened = st().project?.id === id && st().project?.schemaVersion === 99;
  const ok = st().dispatch({ type: 'RENAME_PROJECT', name: 'felülírva' });
  log(opened && !ok && st().project?.name === base.name, 'a v99-es projekt megnyílik, a szerkesztés nem megy át', `séma ${st().project?.schemaVersion}, dispatch ${ok}`);
  log(true, 'FOTÓZHATÓ', 'a „csak olvasható” sáv a Hang Stúdió tetején');
  await sleep(2500);
  router.back();
  await sleep(1500); // a kilépéskori mentés is lefut
  const after = await AsyncStorage.getItem(key);
  log(after === raw, 'kilépés után a tárolt projekt bájtra változatlan (az ismeretlen mező is megmaradt)', `${raw.length} bájt`);
  await AsyncStorage.removeItem(key);
  // a mai projekt v7-tel mentődik
  const cur = { ...createEmptyProject('smoke v7', '9:16', undefined, 'audio'), id: 'prj_smoke_v7' };
  await saveProject(cur);
  const back = JSON.parse((await AsyncStorage.getItem('vided.project.v1.prj_smoke_v7')) ?? '{}') as { schemaVersion?: number };
  log(back.schemaVersion === 7, 'az új projekt a jelenlegi sémán (v7) mentődik', `v${back.schemaVersion}`);
  await deleteProject('prj_smoke_v7').catch((caught) => logCaught('lib/imageSmoke.tsx:newerschema', caught));
}

/**
 * 🎹🥁 AP2 (MU1): a sütött dob-klip mintája megmarad (mentés + újratöltés után is), a klipszerkesztőből
 * újranyitható, módosítva újrasütve a klip hangja az új minta, a helye/hangereje/effektje marad; egy undo.
 */
async function smokeInstrumentEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const api = (await loadAudioApi())!;
  const left = async (uri: string) => (await api.decodeAudioData(uri, SR)).getChannelData(0);
  const maxDiff = (a: Float32Array, b: Float32Array) => {
    let d = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    return d;
  };
  const id = 'prj_smoke_instedit';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instedit', caught));
  await saveProject({ ...createEmptyProject('smoke minta', '9:16', undefined, 'audio'), id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const music = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  try {
    // 1) sütés: kick az 1. és 9. lépésen, a 9. hangsúlyos, swing 20 %
    runDevAction('audio.openDrums');
    await sleep(800);
    let p1 = emptyPattern(1);
    p1 = { ...p1, kick: p1.kick.map((_, i) => i === 0 || i === 8) };
    runDevAction('drums.set', { pattern: p1, velocity: { kick: Object.assign([], { 8: DRUM_ACCENT }) }, swing: 0.2 });
    await sleep(300);
    runDevAction('drums.bake');
    const baked = await waitFor(() => music().length === 1, 10000);
    const c0 = music()[0];
    log(baked && !!c0?.instrumentDocId && st().project!.instrumentDocs?.length === 1, 'sütés: a klip a mintára hivatkozik, a minta a projektben', `${c0?.instrumentDocId}, ${st().project!.instrumentDocs?.length} minta`);
    // a klipet a felhasználó beállítja: hely, hangerő, effekt
    st().dispatch({ type: 'UPDATE_CLIP', clipId: c0.id, patch: { start: 1.5, volume: 0.6, audioFx: { reverb: 0.4 } } });
    // 2) mentés + újratöltés („az app újraindult”)
    await saveProject(st().project!);
    const reloaded = await loadProject(id);
    st().loadProject(reloaded!);
    await sleep(500);
    const doc0 = st().project!.instrumentDocs?.[0];
    log(!!doc0 && doc0.drums?.pattern.kick[8] === true && doc0.drums?.velocity?.kick?.[8] === DRUM_ACCENT && doc0.drums?.swing === 0.2, 'mentés és újratöltés után a minta megvan (ütések, szint, swing)', `${reloaded?.instrumentDocs?.length} minta`);
    // 3) „Minta szerkesztése” a klipszerkesztőből → a dobgép a mentett mintával nyílik
    st().selectClip(music()[0].id);
    runDevAction('audio.editClip');
    await sleep(800);
    const opened = runDevAction('clipEdit.editInstrument') === true;
    await sleep(900);
    const hits0 = runDevAction('drums.hits') as string;
    log(opened && hits0 === 'kick0,kick8v127', 'a klipszerkesztő „Minta szerkesztése”: a dobgép a mentett mintával nyílik', hits0);
    log(true, 'FOTÓZHATÓ', 'a dobgép a klip mentett mintájával');
    await sleep(2000);
    // 4) módosítás + újrasütés: snare a 2. és 4. negyeden, 2 ütem
    const p2 = { ...emptyPattern(2), kick: emptyPattern(2).kick.map((_, i) => i === 0 || i === 8 || i === 16), snare: emptyPattern(2).snare.map((_, i) => i === 4 || i === 12 || i === 20 || i === 28) };
    runDevAction('drums.set', { pattern: p2, swing: 0, bars: 2 });
    await sleep(300);
    const oldUri = music()[0].uri;
    runDevAction('drums.bake');
    const rebaked = await waitFor(() => music()[0].uri !== oldUri, 10000);
    const c1 = music()[0];
    const exp = renderDrumsPcm(patternHits(p2), 2, st().project!.bpm ?? 120)[0];
    const got = await left(c1.uri);
    const d = maxDiff(got, exp);
    log(rebaked && music().length === 1 && d < 1e-4 && Math.abs(c1.duration - 4) < 1e-6, 'újrasütés: ugyanaz a klip, a hangja = az új minta (2 ütem, 4 s)', `eltérés ${d.toExponential(1)}, ${c1.duration} s`);
    log(c1.start === 1.5 && c1.volume === 0.6 && c1.audioFx?.reverb === 0.4 && c1.instrumentDocId === c0.instrumentDocId, 'a klip helye, hangereje és effektje megmaradt', `kezdet ${c1.start}, hangerő ${c1.volume}, zengés ${c1.audioFx?.reverb}`);
    // 5) egy undo: a régi hang és a régi minta
    st().undo();
    const u = music()[0];
    const ud = st().project!.instrumentDocs?.[0];
    log(u.uri === oldUri && ud?.bars === 1 && ud?.drums?.swing === 0.2, 'egy visszavonás: a régi hang és a régi minta', `${ud?.bars} ütem`);
    // 6) 🎛️ S1: sampler-minta — saját hangfájl + rács; mentés + újratöltés; „Minta szerkesztése” → a sampler
    //    a mentett fájllal és ráccsal; újrasütés ugyanarra a klipre; egy undo
    runDevAction('audio.closeDrums');
    await sleep(400);
    const sampleUri = toneWav('smoke_instedit_sample.wav', 0.25);
    runDevAction('audio.openSampler');
    await sleep(800);
    const pat1 = emptySampler(1);
    pat1[0] = true;
    pat1[8] = true;
    runDevAction('sampler.set', { sampleUri, sampleName: 'minta.wav', pattern: pat1, bars: 1 });
    await sleep(300);
    runDevAction('sampler.bake');
    const sBaked = await waitFor(() => music().length === 2, 10000);
    const s0 = music().find((c) => instrumentDocOf(st().project, c.instrumentDocId)?.kind === 'sampler');
    const sDoc0 = instrumentDocOf(st().project, s0?.instrumentDocId);
    log(sBaked && !!s0 && sDoc0?.sampler?.sampleUri === sampleUri && sDoc0.sampler.pattern[8] === true, 'sampler: sütés → a minta (fájl + rács) a projektben, a klip hivatkozik rá', `${sDoc0?.sampler?.sampleName}, ${sDoc0?.sampler?.pattern.filter(Boolean).length} lépés`);
    if (!s0) throw new Error('nincs sampler-klip');
    st().dispatch({ type: 'UPDATE_CLIP', clipId: s0.id, patch: { start: 6, volume: 0.5 } });
    await saveProject(st().project!);
    const reloaded2 = await loadProject(id);
    st().loadProject(reloaded2!);
    await sleep(500);
    const sDoc1 = instrumentDocOf(st().project, s0.instrumentDocId);
    log(!!sDoc1?.sampler && sDoc1.sampler.pattern[8] === true && new File(sDoc1.sampler.sampleUri).exists, 'sampler: mentés + újratöltés után a minta megvan, a hangfájl létezik', sDoc1?.sampler?.sampleUri.split('/').slice(-2).join('/') ?? '-');
    st().selectClip(s0.id);
    runDevAction('audio.editClip');
    await sleep(800);
    const sOpened = runDevAction('clipEdit.editInstrument') === true;
    await sleep(900);
    const sState = runDevAction('sampler.state') as string;
    log(sOpened && sState === '1|minta.wav|0,8', 'sampler: „Minta szerkesztése” → a sampler a mentett fájllal és ráccsal nyílik', sState);
    const pat2 = emptySampler(2);
    for (const i of [0, 4, 8, 12, 16, 24]) pat2[i] = true;
    runDevAction('sampler.set', { pattern: pat2, bars: 2 });
    await sleep(300);
    const sOld = music().find((c) => c.id === s0.id)!.uri;
    runDevAction('sampler.bake');
    const sRebaked = await waitFor(() => music().find((c) => c.id === s0.id)?.uri !== sOld, 10000);
    const s1 = music().find((c) => c.id === s0.id)!;
    const sample = await decodeSample(sDoc1!.sampler!.sampleUri);
    const sd = sample ? maxDiff(await left(s1.uri), renderSamplerPcm(sample, [0, 4, 8, 12, 16, 24], 2, st().project!.bpm ?? 120)[0]) : 1;
    log(sRebaked && music().length === 2 && sd < 1e-4 && s1.start === 6 && s1.volume === 0.5 && s1.instrumentDocId === s0.instrumentDocId, 'sampler: újrasütés ugyanarra a klipre, a hang = az új minta (2 ütem), hely és hangerő marad', `eltérés ${sd.toExponential(1)}, ${s1.duration.toFixed(3)} s`);
    st().undo();
    const su = music().find((c) => c.id === s0.id)!;
    const sud = instrumentDocOf(st().project, s0.instrumentDocId);
    log(su.uri === sOld && sud?.bars === 1 && sud?.sampler?.pattern.filter(Boolean).length === 2, 'sampler: egy visszavonás a régi hangot és a régi mintát adja', `${sud?.bars} ütem, ${sud?.sampler?.pattern.filter(Boolean).length} lépés`);
  } finally {
    runDevAction('audio.closeDrums');
    runDevAction('audio.closeSampler');
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:instedit-del', caught));
  }
}

/** 🥁 AP3: a tempó-felismerés a telefonon fut (worker nélkül); 120 és 93 BPM klikk-sávon ±1 BPM, a beatek a rácson. */
async function smokeBpmOffline(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const click = (name: string, bpm: number, sec: number) => {
    const x = new Float32Array(Math.round(sec * SR));
    let seed = bpm;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    const period = (60 / bpm) * SR;
    for (let k = 0; k * period < x.length; k++) {
      const at = Math.round(k * period);
      const amp = k % 4 === 0 ? 0.9 : 0.5;
      for (let i = 0; i < 1600 && at + i < x.length; i++) x[at + i] += amp * Math.exp(-i / 240) * rnd();
    }
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(encodeWav16([x, x], SR, () => 0.5));
    return file.uri;
  };
  const id = 'prj_smoke_bpm';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bpm', caught));
  const base = createEmptyProject('smoke bpm', '9:16', undefined, 'audio');
  const files = [click('smoke_click_120.wav', 120, 20), click('smoke_click_93.wav', 93, 20)];
  const mk = (uri: string, cid: string): AudioClip => ({ kind: 'audio', id: cid, label: cid, start: 0, duration: 20, trimIn: 0, sourceDuration: 20, uri, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, bpm: 100, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk(files[0], 'c120')] } : t.type === 'sfx' ? { ...t, clips: [mk(files[1], 'c93')] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  try {
    for (const [cid, bpm] of [['c120', 120], ['c93', 93]] as const) {
      st().selectClip(cid);
      await sleep(200);
      const t0 = Date.now();
      await runDevAction('audio.autoBpm');
      const ms = Date.now() - t0;
      const got = st().project!.bpm ?? 0;
      const grid = await detectBeats(files[cid === 'c120' ? 0 : 1]);
      const period = 60 / bpm;
      const offs = (grid?.beats ?? []).slice(1, -1).map((b) => {
        const o = ((b % period) + period) % period;
        return o > period / 2 ? o - period : o;
      });
      const worst = Math.max(...offs.map((o) => Math.abs(o) * 1000));
      const mean = (offs.reduce((a, o) => a + o, 0) / Math.max(1, offs.length)) * 1000;
      log(Math.abs(got - bpm) <= 1 && lastBeatPath() === 'device' && worst <= 52 && Math.abs(mean) <= 25, `${bpm} BPM klikk-sáv: a stúdió „Tempó felismerése” a telefonon (worker nélkül) ±1 BPM, a beatek a rácson`, `${got} BPM, ${lastBeatPath()}, ${ms} ms, beat-eltérés átlag ${mean.toFixed(1)} / max ${worst.toFixed(1)} ms`);
    }
    log(true, 'FOTÓZHATÓ', 'a felismert tempó és a beat-vonalak az idővonalon');
    await sleep(2500);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:bpm-del', caught));
    for (const f of files) new File(f).delete();
  }
}

/**
 * ⏱️ AP4: a metronóm a lejátszás alatt mintapontosan a rácson szól (hangsúlyos ütem-egy), a mérőbe és
 * az exportba nem kerül; metronómos felvételnél a lejátszás a projekt végén túl is fut, a take a
 * lejátszófejtől szól.
 */
async function smokeMetronome(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const silent = new File(Paths.document, 'smoke_metro_silence.wav');
  if (silent.exists) silent.delete();
  silent.create();
  silent.write(encodeWav16([new Float32Array(4 * SR)], SR, () => 0.5));
  const id = 'prj_smoke_metro';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:metro', caught));
  const base = createEmptyProject('smoke metronóm', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'sil', label: 'csend', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, uri: silent.uri, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const prefs = useRecordPrefs.getState();
  const was = { metronome: prefs.metronome, gain: prefs.metronomeGain, countIn: prefs.countInBars, punch: prefs.punch };
  try {
    // 1) lejátszás metronómmal: a motor kimenete = a klikkek (a klip néma)
    useRecordPrefs.setState({ metronome: true, metronomeGain: 0.6, countInBars: 0, punch: false });
    await sleep(300);
    previewEngine.debugTap(true);
    st().setPlayhead(0);
    st().setPlaying(true);
    let lufs: number | null = null;
    for (let i = 0; i < 25; i++) {
      await sleep(100);
      const r = previewEngine.loudness();
      if (r) lufs = Math.max(lufs ?? -Infinity, r.shortTerm ?? -Infinity);
    }
    st().setPlaying(false);
    const chunks = previewEngine.debugTap(false).sort((a, b) => a.from - b.from);
    const total = chunks.length ? chunks[chunks.length - 1].from + chunks[chunks.length - 1].left.length : 0;
    const out = new Float32Array(total);
    for (const c of chunks) out.set(c.left, c.from);
    const beats = [0, 1, 2, 3, 4].map((k) => Math.round(k * 0.5 * SR)).filter((at) => at + 2 < total);
    const exact = beats.every((at) => (at === 0 || out[at - 1] === 0) && out[at] === 0 && Math.abs(out[at + 1] - 0.6 * clickSample(at === 0 || at === Math.round(2 * SR) ? true : false, 1, SR)) < 1e-6);
    const pk = (at: number) => out.subarray(at, at + Math.round(0.04 * SR)).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    const ratio = beats.length > 1 ? pk(beats[0]) / pk(beats[1]) : 0;
    log(exact && beats.length >= 4, 'lejátszás közben a klikkek mintapontosan a beateken (120 BPM: 0,5 s-onként)', `${beats.length} klikk, ${chunks.length} szelet`);
    log(Math.abs(ratio - 0.8 / 0.55) < 0.05, 'az ütem-egy hangsúlyos (×1,45)', `×${ratio.toFixed(3)}`);
    log(lufs === null || !Number.isFinite(lufs) || lufs < -70, 'a hangosságmérő nem látja a klikket (a mérés előtt keveredik)', `short-term ${lufs === null || !Number.isFinite(lufs) ? '−∞' : lufs.toFixed(1)} LUFS`);
    // 2) az export néma (a metronóm nem kerül bele)
    const { uri: exp } = await exportOfflineWav(st().project!, new File(projectExportDir(), 'smoke_metro_export.wav'));
    const api = (await loadAudioApi())!;
    const ex = (await api.decodeAudioData(exp, SR)).getChannelData(0);
    const exPeak = ex.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    // a 16 bites export TPDF-ditherrel készül: a „csend” ±1–2 LSB (a klikk 0,6 volna)
    log(exPeak <= 2 / 32768, 'az export néma: a metronóm nem kerül bele (csak a 16 bites dither, ≤ 2 LSB)', `csúcs ${(exPeak * 32768).toFixed(1)} LSB`);
    new File(exp).delete();
    // 3) metronómos felvétel a projekt végén túl: 1 ütem előszámlálás, a take a lejátszófejtől
    useRecordPrefs.setState({ countInBars: 1 });
    st().setPlayhead(3);
    await sleep(300);
    await runDevAction('audio.recordToggle');
    let maxHead = 0;
    for (let i = 0; i < 45; i++) {
      await sleep(100);
      maxHead = Math.max(maxHead, st().playhead);
    }
    const through = st().playThrough && st().isPlaying;
    await runDevAction('audio.recordToggle');
    for (let i = 0; i < 40 && (st().project!.tracks.find((t) => t.type === 'voiceover')!.clips.length === 0); i++) await sleep(100);
    const take = st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip | undefined;
    log(through && maxHead > 4.3, 'felvétel közben a lejátszás a projekt végén (4 s) túl is fut', `lejátszófej max ${maxHead.toFixed(2)} s`);
    log(!!take && Math.abs(take.start - 3) < 0.15 && take.duration > 1.5 && !st().playThrough && !st().isPlaying, 'a take a lejátszófejtől (3 s) szól, az előszámlálás nélkül; leállítás után a transzport alaphelyzetben', take ? `kezdet ${take.start.toFixed(3)} s, ${take.duration.toFixed(2)} s, levágva ${(take.trimIn ?? 0).toFixed(3)} s` : 'nincs take');
    log(true, 'FOTÓZHATÓ', 'a metronóm-gomb aktív a transzporton, a take a 3. mp-nél');
    await sleep(2000);
  } finally {
    useRecordPrefs.setState({ metronome: was.metronome, metronomeGain: was.gain, countInBars: was.countIn, punch: was.punch });
    st().setPlaying(false);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:metro-del', caught));
    if (silent.exists) silent.delete();
  }
}

/** 🗣️ AP5: az AI-hang a telefonon készül (offline, szerver nélkül): WAV a voiceover sávon, valódi beszéd, egy undo. */
async function smokeTtsDevice(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_tts';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tts', caught));
  await saveProject({ ...createEmptyProject('smoke tts', '9:16', undefined, 'audio'), id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const voice = () => st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[];
  try {
    runDevAction('audio.openTts');
    let info: { device: string[] | null; server: number } = { device: null, server: 0 };
    for (let i = 0; i < 50 && !info.device; i++) {
      await sleep(200);
      info = (runDevAction('tts.voices') as typeof info) ?? info;
    }
    log(canSpeakOnDevice() && (info.device?.length ?? 0) > 0, 'a telefon beszédhangjai elérhetők (szerver nélkül)', `${info.device?.length ?? 0} nyelv: ${(info.device ?? []).slice(0, 6).join(', ')}`);
    log(true, 'FOTÓZHATÓ', 'az AI-hang lap a telefon hangjaival');
    await sleep(1500);
    runDevAction('tts.text', 'Szia! Ez a ReMix telefonos hangja. Egy, kettő, három, négy.');
    await sleep(300);
    const head = st().playhead;
    const t0 = Date.now();
    const ok = (await runDevAction('tts.generate')) as boolean;
    const ms = Date.now() - t0;
    const clip = voice()[0];
    const api = (await loadAudioApi())!;
    const buf = clip ? await api.decodeAudioData(clip.uri, 44100) : null;
    const l = buf?.getChannelData(0);
    const lufs = l ? integratedLoudness(l, l, 44100) : -Infinity;
    log(ok && !!clip && clip.uri.startsWith('file:') && clip.uri.endsWith('.wav') && Math.abs(clip.start - head) < 0.05 && clip.duration > 1.5, 'a beszéd a telefonon készült (WAV a projekt-mappában), klipként a lejátszófejnél a voiceover sávon', clip ? `${ms} ms, ${clip.duration.toFixed(2)} s, kezdet ${clip.start}` : 'nincs klip');
    log(lufs > -40, 'a fájlban valódi beszéd szól (nem csend)', `${lufs.toFixed(1)} LUFS`);
    st().undo();
    log(voice().length === 0, 'egy visszavonás: a klip eltűnik', `${voice().length} klip`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tts-del', caught));
  }
}

/** 🔊 AP6: a videó-szerkesztő gyors hangerő-léptetője dB-ben lép — a +6 dB-es klip egy „−” után +5 dB (nem 0 dB). Valódi érintés (adb). */
async function smokeQuickVolume(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_quickvol';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:quickvol', caught));
  const base = createEmptyProject('smoke gyors hangerő', '9:16');
  const uri = toneWav('smoke_quickvol.wav', 4);
  const v6 = Math.pow(10, 6 / 20);
  const clip: AudioClip = { kind: 'audio', id: 'qv', label: 'zene', start: 0, duration: 4, trimIn: 0, sourceDuration: 4, uri, volume: v6, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/editor/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  const vol = () => (st().project!.tracks.find((t) => t.type === 'music')!.clips[0] as AudioClip).volume;
  try {
    st().selectClip('qv');
    st().setPanel('audio');
    await sleep(800);
    log(null, 'READY', 'voldown');
    for (let i = 0; i < 250 && Math.abs(vol() - v6) < 1e-9; i++) await sleep(100);
    const db = 20 * Math.log10(vol());
    log(Math.abs(db - 5) < 0.05, 'a „Hangerő −” egy érintésre +6 → +5 dB (eddig 0–1 közé vágott: 0 dB lett volna)', `${db.toFixed(2)} dB`);
    log(true, 'FOTÓZHATÓ', 'a gyors hangerő-léptető dB-ben');
    await sleep(1500);
  } finally {
    st().setPanel(null);
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:quickvol-del', caught));
  }
}

/** 🧩 AP7: az „Új projekt” űrlap hang-sablonnal (a valódi létrehozási út): zene és podcast. */
async function smokeAudioTemplate(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const created: string[] = [];
  try {
    for (const tpl of ['music', 'podcast'] as const) {
      router.replace('/studio' as Href);
      await sleep(1500);
      const name = `smoke sablon ${tpl}`;
      runDevAction('studio.fillCreate', { name, kind: 'audio', audioTemplate: tpl });
      await sleep(400);
      await runDevAction('studio.create');
      for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
      await sleep(800);
      const p = st().project;
      if (p?.name === name) created.push(p.id);
      if (tpl === 'music') {
        log(p?.kind === 'audio' && p.bpm === 120 && p.timeSignature?.beatsPerBar === 4 && p.markers?.length === 4 && p.audioMaster?.target === 'music', 'zene-sablon: 120 BPM 4/4, 4 szerkezeti jelölő, zenei hangosság — a Hang Stúdióban nyílik', p ? `${p.bpm} BPM, jelölők: ${(p.markers ?? []).map((m) => `${m.label}@${m.time}`).join(', ')}` : 'nincs projekt');
        log(true, 'FOTÓZHATÓ', 'a zene-sablonból nyílt Hang Stúdió a jelölőkkel');
        await sleep(2000);
      } else {
        const voice = p?.tracks.find((t) => t.type === 'voiceover');
        log(p?.audioMaster?.target === 'podcast' && p.audioMaster.duckTrigger === 'voiceover' && !!voice?.name, 'podcast-sablon: podcast-hangosság, a beszéd a halkítás kulcsa, a sávok elnevezve', p ? `${p.audioMaster?.target}, kulcs ${p.audioMaster?.duckTrigger}, beszéd-sáv „${voice?.name}”` : 'nincs projekt');
      }
    }
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    // a létrehozás a felhőbe is ment (a dev a prodra mutat): a helyi ÉS a felhős tesztadat is törlődik,
    // a korábbi futások név szerinti maradékai is
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke sablon ')).map((m) => m.id);
    for (const id of new Set([...created, ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tpl-del', caught));
      await deleteCloudProject(id);
    }
    const remain = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke sablon ')).length;
    log(remain === 0, 'takarítás: a teszt-projektek a felhőből is törölve', `${new Set([...created, ...leftovers]).size} törölve, maradt ${remain}`);
  }
}

/**
 * 🎵 S10 (MU0): a „+ Új projekt → Zene" a VALÓDI létrehozási úton egy kész ütemrácsos projektet nyit a Hang
 * Stúdió Zene munkaterületén (a `music` fajta útvonala → `?ws=music`), a hangszerek elöl; offline.
 */
async function smokeMusicWorkspace(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const name = 'smoke zene munkaterület';
  let createdId: string | null = null;
  try {
    router.replace('/studio' as Href);
    await sleep(1500);
    runDevAction('studio.fillCreate', { name, kind: 'music' });
    await sleep(400);
    await runDevAction('studio.create');
    for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
    await sleep(1200);
    const p = st().project;
    createdId = p?.name === name ? p.id : null;
    log(p?.kind === 'music' && p.bpm === 120 && p.timeSignature?.beatsPerBar === 4 && (p.markers?.length ?? 0) === 4 && p.audioMaster?.target === 'music', '„Zene" projekt: a fajta music, a Zene-sablon alkalmazva (120 BPM, 4/4, 4 jelölő, zenei hangosság)', p ? `${p.kind}, ${p.bpm} BPM, ${p.markers?.length} jelölő, cél ${p.audioMaster?.target}` : 'nincs projekt');
    const ws = runDevAction('audio.workspace');
    log(ws === 'music', 'a music útvonal a Hang Stúdiót nyitja a Zene munkaterületen (átirányítás ?ws=music)', `${ws}`);
    // a hangszerek elöl: a piano roll a munkaterület gombjáról nyílik és zárul (a lassú eszközön megvárjuk a lapot)
    runDevAction('audio.openPianoRoll');
    let notesBefore: unknown;
    for (let i = 0; i < 50 && notesBefore === undefined; i++) {
      await sleep(100);
      notesBefore = runDevAction('synth.notes');
    }
    runDevAction('audio.closePianoRoll');
    await sleep(300);
    log(notesBefore !== undefined, 'a Zene munkaterület hangszerei élnek (piano roll nyílik a mentett tempón)', notesBefore === undefined ? 'nem nyílt meg' : `${String(notesBefore).slice(0, 40) || '(üres rács)'}`);
    log(true, 'FOTÓZHATÓ', 'a Hang Stúdió Zene munkaterülete: hangszerek a transzport elején');
    await sleep(1500);
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name === name).map((m) => m.id);
    for (const id of new Set([...(createdId ? [createdId] : []), ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:musicws-del', caught));
      await deleteCloudProject(id);
    }
    const remain = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name === name).length;
    log(remain === 0, 'takarítás: a teszt-projekt a felhőből is törölve', `maradt ${remain}`);
  }
}

/**
 * 🎹 S11 (MU2): piano roll — hanghossz koppintással (a hang vége után hosszabbodik, belül rövidül), rács-felbontás
 * (1/16, triola), skála-illesztés (C-dúr: a C# a legközelebbi skálahangra), oktáv-görgetés C1…C7; a sütés egy undo.
 */
async function smokePianoRoll2(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_pianoroll2';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:pianoroll2', caught));
  await saveProject({ ...createEmptyProject('smoke piano roll', '9:16', undefined, 'audio'), id, bpm: 120 });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const music = () => st().project!.tracks.find((t) => t.type === 'music')!.clips as AudioClip[];
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  try {
    runDevAction('audio.openPianoRoll');
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      await sleep(100);
      ready = runDevAction('synth.notesFull') !== undefined;
    }
    log(ready, 'a piano roll nyílik', `${ready}`);
    // 1) 1/16-os rács: négy szomszédos koppintás egy 1 ütemes hangot ad (a vége után koppintva hosszabbodik)
    runDevAction('synth.grid', 4);
    await sleep(200);
    for (const beat of [0, 0.25, 0.5, 0.75]) {
      runDevAction('synth.tap', { midi: 60, beat });
      await sleep(80);
    }
    await sleep(200);
    const n1 = runDevAction('synth.notesFull') as string;
    log(n1 === '60@0+1', 'hanghossz: a vége utáni cellák egy 1 ütemes hanggá hosszabbítják (1/16-os rács)', n1);
    // 2) belül koppintva rövidül (0,5-nél végződik)
    runDevAction('synth.tap', { midi: 60, beat: 0.5 });
    await sleep(200);
    const n2 = runDevAction('synth.notesFull') as string;
    log(n2 === '60@0+0.5', 'belül koppintva a hang ott végződik (0,5 ütem)', n2);
    // 3) triola-rács: a lépés 1/3 ütem
    runDevAction('synth.grid', 3);
    await sleep(200);
    runDevAction('synth.tap', { midi: 64, beat: 1 });
    await sleep(200);
    const n3 = runDevAction('synth.notesFull') as string;
    log(n3 === '60@0+0.5,64@1+0.333', 'triola-rács: az új hang 1/3 ütem hosszú', n3);
    // 4) skála-illesztés: C-dúrban a C# (61) koppintása a legközelebbi skálahangra (60, döntetlennél lefelé) esik
    //    (a lassú eszközön a lap újrarajzolását megvárjuk: a koppintás a friss skála-állapottal menjen)
    const scaleIs = (want: string | null) => (runDevAction('synth.state') as { key: { scale: string } | null } | undefined)?.key?.scale === want || (want === null && (runDevAction('synth.state') as { key: unknown } | undefined)?.key === null);
    runDevAction('synth.grid', 4);
    runDevAction('synth.scale', { root: 0, scale: 'major', snap: true });
    await waitFor(() => scaleIs('major'), 3000);
    await sleep(150);
    runDevAction('synth.tap', { midi: 61, beat: 2 });
    await sleep(200);
    const n4 = runDevAction('synth.notesFull') as string;
    log(n4.endsWith('60@2+0.25'), 'skála-illesztés: a C# a C-dúr legközelebbi hangjára (C) esik', n4);
    // skála ki → a C# marad C#
    runDevAction('synth.scale', null);
    await waitFor(() => scaleIs(null), 3000);
    await sleep(150);
    runDevAction('synth.tap', { midi: 61, beat: 3 });
    await sleep(200);
    const n5 = runDevAction('synth.notesFull') as string;
    log(n5.endsWith('61@3+0.25'), 'skála nélkül a koppintott sor marad', n5);
    // 5) oktáv-görgetés: C3–C6 → C4–C7 → a tetőn marad; vissza C1-ig (a lassú eszközön az újrarajzolást megvárjuk)
    const rangeNow = () => (runDevAction('synth.state') as { range: { lowMidi: number; highMidi: number } }).range;
    const octave = async (dir: 1 | -1, expectLow: number) => {
      runDevAction('synth.octave', dir);
      await waitFor(() => rangeNow().lowMidi === expectLow, 3000);
      return rangeNow();
    };
    const s0 = rangeNow();
    const s1 = await octave(1, 60);
    const s2 = await octave(1, 60);
    let s3 = s2;
    for (let i = 0; i < 6; i++) s3 = await octave(-1, Math.max(24, s3.lowMidi - 12));
    const ok5 = s0.lowMidi === 48 && s1.lowMidi === 60 && s1.highMidi === 96 && s2.lowMidi === 60 && s3.lowMidi === 24;
    log(ok5, 'oktáv-görgetés: C3–C6 → C4–C7 (a tetőn marad), le C1-ig', `${s0.lowMidi}→${s1.lowMidi}→${s2.lowMidi}→${s3.lowMidi}`);
    // 6) sütés: a hangok a klipbe, a minta a projektben (3 hang), egy undo
    runDevAction('synth.bake');
    const baked = await waitFor(() => music().length === 1, 15000);
    const c = music()[0];
    const doc = c ? instrumentDocOf(st().project, c.instrumentDocId) : null;
    // az utolsó hang vége 3,25 ütem = 1,625 s 120 BPM-en (a tört hosszak a renderben is pontosak)
    log(baked && doc?.kind === 'synth' && doc.synth?.notes.length === 4 && Math.abs(c.duration - 1.625) < 0.05, 'sütés: a klip a mintára hivatkozik (4 hang, tört hosszakkal), a hossz a hangokból (3,25 ütem = 1,625 s)', `${doc?.synth?.notes.length} hang, ${c?.duration.toFixed(3)} s`);
    st().undo();
    await sleep(300);
    log(music().length === 0, 'egy visszavonás: nincs klip', `${music().length}`);
  } finally {
    runDevAction('audio.closePianoRoll');
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:pianoroll2-del', caught));
  }
}

/** 🎬 AP8: a videóból nyitott Hang Stúdióban a lejátszófejhez tartozó videó-képkocka látszik (± 1 kocka). */
async function smokeVideoRef(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { downloadToCache } = await import('@/lib/media');
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, 'smoke_videoref.mp4');
  if (!vid) {
    log(false, 'a teszt-videó letöltése', 'nincs');
    return;
  }
  const id = 'prj_smoke_videoref';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoref', caught));
  const base = createEmptyProject('smoke videó-referencia', '9:16');
  const video = { kind: 'video', id: 'vv', uri: vid, label: 'videó', start: 0, duration: 6, trimIn: 0, speed: 1, volume: 1 } as unknown as AudioClip;
  const music: AudioClip = { kind: 'audio', id: 'aa', label: 'zene', start: 0, duration: 6, trimIn: 0, sourceDuration: 6, uri: toneWav('smoke_videoref.wav', 6), volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, fps: 30, tracks: base.tracks.map((t) => (t.type === 'video' ? { ...t, clips: [video] } : t.type === 'music' ? { ...t, clips: [music] } : t)) });
  router.push(`/editor/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1500);
  try {
    st().openAudioStudio('aa');
    await sleep(1200);
    for (const at of [2.5, 4.0]) {
      st().setPlayhead(at);
      type Ref = { ms: number; clipId: string; uri: string; at: number };
      let ref = null as Ref | null;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        ref = runDevAction('audio.videoRef') as Ref | null;
        if (ref && Math.abs(ref.at - at) < 1e-6) break;
      }
      const ok = !!ref && ref.clipId === 'vv' && Math.abs(ref.ms - at * 1000) <= 34 && new File(ref.uri).exists;
      log(ok, `lejátszófej ${at} s → a videó ${at} s-os képkockája látszik (± 1 kocka)`, ref ? `${ref.ms} ms, ${ref.clipId}` : 'nincs kép');
      if (at === 2.5) {
        log(true, 'FOTÓZHATÓ', 'a videóból nyitott Hang Stúdió a lebegő videó-képkockával');
        await sleep(2000);
      }
    }
  } finally {
    st().closeAudioStudio();
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoref-del', caught));
  }
}

/** ⏱️ DSP-profil az eszközön (Hermes): 3 klip 8 s-a fokozatonként (ideiglenes mérés). */
async function smokeDspProf(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const src = Float32Array.from({ length: 20 * SR }, (_, i) => Math.sin(i / 20) * 0.3);
  const run = (fx: object, master: boolean, sec = 2) => {
    const base = createEmptyProject('x', '9:16', undefined, 'audio');
    const mk = (cid: string, start: number, pan: number) => ({ kind: 'audio', id: cid, uri: 'file:///a.wav', label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, pan, audioFx: fx, source: 'imported' });
    const project = { ...base, ...(master ? { audioMaster: { target: 'custom', lufs: -14, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: -1, high: 1.5 }, multiband: true } } : {}), tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [mk('m', 0, -0.5)] } : t.type === 'sfx' ? { ...t, clips: [mk('s', 0.5, 0.5)] } : t.type === 'voiceover' ? { ...t, clips: [mk('v', 1, 0)] } : t)) } as unknown as Project;
    const plan = { ...offlineMixPlan(project), masterGain: 1 };
    const sources = new Map([['file:///a.wav', { channels: [src, src], sampleRate: SR }]]);
    const state = new Map();
    const CH = Math.round(0.125 * SR);
    const t0 = Date.now();
    for (let a = SR; a < (1 + sec) * SR; a += CH) {
      const out: [Float32Array, Float32Array] = [new Float32Array(CH), new Float32Array(CH)];
      mixRange(plan, sources as never, out, a, a + CH, 1, state);
    }
    return Math.round((Date.now() - t0) / (sec * 8));
  };
  const all = { highpass: 90, lowpass: 12000, eq: { low: 3, mid: -2, high: 2 }, gate: true, deEsser: true, compressor: true, reverb: 0.5, delay: 0.4, stereoWide: true, limiter: true };
  run({}, false, 1);
  const rows = [`semmi ${run({}, false)}`, `master ${run({}, true)}`];
  for (const [k, v] of Object.entries(all)) rows.push(`${k} ${run({ [k]: v }, false)}`);
  rows.push(`mind ${run(all, false)}`, `mind+master ${run(all, true)}`);
  log(null, 'ms / 125 ms-os szelet (3 klip)', rows.join(' | '));
  // egy mag-hívás ára (5512 mintás sztereó szelet): a natív számítás vs a híváskeret
  const bl = new Float32Array(5512);
  const br = new Float32Array(5512);
  const bp = Float64Array.of(0.2, 0.4, 0.2, -0.5, 0.3);
  const bs = new Float64Array(8);
  let t1 = Date.now();
  for (let k = 0; k < 200; k++) runKernel(KERNEL.BIQUAD, bl, br, bp, bs);
  const nat = (Date.now() - t1) / 200;
  t1 = Date.now();
  for (let k = 0; k < 20; k++) runKernelJs(KERNEL.BIQUAD, bl, br, bp, bs);
  const jsMs = (Date.now() - t1) / 20;
  const sm = new Float32Array(64);
  t1 = Date.now();
  for (let k = 0; k < 2000; k++) runKernel(KERNEL.BIQUAD, sm, sm, bp, bs);
  log(null, 'egy biquad-hívás', `natív ${nat.toFixed(3)} ms · JS ${jsMs.toFixed(2)} ms · üres hívás ${((Date.now() - t1) / 2000).toFixed(3)} ms`);
}

/** ⚡ A natív DSP-mag = a JS-mag, bitre (minden fajta, darabolva, eltolt `subarray`-jel is); és a sebesség. */
async function smokeDspNative(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(nativeDspActive(), 'a natív DSP-mag be van kötve (a build tudja)', `${nativeDspActive()}`);
  if (!nativeDspActive()) return;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const sig = (n: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * (Math.sin(i / 7) * 0.6 + rnd() * 0.4) * (i % 3000 < 1500 ? 1 : 0.02));
  const hs = highShelfNorm(5500, 0, 44100);
  const cases: { name: string; kind: KernelKind; p: () => Float64Array; st: () => Float64Array; aux?: () => Float32Array }[] = [
    { name: 'biquad', kind: KERNEL.BIQUAD, p: () => Float64Array.of(0.2, 0.4, 0.2, -0.5, 0.3), st: () => new Float64Array(8) },
    { name: 'kompresszor', kind: KERNEL.COMP, p: () => Float64Array.of(-18, 3, 0.004, 0.0002, 9), st: () => new Float64Array(1) },
    { name: 'kapu', kind: KERNEL.GATE, p: () => Float64Array.of(-26, -24.4, 9, 0.004, 0.0003), st: () => Float64Array.of(0, 1) },
    { name: 'limiter', kind: KERNEL.LIMIT, p: () => Float64Array.of(0.5, 0.0005), st: () => Float64Array.of(1) },
    { name: 'szaturáció', kind: KERNEL.SAT, p: () => Float64Array.of(3.8, 1 / Math.tanh(3.8)), st: () => new Float64Array(0) },
    { name: 'haas', kind: KERNEL.HAAS, p: () => Float64Array.of(90, 93), st: () => new Float64Array(1), aux: () => new Float32Array(94) },
    { name: 'visszhang', kind: KERNEL.ECHO, p: () => Float64Array.of(0.8, 0.9, 2, 1764, 3308, 0.55, 0.39), st: () => new Float64Array(2), aux: () => new Float32Array(2 * 3309) },
    { name: 'de-esser', kind: KERNEL.DEESS, p: () => Float64Array.of(0.25, 0.01, 0.0004, 44100, 7, ...hs), st: () => { const x = new Float64Array(24); x[2] = 1; x[3] = 1; return x; } },
  ];
  const eqBits = (a: Float32Array | Float64Array, b: Float32Array | Float64Array) => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  };
  for (const c of cases) {
    const N = 6000;
    const L0 = sig(N + 64, 0.9);
    const R0 = sig(N + 64, 0.7);
    const run = (fn: typeof runKernel) => {
      const l = Float32Array.from(L0);
      const r = Float32Array.from(R0);
      const p = c.p();
      const st = c.st();
      const aux = c.aux ? c.aux() : null;
      // három darab, a középső eltolt nézet (subarray) — a darabolás és az eltolás is számít
      fn(c.kind, l.subarray(0, 2000), r.subarray(0, 2000), p, st, aux);
      fn(c.kind, l.subarray(2000, 4100), r.subarray(2000, 4100), p, st, aux);
      fn(c.kind, l.subarray(4100, N), r.subarray(4100, N), p, st, aux);
      return { l, r, st, aux };
    };
    const js = run(runKernelJs);
    const nat = run(runKernel);
    const same = eqBits(js.l, nat.l) && eqBits(js.r, nat.r) && eqBits(js.st, nat.st) && (!js.aux || eqBits(js.aux, nat.aux!));
    let maxd = 0;
    for (let i = 0; i < N; i++) maxd = Math.max(maxd, Math.abs(js.l[i] - nat.l[i]), Math.abs(js.r[i] - nat.r[i]));
    log(same || (Platform.OS === 'android' && maxd < 1e-6), `${c.name}: natív = JS ${same ? '(bitre)' : '(a libm utolsó bitjén belül)'}`, `max eltérés ${maxd.toExponential(1)}`);
  }
}

/** ✂️🎚️ Tartomány- és stem-export: a tartomány = a teljes export szelete (masterrel), Σ stem = keverés master nélkül, a némított sáv kimarad. */
async function smokeStemExport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const mk = (name: string, sec: number, f: number, gate?: (t: number) => number) => {
    const x = Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => 0.4 * Math.sin((2 * Math.PI * f * i) / SR) * (gate ? gate(i / SR) : 1));
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
    file.create();
    file.write(encodeWav16([x, x], SR, () => 0.5));
    return file.uri;
  };
  const voice = mk('smoke_stem_voice.wav', 4, 220, (t) => (t > 1 && t < 2.5 ? 1 : 0));
  const music = mk('smoke_stem_music.wav', 4, 440);
  const fx = mk('smoke_stem_fx.wav', 1, 880);
  const id = 'prj_smoke_stems';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:stems', caught));
  const base = createEmptyProject('smoke stemek', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: voice, start: 0, duration: 4, sourceDuration: 4, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    audioMaster: { target: 'custom', lufs: -16, truePeak: -1, dynamics: 'balanced', eq: { low: 2, mid: 0, high: 1 }, multiband: true },
    audioBuses: [{ id: 'rev', name: 'Zengés', fx: { reverb: 0.5 }, gain: 0.8 }],
    audioSends: { sfx: { rev: 0.6 } },
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'v', label: 'beszéd' })] }
        : t.type === 'music'
          ? { ...t, clips: [ac({ id: 'm', label: 'zene', uri: music, autoDuck: true })] }
          : t.type === 'sfx'
            ? { ...t, clips: [ac({ id: 'f', label: 'hang', uri: fx, start: 2, duration: 1, sourceDuration: 1 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const tt = i18nT as unknown as TFunction;
  /** 24 bites, sztereó WAV-bájtok → bal csatorna (dither nélkül pontos) */
  const wav24Left = (b: Uint8Array) => {
    const n = (b.length - 44) / 6;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 6;
      let v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      out[i] = v / 8388607;
    }
    return out;
  };
  const readAll = (uri: string) => {
    const h = new File(uri).open();
    try {
      return h.readBytes(h.size ?? 0);
    } finally {
      h.close();
    }
  };
  // a teljes export (masterrel), 24 bit
  const mix = mixForExport(st().project!, st().isTrackAudible, st().masterVolume)!;
  const full = await exportOfflineWav(mix, new File(projectExportDir(), 'smoke_stem_full.wav'), undefined, undefined, 'pcm16', { bits: 24 });
  const fullL = wav24Left(readAll(full.uri));
  // In–Out a transzporttal
  st().setPlayhead(1.2);
  st().setRangeIn();
  st().setPlayhead(3.1);
  st().setRangeOut();
  const rng = await exportParts(st().project!, { range: true, stems: false }, 24, tt, false);
  const rL = rng ? wav24Left(readAll(rng.uri)) : new Float32Array();
  const a0 = Math.round(1.2 * SR);
  let d = 0;
  for (let i = 0; i < rL.length; i++) d = Math.max(d, Math.abs(rL[i] - fullL[a0 + i]));
  log(rL.length === Math.round(3.1 * SR) - a0 && d === 0, 'tartomány (In 1,2 – Out 3,1 s, master-lánccal): mintára a teljes export szelete', `${(rL.length / SR).toFixed(3)} s, max eltérés ${d}`);
  // stemek
  const zipRes = await exportParts(st().project!, { range: false, stems: true }, 24, tt, false);
  const zb = zipRes ? readAll(zipRes.uri) : new Uint8Array();
  const eocd = parseEocd(zb, 0)!;
  const entries = parseCentralDirectory(zb.subarray(eocd.cdOffset, eocd.cdOffset + eocd.cdSize), eocd.count);
  const stems = entries.map((e) => {
    const off = localDataOffset(zb.subarray(e.headerOffset, e.headerOffset + 300), e.headerOffset);
    const data = zb.subarray(off, off + e.size);
    return { name: e.name, crcOk: crc32(data) === e.crc, left: wav24Left(data) };
  });
  log(stems.length === 3 && stems.every((x) => x.crcOk), 'a ZIP: 3 stem, mind ép (CRC)', stems.map((x) => x.name).join(' · '));
  const ref = await exportOfflineWav({ ...mix, audioMaster: undefined }, new File(projectExportDir(), 'smoke_stem_ref.wav'), undefined, undefined, 'pcm16', { bits: 24 });
  const refL = wav24Left(readAll(ref.uri));
  let ds = 0;
  for (let i = 0; i < refL.length; i++) ds = Math.max(ds, Math.abs(stems.reduce((s2, x) => s2 + (x.left[i] ?? 0), 0) - refL[i]));
  log(ds < 4e-7, 'Σ stem = a keverés master nélkül (a halkítás és a zengés-busz is benne)', `max eltérés ${ds.toExponential(1)} (24 bit: 1 LSB = 1,2e-7)`);
  const musicStem = stems.find((x) => x.name.includes(laneLabelFor('music', tt)))?.left;
  const lvl = (x: Float32Array | undefined, s0: number, s1: number) => {
    if (!x) return -999;
    let e = 0;
    for (let i = Math.round(s0 * SR); i < Math.round(s1 * SR); i++) e += x[i] * x[i];
    return 10 * Math.log10(e / ((s1 - s0) * SR) + 1e-30);
  };
  const duck = lvl(musicStem, 1.6, 2.3) - lvl(musicStem, 0.3, 0.9);
  log(duck < -6, 'a zene-stem a beszéd alatt halkul (a némított beszéd a kulcs)', `${duck.toFixed(1)} dB`);
  // a némított sáv kimarad; tartomány + stemek
  st().toggleTrackFlag('sfx', 'mute');
  const muted = await exportParts(st().project!, { range: true, stems: true }, 16, tt, false);
  const mb = muted ? readAll(muted.uri) : new Uint8Array();
  const me = parseEocd(mb, 0)!;
  const ment = parseCentralDirectory(mb.subarray(me.cdOffset, me.cdOffset + me.cdSize), me.count);
  const frames = (bytes: number) => (bytes - 44) / 4;
  log(ment.length === 2 && ment.every((e) => frames(e.size) === Math.round(3.1 * SR) - a0), 'a némított effekt-sáv kimarad; tartomány + stemek: minden stem pontosan a tartomány hosszú (16 bit)', ment.map((e) => `${e.name} ${(frames(e.size) / SR).toFixed(3)} s`).join(' · '));
  st().toggleTrackFlag('sfx', 'mute');
  for (const u of [full.uri, ref.uri, rng?.uri, zipRes?.uri, muted?.uri]) if (u) new File(u).delete();
  runDevAction('audio.exportSheet');
  log(true, 'FOTÓZHATÓ', 'az export-lap: Tartomány és Tartalom');
  await sleep(3500);
  st().clearRange();
  router.back();
}

/** 🔗 Külső hang szinkronja: ismert eltolású, tompább, zajos „külön mikrofon” a kamera hangjához. */
async function smokeExtSync(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const refUri = await downloadToCache(`${smokeFileHost()}/speech_en.wav`, 'smoke_sync_ref.wav');
  const huUri = await downloadToCache(`${smokeFileHost()}/speech_hu.wav`, 'smoke_sync_hu.wav');
  if (!refUri || !huUri) {
    log(false, 'a próbahangok letöltése', '-');
    return;
  }
  const api = (await loadAudioApi())!;
  const x = (await api.decodeAudioData(refUri, SR)).getChannelData(0);
  // „külön mikrofon”: 1,2345 s szobazaj elöl, tompább (egypólusú aluláteresztő), halkabb, zajos
  const P = Math.round(1.2345 * SR);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let lp = 0;
  const y = new Float32Array(P + x.length);
  for (let i = 0; i < y.length; i++) {
    const v = i >= P ? x[i - P] : 0;
    lp = 0.6 * lp + 0.4 * v;
    y[i] = 0.4 * lp + 0.01 * rnd();
  }
  const extFile = new File(Paths.document, 'smoke_sync_ext.wav');
  if (extFile.exists) extFile.delete();
  extFile.create();
  extFile.write(encodeWav16([y, y], SR, () => 0.5));
  const truth = 2 - P / SR; // a kamera-hang 2 s-nál indul → a külön mikrofon helye
  const id = 'prj_smoke_sync';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:sync', caught));
  const base = createEmptyProject('smoke szinkron', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: refUri, start: 0, duration: 8.2, sourceDuration: 8.2, id: 'x', ...over });
  const extDur = Math.floor((y.length / SR) * 1000) / 1000;
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'cam', label: 'kamera', start: 2 })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'mic', label: 'mikrofon', uri: extFile.uri, start: 1, duration: extDur, sourceDuration: extDur })] }
          : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().selectClip('mic');
  const t0 = Date.now();
  const r = (await runDevAction('audio.syncSelected')) as { target: number; confidence: number; lag: number } | null;
  const mic = st().project!.tracks.find((t) => t.type === 'sfx')!.clips[0] as AudioClip;
  const placed = mic.start - (mic.trimIn ?? 0); // a forrás 0 pontja az idővonalon
  const errMs = r ? (r.target - truth) * 1000 : NaN;
  log(!!r && Math.abs(errMs) < 0.1 && r.confidence >= SYNC_MIN_CONFIDENCE, 'a talált eltolás a valóditól < 0,1 ms (más hangszín, halkabb, zajos)', `hiba ${errMs.toFixed(4)} ms, egyezés ${r?.confidence.toFixed(1)}, ${Date.now() - t0} ms alatt`);
  log(Math.abs(placed - truth) < 1e-4 && Math.abs(mic.start * 30 - Math.round(mic.start * 30)) < 1e-4, 'a klip a frame-rácson, a maradék a trimIn-ben — a hang mintapontosan a helyén', `kezdet ${mic.start.toFixed(6)} (rács), trimIn ${mic.trimIn?.toFixed(6)}, forrás-0 @ ${placed.toFixed(6)} (valódi ${truth.toFixed(6)})`);
  log(true, 'FOTÓZHATÓ', 'a mikrofon-klip a kamera-hang alá igazítva');
  await sleep(2500);
  // a keverőn át: a két sáv külön exportja egymáshoz mérve
  const render = async (keep: string, name: string) => {
    const p: Project = { ...st().project!, tracks: st().project!.tracks.map((t) => (t.type === keep ? t : { ...t, clips: [] })) };
    const { uri: o } = await exportOfflineWav(p, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const d = (await api.decodeAudioData(o, SR)).getChannelData(0);
    new File(o).delete();
    return d;
  };
  const camOut = await render('voiceover', 'smoke_sync_cam.wav');
  const micOut = await render('sfx', 'smoke_sync_mic.wav');
  const w0 = Math.round(3 * SR);
  const w1 = Math.round(7 * SR);
  const check = gccPhatLag(camOut.subarray(w0 - SR, w1 + SR), micOut.subarray(w0, w1), SR, 1.5);
  const mixErr = (check.lag - 1) * 1000;
  log(Math.abs(mixErr) < 0.1, 'a lejátszásban (export) a két sáv együtt szól: eltérés < 0,1 ms', `${mixErr.toFixed(4)} ms (${((mixErr / 1000) * SR).toFixed(2)} minta)`);
  st().undo();
  const back = st().project!.tracks.find((t) => t.type === 'sfx')!.clips[0];
  log(back.start === 1, 'egy visszavonás: a klip vissza az eredeti helyére', `${back.start}`);
  // idegen felvétel: nincs egyezés, a klip nem mozdul
  const hu: AudioClip = ac({ id: 'hu', uri: huUri, start: 1, duration: 9.3, sourceDuration: 9.3 });
  const camClip = st().project!.tracks.find((t) => t.type === 'voiceover')!.clips[0] as AudioClip;
  const neg = await syncClipTo(camClip, hu, 30);
  log(!!neg && neg.confidence < SYNC_MIN_CONFIDENCE, 'idegen felvételre (magyar beszéd) nincs egyezés', `egyezés ${neg?.confidence.toFixed(2)} < ${SYNC_MIN_CONFIDENCE}`);
  await sleep(1000);
  router.back();
}

/** 🇭🇺 Magyar beszédvágás: az alap modell szóhibái, a pontosabb (small) modell letöltése az átirat-sávból, újra-mérés, egy szó kivágása. */
async function smokeSpeechHu(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = await downloadToCache(`${smokeFileHost()}/speech_hu.wav`, 'smoke_speech_hu.wav');
  if (!src) {
    log(false, 'a próbahang letöltése', '-');
    return;
  }
  clearSpeechWordCache();
  const norm = (ws: { text: string }[]) => ws.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' ');
  const expected = 'sziasztok és üdv a műsorban ma arról beszélünk hogyan lehet szöveggel hangot vágni ha törölsz egy szót a hang is kivágódik';
  const wordDiff = (a: string, b: string) => {
    const x = a.split(' ');
    const y = b.split(' ');
    const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  };
  const pcm = await decodeToMono16k(src);
  // viszonyítás: az eszközön meglévő kisebb modell (base, ennek hiányában tiny)
  const smallerId = ['whisper-base-q5', 'whisper-tiny-q8'].find((m) => {
    const e = catalogEntry(m);
    return e && catalogAvailability(e, catalogRuntime()) === 'validated';
  });
  const base = pcm && smallerId ? await transcribeWordsOnDevice(pcm, 0, { modelId: smallerId }) : null;
  const baseHeard = base ? norm(base.words) : 'null';
  const baseErr = wordDiff(baseHeard, expected);
  log(!!base, `a kisebb modell (${smallerId ?? '-'})`, `${baseHeard} — ${baseErr} szóhiba / 20`);
  const id = 'prj_smoke_speech_hu';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:speechhu', caught));
  const p0 = createEmptyProject('smoke magyar beszédvágás', '9:16', undefined, 'audio');
  const vo: AudioClip = { kind: 'audio', id: 'vo', label: 'beszéd', uri: src, start: 0, duration: 9.3, trimIn: 0, sourceDuration: 9.3, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...p0, id, tracks: p0.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [vo] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().selectClip('vo');
  await runDevAction('audio.speechStart');
  const t0 = Date.now();
  const n = (await runDevAction('audio.speechUpgrade')) as number | null;
  const small = norm(currentSpeechWords());
  const smallErr = wordDiff(small, expected);
  log(bestUsableWhisperModelId() === 'whisper-small-q5' && n !== null, '„Pontosabb felismerés”: a small letöltve (sha256 + próba), a sáv újra átírva', `${bestUsableWhisperModelId()}, ${n} szó, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(!!base && smallErr < baseErr, 'a small magyarul pontosabb, mint a kisebb modell', `${small} — ${smallErr} szóhiba / 20 (${smallerId}: ${baseErr})`);
  log(true, 'FOTÓZHATÓ', 'a magyar átirat a small modellel');
  await sleep(2500);
  // egy magyar szó kivágása, az eredmény újra-átírva
  const ws = currentSpeechWords();
  const target = ws.find((w) => norm([w]) === 'hangot') ?? ws[0];
  useSpeechEdit.setState({ selected: new Set([target.key]), mode: 'track' });
  runDevAction('audio.speechApply');
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_hu_out.wav'));
  const p2 = await decodeToMono16k(out);
  new File(out).delete();
  const re = p2 ? await transcribeWordsOnDevice(p2, 0) : null;
  const got = re ? norm(re.words) : 'null';
  const want = small.split(' ').filter((x) => x !== norm([target])).join(' ');
  log(!!re && !got.split(' ').includes(norm([target])) && wordDiff(got, want) <= 3, `„${target.text}” kivágva (folyamatos beszédből): az újra-átírásban nincs, a többi megvan (≤ 3 szó eltérés — a felismerő futásonként ennyit ingadozik)`, `${got} — ${wordDiff(got, want)} szó`);
  st().undo();
  await sleep(1000);
  router.back();
}

/** ✂️💬 Beszédvágás szöveggel: átirat, töltelékek kijelölése, kivágás, az eredmény újra-átírva, undo, minden sáv. */
async function smokeSpeechEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = await downloadToCache(`${smokeFileHost()}/speech_en.wav`, 'smoke_speech_en.wav');
  if (!src) {
    log(false, 'a próbahang letöltése', '-');
    return;
  }
  clearSpeechWordCache();
  const norm = (ws: { text: string }[]) => ws.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')).filter(Boolean).join(' ');
  const expected = 'hello and welcome to the show um today we talk about uh editing audio with text delete a word and the sound is cut';
  const id = 'prj_smoke_speech';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:speech', caught));
  const base = createEmptyProject('smoke beszédvágás', '9:16', undefined, 'audio');
  const bed = toneWav('smoke_speech_bed.wav', 9);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported', uri: src, start: 0, duration: 8.2, sourceDuration: 8.2, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'vo', label: 'beszéd' })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'fx', label: 'hang', uri: bed, start: 7.5, duration: 0.5, sourceDuration: 9, volume: 0.2 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'bed', label: 'zene', uri: bed, duration: 8.2, sourceDuration: 9, volume: 0.1 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const track = (type: string) => (st().project?.tracks.find((t) => t.type === type)?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('vo');
  const t0 = Date.now();
  const count = (await runDevAction('audio.speechStart')) as number | null;
  const words = currentSpeechWords();
  // szó-szintű eltérés (Levenshtein a szavakon)
  const wordDiff = (a: string, b: string) => {
    const x = a.split(' ');
    const y = b.split(' ');
    const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  };
  const heard = norm(words);
  // a modellek a töltelékeket eltérően írják (uh/ah), és egy-egy szót félrehallhatnak
  log(wordDiff(heard, expected) <= 2, `az átirat a telefonon (${bestUsableWhisperModelId()}, ${Date.now() - t0} ms, ${count} szó) ≈ a felolvasott szöveg (≤ 2 szó eltérés)`, `${heard} — eltérés ${wordDiff(heard, expected)}`);
  const fillers = runDevAction('audio.speechFillers') as number;
  const picked = words.filter((w) => useSpeechEdit.getState().selected.has(w.key)).map((w) => w.text).join(' ');
  const pickedNorm = words.filter((w) => useSpeechEdit.getState().selected.has(w.key)).map((w) => norm([w]));
  const minus = words.filter((w) => !useSpeechEdit.getState().selected.has(w.key)).map((w) => norm([w])).join(' ');
  log(fillers === 2 && pickedNorm.every((x) => ['um', 'uh', 'ah', 'er', 'erm', 'umm', 'uhh'].includes(x)), 'Töltelékek: a két töltelék („um”, „uh”) kijelölve', picked);
  log(true, 'FOTÓZHATÓ', 'az átirat-sáv két áthúzott töltelékkel, a sávon pirosan');
  await sleep(2500);
  const plannedCuts = wordCutRanges(currentSpeechWords(), useSpeechEdit.getState().selected, 30);
  const beforeCut = st().project!;
  const cuts = runDevAction('audio.speechApply') as number;
  const vo = track('voiceover');
  const kept = vo.reduce((s, c) => s + c.duration, 0);
  log(cuts === 2 && vo.length === 3, 'Kivágás: 2 tartomány, a beszéd 3 darabban', `${vo.map((c) => `${c.start.toFixed(2)}+${c.duration.toFixed(2)}`).join(' · ')} (−${(8.2 - kept).toFixed(2)} s)`);
  const after = currentSpeechWords();
  log(norm(after) === minus && after.every((w, i) => i === 0 || w.start >= after[i - 1].start), 'az átirat magától frissül: a töltelékek eltűntek, a többi a helyén', norm(after));
  log(track('sfx')[0]?.start === 7.5 && track('music').length === 1, 'csak ez a sáv: a többi érintetlen', `effekt ${track('sfx')[0]?.start}, zene ${track('music').length}`);
  // a valódi bizonyíték: az eredmény hangját újra átírjuk
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_out.wav'));
  const pcm = await decodeToMono16k(out);
  new File(out).delete();
  const re = pcm ? await transcribeWordsOnDevice(pcm, 0) : null;
  // betű-szintű eltérés (a szóközök nélkül — a tiny modell néha összevon két szót)
  const charDiff = (a: string, b: string) => wordDiff(a.replace(/ /g, '').split('').join(' '), b.replace(/ /g, '').split('').join(' '));
  const reHeard = re ? norm(re.words) : 'null';
  log(!!re && charDiff(reHeard, minus) <= 3 && !/\b(um|uh|ah)\b/.test(reHeard), 'az export újra-átírva ≈ az eredeti átirat a két töltelék nélkül (nincs „um”/„uh”, ≤ 3 betű eltérés)', `${reHeard} — ${charDiff(reHeard, minus)} betű (${pcm ? (pcm.length / 16000).toFixed(2) : '-'} s)`);
  // a hang mintára: a vágások közti szakaszok = az eredeti, a kivágott idővel eltolva
  const SR = 44100;
  const render = async (p: Project, name: string) => {
    const { uri: o } = await exportOfflineWav(voOnly(p), new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(o, SR)).getChannelData(0);
    new File(o).delete();
    return y;
  };
  const yA = await render(beforeCut, 'smoke_sp_a.wav');
  const yB = await render(st().project!, 'smoke_sp_b.wav');
  let shift = 0;
  let maxD = 0;
  let from = 0;
  for (const r of [...plannedCuts, { start: 8.2, end: 8.2 }]) {
    // a szakasz belseje (a vágás-varratok 10 ms-os mikro-fade-je nélkül)
    for (let i = Math.round((from + 0.012) * SR); i < Math.round((r.start - 0.012) * SR); i++) maxD = Math.max(maxD, Math.abs(yA[i] - (yB[i - shift] ?? 0)));
    shift += Math.round((r.end - r.start) * SR);
    from = r.end;
  }
  log(maxD < 1e-6 && plannedCuts.length === 2, 'a hang mintára: a megmaradt beszéd = az eredeti, a kivágott idővel előbb', `max eltérés ${maxD.toExponential(1)}, vágások ${plannedCuts.map((r) => `${r.start.toFixed(3)}–${r.end.toFixed(3)}`).join(', ')}`);
  st().undo();
  log(track('voiceover').length === 1 && norm(currentSpeechWords()) === heard, 'egy visszavonás: az egész klip és a teljes átirat vissza (újra-átírás nélkül)', `${track('voiceover').length} klip`);
  // minden sáv: az effekt is a kivágott idővel előbb jön
  runDevAction('audio.speechFillers');
  runDevAction('audio.speechModeAll');
  runDevAction('audio.speechApply');
  const removed = 8.2 - track('voiceover').reduce((s, c) => s + c.duration, 0);
  log(Math.abs((track('sfx')[0]?.start ?? 0) - (7.5 - removed)) < 1e-4 && track('music').length === 1 && track('music')[0].start === 0, 'minden sáv: az effekt előbb jön, a zene nem vágódik', `effekt ${track('sfx')[0]?.start.toFixed(6)} (7,5 − ${removed.toFixed(6)}), zene ${track('music').map((c) => `${c.start}+${c.duration}`).join(',')}`);
  st().undo();
  // szón belüli vágás folyamatos beszédben: az „audio” az „editing audio” közepéről
  const reCut = async (word: string) => {
    const ws = currentSpeechWords();
    const w = ws.find((x) => norm([x]) === word);
    if (!w) return null;
    useSpeechEdit.setState({ selected: new Set([w.key]), mode: 'track' });
    runDevAction('audio.speechApply');
    const { uri: o } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_w.wav'));
    const p16 = await decodeToMono16k(o);
    new File(o).delete();
    const r2 = p16 ? await transcribeWordsOnDevice(p16, 0) : null;
    const base0 = norm(ws);
    st().undo();
    return { want: base0.split(' ').filter((x, i, arr) => !(x === word && arr.indexOf(word) === i)).join(' '), got: r2 ? norm(r2.words) : 'null' };
  };
  const inner = await reCut('audio');
  // folyamatos beszédben a vágásnak nincs szünete: a felismerő a varratnál egy szót félrehallhat
  log(!!inner && wordDiff(inner.got, inner.want) <= 1 && !/\baudio\b/.test(inner.got), 'szón belüli vágás („editing audio” → „editing”): az újra-átírásban nincs „audio”, a többi megvan (≤ 1 szó eltérés)', inner ? `${inner.got} — ${wordDiff(inner.got, inner.want)} szó` : '-');
  await sleep(1500);
  router.back();
}

/** 🧪 Whisper szó-szintű szonda: motor, modell, és a felismert szavak egy ismert szövegű felvételen. */
async function smokeWhisperProbe(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(null, 'motor', `${whisperEngineAvailable()} · modellek: ${listCachedModels().map((m) => m.id).join(', ') || '-'} · legjobb: ${bestUsableWhisperModelId() ?? '-'}`);
  if (!bestUsableWhisperModelId()) {
    const entry = catalogEntry('whisper-base-q5');
    const t0 = Date.now();
    const res = entry?.manifest ? await downloadModel(entry.manifest) : null;
    const smoke = res?.ok ? await runWhisperSmokeTest('whisper-base-q5') : false;
    log(!!res?.ok && smoke, 'a Whisper base letöltése + próbája (az app saját útja)', `${res?.ok} / ${smoke}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  for (const name of ['speech_en.wav', 'speech_hu.wav']) {
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `probe_${name}`);
    const pcm = local ? await decodeToMono16k(local) : null;
    log(null, 'forrás', `${name}: ${pcm ? (pcm.length / 16000).toFixed(2) : '-'} s`);
    if (!pcm) continue;
    const t0 = Date.now();
    const r = await transcribeWordsOnDevice(pcm, 0);
    log(null, 'nyelv (auto)', r?.language ?? '-');
    log(null, 'tokenek', lastRawTokens.map((k) => `[${k.text}]${k.start.toFixed(2)}-${k.end.toFixed(2)}`).join(' '));
    log(!!r && r.words.length > 0, `szavak (${name}, ${Date.now() - t0} ms)`, r ? r.words.map((w) => `${w.text}@${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join(' ') : 'null');
  }
}

/** 🔇 Csendek jóváhagyással: keresés, egyenkénti kihagyás, kivágás (csak ez a sáv / minden sáv), undo, hang. */
async function smokeSilence(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // beszéd-szerű jel; csendek: 1,5–3 (1,5 s) és 4,5–5,2 (0,7 s); a 6,5–6,9 szünet (0,4 s) marad
  const talk: [number, number][] = [[0, 1.5], [3, 4.5], [5.2, 6.5], [6.9, 8]];
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const x = Float32Array.from({ length: 8 * SR }, (_, i) => {
    const t = i / SR;
    return talk.some(([a, b]) => t >= a && t < b) ? 0.3 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) : 0.001 * rnd();
  });
  const src = new File(Paths.document, 'smoke_silence_src.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_silence';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:silence', caught));
  const base = createEmptyProject('smoke csendek', '9:16', undefined, 'audio');
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', uri: src.uri, start: 0, duration: 8, sourceDuration: 8, id: 'x', ...over });
  const music = toneWav('smoke_silence_bed.wav', 8);
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'vo', label: 'beszéd' })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'fx', label: 'hang', uri: music, start: 7, duration: 0.5, sourceDuration: 8, volume: 0.2 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'bed', label: 'zene', uri: music, volume: 0.1 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const track = (type: string) => (st().project?.tracks.find((t) => t.type === type)?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('vo');
  const t0 = Date.now();
  const found = (await runDevAction('audio.silenceFind')) as number | null;
  const rv = useSilenceReview.getState().review;
  const r = rv?.ranges ?? [];
  const fr = r.map((q) => `${q.start.toFixed(3)}–${q.end.toFixed(3)}`).join(', ');
  log(found === 2, 'a keresés 2 csendet talál; a 0,4 s-os szünet marad', `${found} csend: ${fr} (${Date.now() - t0} ms)`);
  const near = (a: number, b: number) => Math.abs(a - b) <= 1 / 30 + 0.011;
  log(r.length === 2 && near(r[0].start, 1.62) && near(r[0].end, 2.88) && near(r[1].start, 4.62) && near(r[1].end, 5.08), 'a határok: a beszéd felől 0,12 s levegő, frame-rácson', fr);
  // 🎧 hosszú forrás útja (szakaszos natív dekóder, 44,1 kHz) ugyanazokat a csendeket adja
  setLongThresholdForTest(1);
  const longR = await findClipSilences(track('voiceover')[0] as AudioClip, 30);
  setLongThresholdForTest(null);
  const lr = (longR ?? []).map((q) => `${q.start.toFixed(3)}–${q.end.toFixed(3)}`).join(', ');
  log(canSegment() && lr === fr, 'hosszú forrás (szakaszos dekódolás): ugyanazok a csendek', lr);
  log(true, 'FOTÓZHATÓ', 'a két csend pirosan a beszéd-sávon, alul a jóváhagyó sáv');
  await sleep(2500);
  runDevAction('audio.silenceToggle1');
  const kept = useSilenceReview.getState().review?.ranges.map((q) => q.on).join(',');
  log(kept === 'true,false', 'koppintás: a 2. csend megmarad (kihagyva a kivágásból)', kept ?? '-');
  const before = st().project!;
  runDevAction('audio.silenceApply');
  const vo = track('voiceover');
  const cut = r[0].end - r[0].start;
  log(vo.length === 2 && near(vo[1].start, r[0].start) && Math.abs(vo[0].duration + vo[1].duration - (8 - cut)) < 1e-5, 'csak ez a sáv: 1 csend kivágva, a beszéd összezár', `${vo.map((c) => `${c.start.toFixed(3)}+${c.duration.toFixed(3)}`).join(' · ')}`);
  log(track('sfx')[0]?.start === 7 && track('music').length === 1, 'a többi sáv érintetlen', `effekt ${track('sfx')[0]?.start} s, zene ${track('music').length} klip`);
  log(useSilenceReview.getState().review === null, 'a kivágás után a jóváhagyás bezárul', '');
  // a hang: a vágás utáni beszéd = az eredeti, a kivágott idővel előbb
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(p, new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    return y;
  };
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const orig = await render(voOnly(before), 'smoke_sil_a.wav');
  const after = await render(voOnly(st().project!), 'smoke_sil_b.wav');
  let d1 = 0;
  let d2 = 0;
  for (let i = Math.round(0.05 * SR); i < Math.round(1.5 * SR); i++) d1 = Math.max(d1, Math.abs(orig[i] - after[i]));
  const shift = Math.round(cut * SR);
  for (let i = Math.round(3.05 * SR); i < Math.round(7.9 * SR); i++) d2 = Math.max(d2, Math.abs(orig[i] - after[i - shift]));
  log(d1 < 1e-5 && d2 < 1e-5 && Math.abs(after.length - (orig.length - shift)) <= 2, 'a hang: a beszéd érintetlen, a vágás után pontosan a kivágott idővel előbb', `eltérés ${d1.toExponential(1)} / ${d2.toExponential(1)}, ${(orig.length / SR).toFixed(3)} → ${(after.length / SR).toFixed(3)} s`);
  st().undo();
  log(track('voiceover').length === 1 && track('voiceover')[0].duration === 8, 'egyetlen visszavonás visszaállítja', `${track('voiceover').length} klip`);
  // minden sáv: az effekt is tolódik, a zene folyamatos
  st().selectClip('vo');
  await runDevAction('audio.silenceFind');
  runDevAction('audio.silenceModeAll');
  runDevAction('audio.silenceApply');
  const removed = r.reduce((s, q) => s + q.end - q.start, 0);
  log(near(track('sfx')[0]?.start ?? -1, 7 - removed) && track('music').length === 1 && track('music')[0].start === 0 && track('voiceover').length === 3, 'minden sáv: az effekt a kivágott idővel előbb, a zene nem vágva', `effekt ${track('sfx')[0]?.start.toFixed(3)} s (7 − ${removed.toFixed(3)}), zene ${track('music').length} klip, beszéd ${track('voiceover').length} darab`);
  st().undo();
  await sleep(1500);
  router.back();
}

/** ✂️🥁 Vágás az ütemrácson: 3/4 @ 120 — darabszám, határok a rácson, egy undo, a hang változatlan. */
async function smokeBeatSplit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  const uri = toneWav('smoke_beatsplit.wav', 8);
  const id = 'prj_smoke_beatsplit';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:beatsplit', caught));
  const base = createEmptyProject('smoke ütem-vágás', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'bs', uri, label: 'dal', start: 0.3, duration: 8, trimIn: 0, sourceDuration: 8, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const meter = { beatsPerBar: 3, beatUnit: 4 as const };
  const project: Project = { ...base, id, bpm: 120, timeSignature: meter, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  const clips = () => (st().project?.tracks.find((t) => t.type === 'music')?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('bs');
  const nBars = runDevAction('audio.beatSplitBars') as number;
  const bars = clips();
  const cuts = bars.slice(1).map((x) => x.start);
  log(nBars === 5 && bars.length === 6, 'ütemenként (3/4 @ 120 = 1,5 s): 5 vágás → 6 darab', `${nBars} vágás, ${bars.length} darab`);
  log(cuts.every((x, i) => Math.abs(x - 1.5 * (i + 1)) < 1e-6), 'a határok az ütemvonalakon', cuts.join(' · '));
  const seamless = bars.every((x, i) => i === 0 || Math.abs(bars[i - 1].start + bars[i - 1].duration - x.start) < 1e-6);
  const trims = bars.every((x) => x.kind === 'audio' && Math.abs((x.trimIn ?? 0) - (x.start - 0.3)) < 1e-6);
  log(seamless && trims && bars[0].id === 'bs', 'hézag nélkül, a forrás-pozíció (trimIn) folytonos, az első darab tartja az azonosítót', `${bars.map((x) => x.duration.toFixed(2)).join('+')} s`);
  const split = { ...project, tracks: st().project!.tracks };
  const render = async (p: Project, name: string) => {
    const { uri: out } = await exportOfflineWav(p, new File(projectExportDir(), name));
    const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
    new File(out).delete();
    return y;
  };
  const whole = await render(project, 'smoke_bs_whole.wav');
  const parts = await render(split, 'smoke_bs_split.wav');
  let diff = 0;
  for (let i = 0; i < Math.min(whole.length, parts.length); i++) diff = Math.max(diff, Math.abs(whole[i] - parts[i]));
  log(whole.length === parts.length && diff < 1e-4, 'a vágás nem hallható: a darabolt export = az egész klip exportja', `max eltérés ${diff.toExponential(1)}, ${parts.length} minta`);
  st().undo();
  log(clips().length === 1 && clips()[0].duration === 8, 'egyetlen visszavonás visszaállítja az egész klipet', `${clips().length} klip`);
  st().selectClip('bs');
  const nBeats = runDevAction('audio.beatSplitBeats') as number;
  const expect = beatSplitTimes(c, 120, meter, 'beat').length;
  log(nBeats === 16 && nBeats === expect && clips().length === 17, 'ütemrészenként (0,5 s): 0,5 … 8,0 → 16 vágás, 17 darab', `${nBeats} vágás, ${clips().length} darab`);
  st().undo();
  st().selectClip('bs');
  runDevAction('audio.beatSplitBars');
  runDevAction('audio.fit');
  log(true, 'FOTÓZHATÓ', '6 darab a 3/4-es ütemvonalakon');
  await sleep(4000);
  router.back();
}

/** 🔁 Loop-klip: 1 s-os minta 4 s-ig ismétlődik (export + motor), a jobb él a forráson túl húzható. */
async function smokeLoopClip(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const SR = 44100;
  // 1 s: 0,15 s hang, utána csend — a hurok minden másodpercben megszólal
  const x = Float32Array.from({ length: SR }, (_, i) => (i < 0.15 * SR ? 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR) : 0));
  const src = new File(Paths.document, 'smoke_loop_src.wav');
  if (src.exists) src.delete();
  src.create();
  src.write(encodeWav16([x, x], SR, () => 0.5));
  const id = 'prj_smoke_loop';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:loop', caught));
  const base = createEmptyProject('smoke loop-klip', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'lp', uri: src.uri, label: 'ütem', start: 0, duration: 1, trimIn: 0, sourceDuration: 1, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported', loopLength: 1 };
  const ext = trimAudioRight(c, 4);
  log(Math.abs(ext.duration - 4) < 1e-9, 'loop-klipnél a jobb él a forrás végén túl húzható', `${ext.duration} s (a forrás 1 s)`);
  const looped: AudioClip = { ...c, duration: ext.duration };
  const project: Project = { ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [looped] } : t)) };
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_loop_out.wav'));
  const y = (await (await loadAudioApi())!.decodeAudioData(out, SR)).getChannelData(0);
  new File(out).delete();
  const lvl = (t: number) => {
    let e = 0;
    for (let i = Math.round(t * SR); i < Math.round((t + 0.1) * SR); i++) e += y[i] * y[i];
    return 10 * Math.log10(e / (0.1 * SR) + 1e-30);
  };
  const hits = [0.02, 1.02, 2.02, 3.02].map(lvl);
  const gaps = [0.5, 1.5, 2.5, 3.5].map(lvl);
  log(hits.every((h) => Math.abs(h - hits[0]) < 0.5) && gaps.every((g) => g < -80), 'export: a minta minden másodpercben megszólal, köztük csend', `${hits.map((h) => h.toFixed(1)).join(' / ')} dB, szünetek ${Math.max(...gaps).toFixed(0)} dB`);
  // ✂️ a kettévágott loop-klip (1,5 s-nál, a hurok közepén) ugyanúgy szól, mint az egész
  const [la, lb] = splitClip(looped, 1.5) as [AudioClip, AudioClip];
  const { uri: out2 } = await exportOfflineWav({ ...project, tracks: project.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [la, lb] } : t)) }, new File(projectExportDir(), 'smoke_loop_split.wav'));
  const y2 = (await (await loadAudioApi())!.decodeAudioData(out2, SR)).getChannelData(0);
  new File(out2).delete();
  let ld = 0;
  for (let i = 0; i < Math.min(y.length, y2.length); i++) ld = Math.max(ld, Math.abs(y[i] - y2[i]));
  log(lb.loopOffset === 0.5 && lb.trimIn === 0 && ld < 1e-4, 'a kettévágott loop-klip = az egész (a 2. darab a hurok közepéről)', `fázis ${lb.loopOffset} s, max eltérés ${ld.toExponential(1)}`);
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().setPlayhead(0);
  previewEngine.takeStats();
  st().setPlaying(true);
  await sleep(3000);
  st().setPlaying(false);
  const stats = previewEngine.takeStats();
  log(stats.chunks > 10 && stats.late === 0, 'a motor a loop-klipet akadás nélkül játssza', `${stats.chunks} szelet, ${stats.late} késett`);
  log(true, 'FOTÓZHATÓ', 'a loop-klip hullámformája négyszer ismétlődik');
  await sleep(4000);
  router.back();
  src.delete();
}

/** A26: a telefonos WAV-export a valódi natív dekóderrel — és a szerveres renderrel kivonva. */
async function smokeOfflineExport(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_offline_src.wav', 3);
  const base = createEmptyProject('smoke offline', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'o1', uri, label: 'tone', start: 0.5, duration: 2, trimIn: 0.5, sourceDuration: 3, volume: 0.6, fadeIn: 0.3, fadeOut: 0.4, pan: -0.5, source: 'imported',
    keyframes: { volume: [{ time: 0, value: 0.2, easing: 'linear' }, { time: 2, value: 0.9, easing: 'linear' }] } as AudioClip['keyframes'] };
  const project: Project = { ...base, trackMix: { music: { gain: 0.8 } }, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [c] } : tr)) };
  const started = Date.now();
  const target = new File(projectExportDir(), 'smoke_offline.wav');
  const { uri: out } = await exportOfflineWav(project, target);
  const ms = Date.now() - started;
  const size = new File(out).size ?? 0;
  log(Math.abs(size - (44 + 2.5 * 44100 * 4)) < 8, 'A26 a WAV a telefonon készült, a várt hosszal', `${size} bájt, ${ms} ms`);
  if (!cloudInThisBuild()) {
    log(!cloudAvailable(), 'felhő nélküli build: a Pro felhasználó is a telefonos WAV-ot kapja (az export-lap telefonos módban)', `felhő: ${cloudAvailable()}`);
    log(null, 'A26 telefon = szerver: kimarad', 'ebben a buildben nincs felhő-cím (a telefonos út a fenti)');
    return;
  }
  const serverFile = new File(projectExportDir(), 'smoke_server.wav');
  await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 44100, channels: 2 }), serverFile);
  const api = await loadAudioApi();
  if (!api) {
    log(false, 'dekóder', 'nincs');
    return;
  }
  const mine = await api.decodeAudioData(out, 44100);
  const theirs = await api.decodeAudioData(serverFile.uri, 44100);
  const db = (xs: Float32Array) => 10 * Math.log10(xs.reduce((s, v) => s + v * v, 0) / Math.max(1, xs.length) + 1e-30);
  for (const ch of [0, 1]) {
    const a = mine.getChannelData(ch);
    const b = theirs.getChannelData(ch);
    const n = Math.min(a.length, b.length);
    const diff = Float32Array.from({ length: n }, (_, i) => a[i] - b[i]);
    const snr = db(b.subarray(0, n)) - db(diff);
    log(snr > 60, `A26 telefon = szerver (${ch === 0 ? 'bal' : 'jobb'} csatorna)`, `${snr.toFixed(1)} dB a jel alatt, hossz ${a.length}/${b.length}`);
  }
  new File(out).delete();
  serverFile.delete();
  new File(uri).delete();
}

/** A26 sebesség: 60 mp-es, három klipes projekt a telefonon (a 20 perces felső határhoz). */
async function smokeOfflineSpeed(log: Log) {
  const uri = toneWav('smoke_offline_long.wav', 60);
  const base = createEmptyProject('smoke offline hosszú', '1:1', undefined, 'audio');
  const mk = (id: string, start: number): AudioClip => ({ kind: 'audio', id, uri, label: id, start, duration: 40, trimIn: 0, sourceDuration: 60, volume: 0.5, fadeIn: 1, fadeOut: 1, source: 'imported' });
  const project: Project = { ...base, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('a', 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('b', 10)] } : tr.type === 'voiceover' ? { ...tr, clips: [mk('c', 20)] } : tr)) };
  // a mérés kétszer: az első futás a hang-modul első betöltését is tartalmazza (hidegindítás)
  for (const run of ['első (hideg)', 'második (meleg)']) {
  // T2: a felület folyékonysága export közben — a leghosszabb szünet két képkocka között
  let frameGap = 0;
  let lastFrame = Date.now();
  let watching = true;
  let gapPhase = '';
  let currentPhase = 'indul';
  const tick = () => {
    const now = Date.now();
    if (now - lastFrame > frameGap) {
      frameGap = now - lastFrame;
      gapPhase = currentPhase;
    }
    lastFrame = now;
    if (watching) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const phases: string[] = [];
  let last = Date.now();
  const started = last;
  const { uri: out } = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_long.wav'), (u) => {
    currentPhase = `${u.phase} ${Math.round((u.ratio ?? 0) * 100)}%`;
    if (phases[phases.length - 1]?.split(':')[0] !== u.phase) {
      phases.push(`${u.phase}: +${Date.now() - last} ms`);
      last = Date.now();
    }
  });
  const ms = Date.now() - started;
  watching = false;
  // a hideg futás a hang-modul első betöltését is méri (a Hang Stúdióban ez a megnyitáskor megtörténik — `exportgap`)
  log(run.startsWith('első') ? null : frameGap <= 50, `T2 a felület export közben is folyékony (leghosszabb képkocka-szünet) — ${run}`, `${frameGap} ms — ${gapPhase} után`);
  log(ms < 30000, 'A26 egy perc keverés a telefonon', `${ms} ms (${(ms / 60).toFixed(0)} ms / mp hang) · ${phases.join(' · ')}`);
  new File(out).delete();
  }
  new File(uri).delete();
}

/** PRO-AUDIO 17/5: többsávos lejátszás szinkronja a valódi stúdióban (két sáv, egyik később kezd). */
async function smokeAudioSync(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_audiosync';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioSync', caught));
  const uri = toneWav('smoke_sync.wav', 12);
  const base = createEmptyProject('smoke szinkron', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number, trimIn: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 8, trimIn, sourceDuration: 12, volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('elejetol', 0, 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('kesobb', 2, 1)] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  // 1. kör: a tanulás (az indítási késést itt méri meg); 2. kör: a mért szinkron
  useEditorStore.getState().setPlayhead(0);
  useEditorStore.getState().setPlaying(true);
  await sleep(3000);
  useEditorStore.getState().setPlaying(false);
  await sleep(600);
  useEditorStore.getState().setPlayhead(0);
  await sleep(600);
  startSyncProbe();
  useEditorStore.getState().setPlaying(true);
  await sleep(9000);
  useEditorStore.getState().setPlaying(false);
  const { samples, starts, seeks } = stopSyncProbe();
  for (const [cid, st] of summarizeDrift(samples)) {
    log(null, `drift ${cid} (teljes)`, `átlag ${st.meanMs.toFixed(0)} ms, max ${st.maxMs.toFixed(0)} ms (${st.n} minta)`);
  }
  // a beállás után (a klip első 3 mp-e utáni szakasz) — ez a hallható, tartós szinkron
  for (const [cid, st] of summarizeDrift(samples.filter((x) => x.sinceStart > 3))) {
    log(st.maxMs <= 45, `szinkron beállás után: ${cid}`, `átlag ${st.meanMs.toFixed(0)} ms, max ${st.maxMs.toFixed(0)} ms`);
  }
  for (const [cid, late] of starts) {
    log(null, `megszólalás ${cid}`, `${(late * 1000).toFixed(0)} ms késéssel`);
  }
  log(null, 'korrekciós ugrások', String(seeks));
  for (const cid of ['elejetol', 'kesobb']) {
    const trace = samples.filter((x) => x.clipId === cid && x.sinceStart > 3);
    let worst = 0;
    trace.forEach((x, k) => {
      if (Math.abs(x.drift) > Math.abs(trace[worst]?.drift ?? 0)) worst = k;
    });
    const around = trace.slice(Math.max(0, worst - 6), worst + 10).map((x) => `${x.sinceStart.toFixed(2)}:${(x.drift * 1000).toFixed(0)}`).join(' ');
    log(null, `kiugrás ${cid}`, around);
  }
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(uri).delete();
}

/** PRO-AUDIO 17/8: élő szintmérő a valódi stúdióban (képernyőkép lejátszás közben). */
async function smokeAudioMeter(log: Log) {
  const id = 'prj_smoke_audiometer';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioMeter', caught));
  const half = toneWav('smoke_meter_half.wav', 6);
  const loud = stereoRightWav('smoke_meter_loud.wav', 6, 0.99, 0);
  const base = createEmptyProject('smoke szintmérő', '9:16', undefined, 'audio');
  const mk = (cid: string, uri: string): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('fel', half)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('hangos1', loud), mk('hangos2', loud)] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  useEditorStore.getState().setPlayhead(0);
  useEditorStore.getState().setPlaying(true);
  await sleep(2000);
  const p = useEditorStore.getState().project!;
  const plan = offlineMixPlan(p);
  const waves = new Map<string, WaveformData>();
  for (const u of [half, loud]) {
    const w = await getWaveform(u, { userInitiated: true });
    if (w) waves.set(u, w);
  }
  const t = useEditorStore.getState().playhead;
  const music = trackLevelAt(plan.clips.filter((c) => c.track === 'music'), (u) => waves.get(u), t);
  const sfx = trackLevelAt(plan.clips.filter((c) => c.track === 'sfx'), (u) => waves.get(u), t);
  log(Math.abs(levelDb(music) + 6.2) < 1, 'zene-sáv szintje', `${levelDb(music).toFixed(1)} dB`);
  log(sfx >= CLIP_LEVEL, 'effekt-sáv túlvezérelt', `${levelDb(sfx).toFixed(1)} dB`);
  log(true, 'FOTÓZHATÓ', 'a szintmérők lejátszás közben');
  await sleep(2500);
  useEditorStore.getState().setPlaying(false);
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(half).delete();
  new File(loud).delete();
}

/** PRO-AUDIO 17/2: „illeszd” nagyítás és lejátszófej-követés a valódi stúdióban. */
async function smokeAudioFit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_audiofit';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioFit', caught));
  const uri = toneWav('smoke_fit.wav', 60);
  const base = createEmptyProject('smoke illeszd', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'h', uri, label: 'hosszú', start: 0, duration: 60, trimIn: 0, sourceDuration: 60, volume: 0.2, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [c] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const view = () => runDevAction('audio.view') as { scrollX: number; pps: number; viewW: number; contentW: number };

  // követés: nagy nagyítás (220 px/mp), 7 mp lejátszás — a lejátszófejnek a nézetben kell maradnia
  for (let i = 0; i < 4; i++) {
    runDevAction('audio.zoomIn');
    await sleep(300);
  }
  useEditorStore.getState().setPlayhead(0);
  useEditorStore.getState().setPlaying(true);
  await sleep(9000);
  useEditorStore.getState().setPlaying(false);
  await sleep(300);
  const v1 = view();
  const x = useEditorStore.getState().playhead * v1.pps;
  log(x > v1.viewW && v1.scrollX > 0 && x >= v1.scrollX && x <= v1.scrollX + v1.viewW, 'a lejátszófej az első képernyőn túl is a nézetben marad (lapozott)', `lejátszófej ${x.toFixed(0)} px, nézet ${v1.scrollX.toFixed(0)}–${(v1.scrollX + v1.viewW).toFixed(0)} px (${v1.pps} px/mp)`);

  // illeszd: a teljes 60 mp kifér a nézetbe
  runDevAction('audio.fit');
  await sleep(600);
  const v2 = view();
  log(60 * v2.pps <= v2.viewW && v2.scrollX === 0, '„Illeszd”: a teljes projekt látszik', `${(60 * v2.pps).toFixed(0)} px a ${v2.viewW.toFixed(0)} px-es nézetben`);
  log(true, 'FOTÓZHATÓ', 'az illesztett idővonal');
  await sleep(4000);
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(uri).delete();
}

/** PRO-AUDIO 17/20: csak hang export egy videó-projektből — a videóklip hangja, a master rá is hat. */
async function smokeVideoAudioExport(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const base = createEmptyProject('smoke videó-hang', '16:9');
  const clip = { id: 'v', kind: 'video', uri, start: 0, duration: 10, trimIn: 0, sourceDuration: 10, speed: 1, volume: 1, filterId: 'none' } as VideoClip;
  const project: Project = { ...base, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [clip] } : tr)) };
  log(mixForExport(project, (t) => t !== 'video', 1) === null, 'a némított videósávból nincs hang-export');
  const api = await loadAudioApi();
  const measure = async (master: number, name: string) => {
    const mix = mixForExport(project, () => true, master)!;
    const target = new File(projectExportDir(), name);
    const out = await exportAudioToFile(mix, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 16, sampleRate: 44100, channels: 2 }), target);
    const buf = await api!.decodeAudioData(out, 44100);
    const ch = buf.getChannelData(0);
    const rms = Math.sqrt(ch.reduce((acc, v) => acc + v * v, 0) / ch.length);
    new File(out).delete();
    return { db: 20 * Math.log10(rms + 1e-12), dur: buf.duration };
  };
  const full = await measure(1, 'smoke_videohang_1.wav');
  log(Math.abs(full.dur - 10) < 0.1 && full.db > -40, 'a videóklip hangja exportálódik', `${full.dur.toFixed(2)} s, ${full.db.toFixed(1)} dB`);
  const half = await measure(0.5, 'smoke_videohang_05.wav');
  log(Math.abs(full.db - half.db - 6.02) < 0.5, 'a master a videóklip hangjára is hat', `${(full.db - half.db).toFixed(2)} dB esés`);
  {
    const probe = await api!.decodeAudioData(uri, 44100);
    log(null, 'mp4 dekódolás 44,1 kHz-re kérve', `sampleRate ${probe.sampleRate}, ${probe.length} minta, ${probe.duration.toFixed(3)} s → ${(probe.length / probe.duration).toFixed(0)} minta/s`);
  }
  // Free út: a telefon dekódolja az mp4 hangját és kever — a szerveres renderrel kivonva
  const onPhone = await exportOfflineWav(project, new File(projectExportDir(), 'smoke_videohang_tel.wav'));
  const srv = await exportAudioToFile(project, audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 16, sampleRate: 44100, channels: 2 }), new File(projectExportDir(), 'smoke_videohang_srv.wav'));
  const a1 = await api!.decodeAudioData(onPhone.uri, 44100);
  const b1 = await api!.decodeAudioData(srv, 44100);
  const lvl = (xs: Float32Array) => 10 * Math.log10(xs.reduce((acc, x) => acc + x * x, 0) / Math.max(1, xs.length) + 1e-30);
  {
    // eltolás keresése: a telefonos és a szerveres jel keresztkorrelációja ±4096 mintán
    const x = a1.getChannelData(0);
    const y = b1.getChannelData(0);
    let best = -Infinity;
    let lag = 0;
    for (let d = -4096; d <= 4096; d += 1) {
      let acc = 0;
      for (let i = 44100; i < 88200; i += 3) acc += y[i] * (x[i + d] ?? 0);
      if (acc > best) {
        best = acc;
        lag = d;
      }
    }
    // a szerver régen 1-es sebességen is atempo-t tett a videó hangjára (287 minta késés)
    log(Math.abs(lag) <= 2, 'Free: a telefonos és a szerveres videó-hang nincs eltolva', `${lag} minta`);
    for (const ch of [0, 1]) {
      const xc = a1.getChannelData(ch);
      const yc = b1.getChannelData(ch);
      const n = Math.min(xc.length - Math.max(0, lag), yc.length) - 4410;
      const diff = Float32Array.from({ length: n }, (_, i) => xc[i + Math.max(0, lag)] - yc[i]);
      const snr = lvl(yc.subarray(0, n)) - lvl(diff);
      log(snr > 50 && Math.abs(xc.length - yc.length) < 64, `Free: telefon = szerver a videó hangján (${ch === 0 ? 'bal' : 'jobb'})`, `${snr.toFixed(1)} dB, hossz ${xc.length}/${yc.length}`);
    }
  }
  new File(onPhone.uri).delete();
  new File(srv).delete();
  useEditorStore.getState().loadProject(project, []);
  setHarness(
    <View style={{ width: Math.min(420, Dimensions.get('window').width), alignSelf: 'center' }}>
      <AudioOnlyExportSection />
    </View>
  );
  log(true, 'FOTÓZHATÓ', 'a „Csak hang” szakasz az export-panelen');
  await sleep(4000);
  setHarness(null);
}

/** PRO-AUDIO 17/1: a címke a fájl VÉGÉN (WAV LIST/INFO a data után) — a telefonos fájlolvasással. */
async function smokeAudioTags(log: Log) {
  const uri = toneWav('smoke_tags.wav', 1);
  const enc = (str: string) => Array.from(unescape(encodeURIComponent(str)), (ch) => ch.charCodeAt(0));
  const sub = (id: string, text: string) => {
    const v = [...enc(text), 0];
    if (v.length % 2) v.push(0);
    const n = v.length;
    return [...enc(id), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...v];
  };
  const info = [...enc('INFO'), ...sub('INAM', 'Őszi éjszaka'), ...sub('IART', 'Kovács Béla')];
  const list = [...enc('LIST'), info.length & 255, (info.length >> 8) & 255, 0, 0, ...info];
  const file = new File(uri);
  const old = file.bytesSync();
  const out = new Uint8Array(old.length + list.length);
  out.set(old, 0);
  out.set(list, old.length);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  file.write(out);
  const tags = readFileTags(uri);
  log(tags.title === 'Őszi éjszaka' && tags.artist === 'Kovács Béla', 'a fájl végén lévő címke a telefonon kiolvasva', JSON.stringify(tags));
  log(tagLabel(tags, 'smoke_tags.wav') === 'Kovács Béla – Őszi éjszaka', 'a klip neve a címkéből', tagLabel(tags, 'smoke_tags.wav'));
  file.delete();
}

/** Stabilitás: szélsőséges esetek a hang-oldalon — semmi ne essen szét, minden hiba érthető legyen. */
async function smokeAudioEdge(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  // 1) üres projekt
  const empty = createEmptyProject('smoke üres', '1:1', undefined, 'audio');
  const plan = offlineMixPlan(empty);
  log(mixForExport(empty, () => true, 1) === null && plan.clips.length === 0 && trackLevelAt(plan.clips, () => undefined, 0) === 0, 'üres projekt: nincs export, nincs hiba');
  // 2) hiányzó fájl a telefonos exportban: érthető hiba
  const missing: AudioClip = { kind: 'audio', id: 'm', uri: `${Paths.document.uri}nincs_ilyen.wav`, label: 'hiányzik', start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const withMissing: Project = { ...empty, tracks: empty.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [missing] } : tr)) };
  const err = await exportOfflineWav(withMissing, new File(projectExportDir(), 'smoke_missing.wav')).then(() => 'nincs hiba', (e: Error) => e.message);
  log(err.includes('nincs_ilyen.wav'), 'hiányzó fájl: érthető hibaüzenet, a fájl nevével', err);
  log(!new File(projectExportDir(), 'smoke_missing.wav').exists, 'hiányzó fájl: nem marad félkész export');
  // 3) túl hosszú projekt: a felső határ érthető
  const long: Project = { ...withMissing, tracks: withMissing.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [{ ...missing, duration: 21 * 60, sourceDuration: 21 * 60 }] } : tr)) };
  const errLong = await exportOfflineWav(long, new File(projectExportDir(), 'smoke_long.wav')).then(() => 'nincs hiba', (e: Error) => e.message);
  log(errLong.includes('nincs_ilyen.wav'), 'hiányzó HOSSZÚ (szakaszos) forrás: érthető hiba a fájl nevével, nem néma export', errLong);
  const tooLong: Project = { ...long, tracks: long.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [{ ...missing, duration: 3 * 3600 + 60, sourceDuration: 3 * 3600 + 60 }] } : tr)) };
  const errTooLong = await exportOfflineWav(tooLong, new File(projectExportDir(), 'smoke_toolong.wav')).then(() => 'nincs hiba', (e: Error) => e.message);
  log(/180/.test(errTooLong), 'túl hosszú projekt (3 óra fölött): érthető üzenet a határral', errTooLong);
  // 4) gyors nyitás-zárás a stúdióban
  const id = 'prj_smoke_audioedge';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioEdge', caught));
  const uri = toneWav('smoke_edge.wav', 4);
  const clip: AudioClip = { ...missing, id: 'e', uri, label: 'él', duration: 4, sourceDuration: 4, volume: 0.3 };
  await saveProject({ ...empty, id, tracks: empty.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr)) });
  for (let k = 0; k < 5; k++) {
    router.push(`/studio/audio/${id}` as Href);
    await sleep(700);
    useEditorStore.getState().setPlaying(true);
    await sleep(300);
    router.back();
    await sleep(500);
  }
  log(useEditorStore.getState().project?.id !== id && !useEditorStore.getState().isPlaying, 'ötszöri gyors nyitás-zárás után a stúdió rendben bezárult');
  // 5) szerkesztés- és visszavonás-vihar
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(800);
  const st = useEditorStore.getState();
  const clipsNow = () => JSON.stringify(useEditorStore.getState().project?.tracks.find((tr) => tr.type === 'music')?.clips);
  void st;
  // a) a napló korlátján (50) belül: 20 szerkesztés (40 művelet) teljesen visszavonható
  const before = clipsNow();
  for (let i = 0; i < 20; i++) {
    useEditorStore.getState().updateClip('e', { volume: (i % 10) / 10 + 0.05 });
    useEditorStore.getState().moveClip('e', 'music', (i % 5) * 0.5);
  }
  for (let i = 0; i < 100 && useEditorStore.getState().past.length > 0; i++) {
    useEditorStore.getState().undo();
  }
  log(clipsNow() === before, '20 gyors szerkesztés után a visszavonás az eredeti állapotot adja');
  for (let i = 0; i < 100 && useEditorStore.getState().future.length > 0; i++) {
    useEditorStore.getState().redo();
  }
  const redone = clipsNow();
  log(redone !== before && JSON.parse(redone ?? '[]')[0]?.start === 2, 'az újra-lépések a végállapotot adják', `start ${JSON.parse(redone ?? '[]')[0]?.start}`);
  // b) 100 művelet: a napló a korlátnál (50) megáll, nem nő tovább
  for (let i = 0; i < 50; i++) {
    useEditorStore.getState().updateClip('e', { volume: (i % 10) / 10 + 0.05 });
    useEditorStore.getState().moveClip('e', 'music', (i % 5) * 0.5);
  }
  log(useEditorStore.getState().past.length <= 50, 'a visszavonási napló a korlátnál (50) megáll', `${useEditorStore.getState().past.length} lépés`);
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(uri).delete();
}

/** T1: a videó-szerkesztő képe a lejátszófejhez képest (a zene, a felirat és a vágások ehhez igazodnak). */
async function smokeVideoSync(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const asset = Asset.fromModule(require('../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = 'prj_smoke_videosync';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:videoSync', caught));
  const base = createEmptyProject('smoke kép-szinkron', '16:9');
  const v = (cid: string, start: number, trimIn: number) => ({ id: cid, kind: 'video', uri, start, duration: 4, trimIn, sourceDuration: 10, speed: 1, volume: 0.2, filterId: 'none' }) as VideoClip;
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [v('elso', 0, 0), v('masodik', 4, 5)] } : tr)) });
  router.push(`/editor/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(2500);
  useEditorStore.getState().setPlayhead(0);
  await sleep(600);
  startSyncProbe();
  useEditorStore.getState().setPlaying(true);
  await sleep(7500);
  useEditorStore.getState().setPlaying(false);
  const { samples } = stopSyncProbe();
  // a klip-idő (sinceStart) mindkét klipnél a saját elejétől számol; a korrekció ~2,5 mp alatt áll be
  const steady = summarizeDrift(samples.filter((x) => x.sinceStart > 2.5)).get('kép');
  log(steady ? steady.maxMs <= 60 : false, 'kép-szinkron beállás után a kép-tűrésen (60 ms) belül (mindkét klip)', steady ? `átlag ${steady.meanMs.toFixed(0)} ms, max ${steady.maxMs.toFixed(0)} ms (${steady.n} minta)` : 'nincs minta');
  const start = summarizeDrift(samples.filter((x) => x.sinceStart <= 2.5)).get('kép');
  log(null, 'átmenetek (indulás, klipváltás: első 2,5 mp)', start ? `átlag ${start.meanMs.toFixed(0)} ms, max ${start.maxMs.toFixed(0)} ms` : 'nincs minta');
  const trace = samples.filter((x) => x.clipId === 'kép');
  log(null, 'nyom kép', trace.filter((_, k) => k % Math.max(1, Math.floor(trace.length / 16)) === 0).map((x) => `${x.sinceStart.toFixed(1)}→${(x.drift * 1000).toFixed(0)}`).join(' '));
  router.back();
  await sleep(800);
  await deleteProject(id);
}

type RecordHandle = { recorder: AudioRecorder; finish: { current: () => Promise<void> } };

/** a valódi `useAudioRecorder` + a közös felvétel-út, ahogy a Hang panel és a stúdió használja */
function RecordHarness({ onReady, start, onLowSpace }: { onReady: (h: RecordHandle) => void; start: () => number; onLowSpace?: () => void }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const finish = useRef<() => Promise<void>>(async () => {});
  useFinishRecordingOnLeave(recorder, finish, onLowSpace);
  finish.current = async () => {
    const { uri, seconds } = await stopVoiceRecording(recorder);
    if (uri) {
      const { clip, asset } = voiceoverClip(uri, seconds, start(), 30, 'smoke felvétel', makeId);
      useEditorStore.getState().addClip('voiceover', clip, asset);
    }
  };
  useEffect(() => {
    onReady({ recorder, finish });
  }, [onReady, recorder]);
  return null;
}

/**
 * 💾 PRO-AUDIO 17/18 tárhelyhiány. A szabad hely a valódi `Paths.availableDiskSpace`; a betelt
 * lemezt a `setFreeDiskOverride` adja ugyanazon a kódúton (a lemez tényleges teleírása nélkül).
 */
async function smokeDiskSpace(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const MB = 1024 * 1024;
  const real = freeDiskBytes();
  log(real > 0, 'a valódi szabad hely lekérdezhető', `${(real / MB / 1024).toFixed(1)} GB`);
  const uri = toneWav('smoke_disk_src.wav', 3);
  const base = createEmptyProject('smoke tárhely', '1:1', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'd1', uri, label: 'tone', start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const project: Project = { ...base, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [c] } : tr)) };
  const need = wavBytes(3 * 44100, 2);
  try {
    // A: export — nem fér el → azonnal, érthető üzenettel áll le, fájl nélkül
    const target = new File(projectExportDir(), 'smoke_disk.wav');
    if (target.exists) target.delete();
    setFreeDiskOverride(need + EXPORT_SPACE_MARGIN - 1);
    const t0 = Date.now();
    const err = await exportOfflineWav(project, target).then(() => 'nincs hiba', (e: Error) => e.message);
    const ms = Date.now() - t0;
    log(err.includes('MB') && /hely|space|Speicher/i.test(err), 'export: kevés helynél érthető üzenet', err.slice(0, 90));
    log(ms < 300, 'export: a dekódolás el sem indul', `${ms} ms`);
    log(!target.exists, 'export: nem marad félkész fájl');
    // B: épp elfér → elkészül
    setFreeDiskOverride(need + EXPORT_SPACE_MARGIN);
    const ok = await exportOfflineWav(project, target).then((r) => new File(r.uri).size ?? 0, (e: Error) => { log(false, 'export: épp elfér', e.message); return 0; });
    log(Math.abs(ok - need) < 8, 'export: ha épp elfér, elkészül', `${ok} bájt`);
    if (target.exists) target.delete();

    // C: felvétel — kevés helynél nem indul
    const perm = await getRecordingPermissionsAsync();
    if (!perm.granted) {
      log(false, 'mikrofon-engedély', perm.status);
      return;
    }
    useEditorStore.getState().loadProject(createEmptyProject('smoke tárhely felvétel', '9:16'), []);
    const voiceClips = () => (useEditorStore.getState().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
    let lowSpace = 0;
    const h = await new Promise<RecordHandle>((resolve) => setHarness(<RecordHarness onReady={resolve} start={() => 0} onLowSpace={() => { lowSpace += 1; }} />));
    setFreeDiskOverride(50 * MB);
    const startErr = await startVoiceRecording(h.recorder).then(() => 'elindult', (e: Error) => e.message);
    log(startErr.includes('MB') && h.recorder.getStatus().isRecording === false, 'felvétel: kevés helynél nem indul, érthető üzenettel', startErr.slice(0, 90));
    // D: felvétel közben fogy a hely → a take magától lezárul, a felvett rész megmarad
    setFreeDiskOverride(null);
    await startVoiceRecording(h.recorder);
    await sleep(2000);
    setFreeDiskOverride(RECORD_STOP_FREE - 1);
    const t1 = Date.now();
    for (let i = 0; i < 40 && voiceClips().length === 0; i++) {
      await sleep(100);
    }
    const clip = voiceClips()[0];
    const dur = clip ? await probeAudioDuration(clip.uri) : 0;
    log(!!clip && h.recorder.getStatus().isRecording === false, 'felvétel: fogyó helynél magától lezárul', `${Date.now() - t1} ms alatt`);
    log(!!clip && dur > 1.8 && Math.abs(dur - clip.duration) < 0.3, 'felvétel: a felvett rész ép klip', clip ? `${clip.duration.toFixed(2)} s klip, ${dur.toFixed(2)} s fájl` : 'nincs klip');
    log(lowSpace === 1, 'felvétel: a felhasználó egyszer kap üzenetet', `${lowSpace}×`);
    for (const v of voiceClips()) new File(v.uri).delete();
  } finally {
    setFreeDiskOverride(null);
    setHarness(null);
    new File(uri).delete();
  }
}

/**
 * 📞 PRO-AUDIO 17/18 megszakítás. A hívás / Siri hatását ugyanazzal a natív hívással
 * idézzük elő, amit az iOS megszakításkor tesz (felvevő `pause()`, lejátszók `pause()`, a hívás
 * végén `play()`); a háttér-ágat (`bg`) a gazda-szkript valódi app-váltással (Beállítások) adja.
 */
async function smokeInterrupt(log: Log, setHarness: (n: ReactNode) => void, background: boolean) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status})`);
    return;
  }
  const id = 'prj_smoke_interrupt';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:interrupt', caught));
  const uri = toneWav('smoke_interrupt.wav', 20);
  const base = createEmptyProject('smoke megszakítás', '9:16', undefined, 'audio');
  const mk = (cid: string, start: number): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start, duration: 16, trimIn: 0, sourceDuration: 20, volume: 0.3, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('zene', 0)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('effekt', 0)] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  const st = () => useEditorStore.getState();
  const voiceClips = () => (st().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const mount = () => new Promise<RecordHandle>((resolve) => setHarness(<RecordHarness onReady={resolve} start={() => st().playhead} />));
  const cleanup = () => {
    st().setPlaying(false);
    setHarness(null);
    for (const c of voiceClips()) {
      new File(c.uri).delete();
    }
  };

  if (background) {
    const h = await mount();
    await startVoiceRecording(h.recorder);
    st().setPlayhead(0);
    st().setPlaying(true);
    await sleep(2000);
    let left = -1;
    let back = false;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && left < 0) left = st().playhead;
      if (state === 'active' && left >= 0) back = true;
    });
    log(null, 'HÁTTÉR-KÉSZ', 'most vált a gazda-szkript másik appra');
    for (let i = 0; i < 150 && !back; i++) {
      await sleep(200);
    }
    sub.remove();
    await sleep(1500);
    log(back, 'az app háttérbe ment és visszajött', back ? `a lejátszófej távozáskor ${left.toFixed(2)} s` : 'nem történt app-váltás');
    log(!st().isPlaying, 'a lejátszás megállt a háttérbe lépéskor');
    log(Math.abs(st().playhead - left) < 0.3, 'a lejátszófej nem ugrott előre a kiesett idővel', `${left.toFixed(2)} → ${st().playhead.toFixed(2)} s`);
    const c = voiceClips()[0];
    const dur = c ? await probeAudioDuration(c.uri) : 0;
    log(!!c && dur > 1.5, 'a háttérbe lépéskor futó felvétel klip lett, a fájl ép', c ? `${c.duration.toFixed(2)} s klip, ${dur.toFixed(2)} s fájl` : 'nincs klip');
    log(recordingPhase(h.recorder.getStatus()) === 'idle' && voiceClips().length === 1, 'a felvevő lezárult, egyetlen klip', `${voiceClips().length} klip`);
    await sleep(1500);
    log(!st().isPlaying && ['zene', 'effekt'].every((cid) => runDevAction(`audio.nativePlaying.${cid}`) !== true), 'visszatérés után sem szól magától a hang');
    cleanup();
    return;
  }

  // A: felvétel — megszakítás nélkül nem zárul le idő előtt; a rendszer-szünet klip lesz
  let h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(2000);
  log(voiceClips().length === 0 && recordingPhase(h.recorder.getStatus()) === 'recording', 'zavartalan felvétel nem zárul le magától', `${voiceClips().length} klip`);
  h.recorder.pause();
  for (let i = 0; i < 20 && voiceClips().length === 0; i++) {
    await sleep(100);
  }
  const a = voiceClips()[0];
  const aDur = a ? await probeAudioDuration(a.uri) : 0;
  log(!!a && Math.abs(a.duration - 2) < 0.4, 'a megszakított felvétel klip lett, a felvett hosszal', a ? `${a.duration.toFixed(2)} s klip` : 'nincs klip');
  log(!!a && Math.abs(aDur - a.duration) < 0.3, 'a megszakított felvétel fájlja ép', `${aDur.toFixed(2)} s fájl`);
  log(recordingPhase(h.recorder.getStatus()) === 'idle', 'a felvevő lezárult (új felvétel nem írja felül)');
  // a lezárás után ugyanazzal a felvevővel új take indulhat
  await startVoiceRecording(h.recorder);
  await sleep(1000);
  await h.finish.current();
  log(voiceClips().length === 2 && voiceClips()[0].uri !== voiceClips()[1].uri, 'utána új felvétel külön fájlba megy', `${voiceClips().length} klip`);
  setHarness(null);

  // B: lejátszás — zavartalanul nem áll meg; a rendszer-némításra a transzport is megáll
  st().setPlayhead(0);
  st().setPlaying(true);
  await sleep(4000);
  log(st().isPlaying, 'zavartalan lejátszás nem áll meg magától (indulás + korrekciók)', `${st().playhead.toFixed(2)} s`);
  const pausedAt = st().playhead;
  for (const cid of ['zene', 'effekt']) {
    runDevAction(`audio.nativePause.${cid}`);
  }
  const t0 = Date.now();
  for (let i = 0; i < 30 && st().isPlaying; i++) {
    await sleep(50);
  }
  const reaction = Date.now() - t0;
  log(!st().isPlaying, 'a rendszer elnémította a hangot → a lejátszás megállt', `${reaction} ms alatt`);
  log(st().playhead - pausedAt < 1.2, 'a lejátszófej nem futott tovább néma hangra', `+${(st().playhead - pausedAt).toFixed(2)} s`);
  // C: a hívás végén az iOS magától folytatná — álló óránál nem szólhat
  await sleep(300);
  runDevAction('audio.nativePlay.zene');
  await sleep(700);
  log(runDevAction('audio.nativePlaying.zene') === false, 'a magától újrainduló hangot leállítja (álló óra)');
  // D: újraindítás után ismét szól
  st().setPlaying(true);
  await sleep(1500);
  log(st().isPlaying && runDevAction('audio.nativePlaying.zene') === true, 'újra lejátszva ismét szól');
  cleanup();
}

/** A10/A43 valódi mikrofonnal: leállítva és a felület bezárásakor is klip lesz, utána szól a lejátszás. */
async function smokeRecording(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const perm = await getRecordingPermissionsAsync();
  if (!perm.granted) {
    log(false, 'mikrofon-engedély', `nincs megadva (${perm.status}) — a felvétel nem mérhető ember nélkül`);
    return;
  }
  const project = createEmptyProject('smoke felvétel', '9:16');
  useEditorStore.getState().loadProject(project, []);
  const voiceClips = () => (useEditorStore.getState().project?.tracks.find((t) => t.type === 'voiceover')?.clips ?? []) as AudioClip[];
  const mount = () =>
    new Promise<RecordHandle>((resolve) => {
      // a felvétel indításakor rögzített lejátszófej (üres projektben a playhead 0-ra korlátos)
      setHarness(<RecordHarness onReady={resolve} start={() => 1.01} />);
    });

  // A: felvétel → leállítás
  let h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(1500);
  await h.finish.current();
  const a = voiceClips()[0];
  const aDur = a ? await probeAudioDuration(a.uri) : 0;
  log(!!a && Math.abs(a.duration - 1.5) < 0.3, 'A10 a leállított felvétel klip lett, a recorder idejével', `${a?.duration.toFixed(2)} s`);
  log(!!a && Math.abs(aDur - a.duration) < 0.3, 'a fájl hossza egyezik a klipével', `${aDur.toFixed(2)} s`);
  log(a?.start === 1 && a.trimIn === 0 && a.sourceDuration === a.duration, 'A43 frame-rácsra ül, van trimIn és sourceDuration', `start ${a?.start}`);
  log(!!a && !a.uri.includes('/Caches/'), 'a felvétel a projekt-mappába került', a?.uri.split('/').slice(-2).join('/'));

  // a lejátszás a felvétel után halad (a felvételi mód nem ragadt be)
  const tone = toneWav('smoke_after_rec.wav', 2);
  const player = createAudioPlayer(tone);
  await sleep(400);
  player.play();
  await sleep(900);
  const pos = player.currentTime;
  player.remove();
  new File(tone).delete();
  log(pos > 0.4, 'A43 a lejátszás a felvétel után halad', `${pos.toFixed(2)} s`);

  // B: felvétel közben a felület bezárul
  h = await mount();
  await startVoiceRecording(h.recorder);
  await sleep(1500);
  setHarness(null);
  await sleep(1500);
  const b = voiceClips()[1];
  const bDur = b ? await probeAudioDuration(b.uri) : 0;
  log(!!b && bDur > 1, 'A10 a bezáráskor futó felvétel is klip lett, a fájl ép', b ? `${b.duration.toFixed(2)} s klip, ${bDur.toFixed(2)} s fájl` : 'nincs klip');
  for (const c of voiceClips()) {
    new File(c.uri).delete();
  }
}

/** A42: egy órás hang-projekt a valódi stúdióban — a vonalzó és a rács látszik (képernyőkép). */
async function smokeAudioRuler(log: Log, lockMusic = false) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_audioruler';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioRuler', caught));
  const base = createEmptyProject('smoke egy órás hang', '9:16', undefined, 'audio');
  const long: AudioClip = { kind: 'audio', id: 'smoke-long', uri: 'file:///smoke-long.m4a', label: 'Podcast (60 perc)', start: 0, duration: 3600, trimIn: 0, sourceDuration: 3600, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [long] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  log(useEditorStore.getState().project?.id === id, 'az egy órás projekt megnyílt a stúdióban');
  if (lockMusic && !useEditorStore.getState().lockedTracks.includes('music')) {
    // A47: a videó-szerkesztővel közös zár — a stúdióban látszania kell
    useEditorStore.getState().toggleTrackFlag('music', 'lock');
    await sleep(500);
  }
  log(true, 'FOTÓZHATÓ', 'a vonalzó és az ütem-rács');
  await sleep(6000);
  if (lockMusic) {
    useEditorStore.getState().toggleTrackFlag('music', 'lock');
  }
  router.back();
  await sleep(800);
  await deleteProject(id);
}

async function smokeAudioKillVerify(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const saved = await loadProject(AUDIO_KILL_ID);
  const clips = saved?.tracks.find((t) => t.type === 'music')?.clips ?? [];
  log(clips.length === 2, 'a kilövés előtti szerkesztés megmaradt', `${clips.length} klip a zene-sávon`);
  const second = clips.find((c) => c.start > 0) as AudioClip | undefined;
  log(second?.start === 2 && second.trimIn === 2, 'a vágás helyes a visszatöltött projektben', `start ${second?.start}, trimIn ${second?.trimIn}`);
  await deleteProject(AUDIO_KILL_ID);
}

/** 16 bites mono szinusz WAV; a hang-mérés valódi fájlon megy, fixture nélkül. */
function toneWav(name: string, seconds: number): string {
  const rate = 44100;
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 16000), true);
  }
  const file = new File(Paths.document, name);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
  return file.uri;
}

/** 16 bites sztereó WAV: bal csatorna csend, jobb csatornán szinusz `amp` szinttel, `from` mp-től. */
function stereoRightWav(name: string, seconds: number, amp: number, from: number): string {
  const rate = 44100;
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 4);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 4, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 4, true);
  for (let i = 0; i < samples; i++) {
    const v = i / rate >= from ? Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amp * 32767) : 0;
    view.setInt16(44 + i * 4 + 2, v, true);
  }
  const file = new File(Paths.document, name);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
  return file.uri;
}

/** A20: új munkamenetben a háttér-hullámforma a korábbi bizonyításon múlik (`reset` törli). */
async function smokeWaveformBackground(log: Log, reset: boolean) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  if (reset) {
    for (const name of Paths.document.list().map((e) => e.name).filter((n) => n.startsWith('.audioapi-ok-'))) {
      new File(Paths.document, name).delete();
    }
    log(null, 'bizonyítás törölve', 'a következő indítás bizonyítás nélkül fut');
    return;
  }
  const uri = stereoRightWav(`smoke_wavebg_${Date.now().toString(36)}.wav`, 2, 0.5, 0);
  log(null, 'dekóder-állapot az új munkamenet elején', audioApiState());
  const wave = await getWaveform(uri);
  log(null, 'A20 háttér-hullámforma új munkamenetben', wave ? `${wave.peaks.length} csúcs, max ${Math.max(...wave.peaks)}` : 'nincs');
  const studio = await getWaveform(`${uri}`, { userInitiated: true });
  log(!!studio, 'A20 a Hang Stúdió hullámformája bizonyítás nélkül is megjön', studio ? `${studio.peaks.length} csúcs` : 'nincs');
  new File(uri).delete();
}

/** A20/A22/A24 a valódi natív dekóderrel: iOS-en is fut, a jobb csatorna és a vágás számít. */
async function smokeWaveform(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  clearWaveformMemory();
  // 2 mp csend, majd 2 mp 0.5-ös szinusz CSAK a jobb csatornán
  const uri = stereoRightWav(`smoke_wave_${Date.now().toString(36)}.wav`, 4, 0.5, 2);
  log(null, 'dekóder-állapot indulás előtt', audioApiState());
  const background = await getWaveform(uri);
  log(null, 'háttér-hívás az első dekódolás előtt', background ? 'van hullámforma' : 'nincs (iOS-őr)');
  clearWaveformMemory();
  const started = Date.now();
  const api = await loadAudioApi();
  const decoded = api ? await api.decodeAudioData(uri, 8000) : null;
  log(!!decoded, 'A20 a natív dekóder iOS-en fut, összeomlás nélkül', decoded ? `${decoded.numberOfChannels} csatorna, ${decoded.duration.toFixed(2)} s, ${Date.now() - started} ms` : 'nincs modul');
  if (decoded) {
    markAudioApi(true);
  }
  const wave = await getWaveform(uri);
  log(!!wave, 'A20 a háttér-hívás a bizonyítás után hullámformát ad', wave ? `${wave.peaks.length} csúcs` : 'null');
  if (wave) {
    const head = clipWindowPeaks(wave, 0, 2);
    const tail = clipWindowPeaks(wave, 2, 2);
    const max = (xs: number[]) => Math.max(0, ...xs);
    log(max(head) < 0.02, 'A22 a csendes szakasz csendes', `max ${max(head)}`);
    log(Math.abs(max(tail) - 0.5) < 0.05, 'A24 a csak jobb csatornás jel is látszik, helyes szinten', `max ${max(tail)}`);
    log(tail.length === 2 * WAVEFORM_PPS && head.length === 2 * WAVEFORM_PPS, 'A22 a vágott ablak pontos hosszú', `${head.length} + ${tail.length} csúcs`);
  }
  new File(uri).delete();
}

/** A6 és A19 valódi fájlon: a sérült hang nem kerül be, a mérés a jelenlegi mixet adja. */
async function smokeAudioMix(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_tone.wav', 3);
  const broken = new File(Paths.document, 'smoke_broken.mp3');
  if (broken.exists) {
    broken.delete();
  }
  broken.write(new Uint8Array(4096).fill(7));
  const good = await probeAudioDuration(uri);
  log(Math.abs(good - 3) < 0.1, 'A6 az ép hang hossza a fájlból jön', `${good.toFixed(2)} s`);
  const bad = await probeAudioDuration(broken.uri);
  const intake = classifyAudioIntake({ uri: broken.uri, name: 'smoke_broken.mp3', durationSec: bad });
  log(bad === 0 && !intake.ok, 'A6 a sérült fájl nem kerül be', `${bad} s, ok=${intake.ok}`);
  broken.delete();

  const base = createEmptyProject('smoke mix', '1:1', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'smoke-mix-clip', uri, label: 'tone', start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const project: Project = {
    ...base,
    tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr)),
  };
  const measure = async (masterVolume: number) => {
    const mix = mixForExport(project, () => true, masterVolume);
    return mix ? analyzeMixOnDevice(mix) : null;
  };
  const full = await measure(1);
  const half = await measure(0.5);
  log(!!full && Number.isFinite(full.lufs), 'A19 a jelenlegi mix mérhető a telefonról', `${full?.lufs} LUFS`);
  const drop = (full?.lufs ?? 0) - (half?.lufs ?? 0);
  log(Math.abs(drop - 6) < 1, 'A19 a master-hangerő a mért értékben is látszik', `${drop.toFixed(1)} dB esés`);
  log(mixForExport(project, () => false, 1) === null, 'A15 némított projektből nincs export');

  if (!cloudInThisBuild()) {
    log(null, 'A28–A32 szerveres album-export: kimarad', 'ebben a buildben nincs felhő-cím');
    return;
  }
  // A32 album-út: veszteségmentes render, helyi fájlba letöltve (nem lejáró link)
  const url = await exportAudioFile(project, 'flac');
  const local = await downloadToCache(url, 'smoke_album.flac');
  const localDur = local ? await probeAudioDuration(local) : 0;
  log(!!local && local.startsWith('file:') && !local.includes('?t='), 'A32 a szám helyi fájlként marad meg', local?.split('/').pop());
  log(Math.abs(localDur - 3) < 0.1, 'A32 a letöltött FLAC teljes hosszú', `${localDur.toFixed(2)} s`);
  if (local) {
    new File(local).delete();
  }

  // A29: a ✕ a futó exportot leállítja, nem jön kész fájl
  const long: Project = {
    ...project,
    tracks: project.tracks.map((tr) =>
      tr.type === 'music' ? { ...tr, clips: Array.from({ length: 8 }, (_, i) => ({ ...clip, id: `smoke-long-${i}`, start: i * 3 })) } : tr
    ),
  };
  const controller = new AbortController();
  const started = Date.now();
  const pending = exportAudioFile(long, 'wav', undefined, controller.signal);
  setTimeout(() => controller.abort(), 1500);
  const outcome = await pending.then(() => 'kész fájl', (e: Error) => (isRenderCancelledError(e) ? 'megszakítva' : e.message));
  log(outcome === 'megszakítva', 'A29 a megszakítás leállítja az exportot', `${outcome}, ${Date.now() - started} ms`);

  // A28/A31: fájlba exportálás fejléces hitelesítéssel, a kért formátumban
  const target = new File(projectExportDir(), audioExportFileName('Smoke export', 'wav'));
  const saved = await exportAudioToFile(
    project,
    audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 48000, channels: 1 }),
    target
  );
  const size = new File(saved).size ?? 0;
  // 3 s × 48 000 minta × 3 bájt (24 bit, mono) + WAV-fejléc
  const expected = 3 * 48000 * 3;
  log(Math.abs(size - expected) < 2000, 'A31 24 bit 48 kHz mono WAV készült', `${size} bájt (várt ~${expected})`);
  log(saved.includes('/Export/') && saved.endsWith('Smoke_export.wav'), 'A28 a fájl a projekt Export-mappájában van', saved.split('/').slice(-2).join('/'));
  new File(saved).delete();
  new File(uri).delete();

  setHarness(<AudioExportSheet onClose={() => {}} onPreview={() => {}} onUseInVideo={() => {}} onDownload={() => {}} />);
  log(true, 'FOTÓZHATÓ', 'a hangexport-lap a kijelzőn');
  await sleep(5000);
  setHarness(null);
}

async function smokeWorker(log: Log) {
  const doc = testDoc();
  const height = exportSize(doc, 2).height;
  const uri = await renderImageDoc(doc, height);
  if (!uri) {
    log(false, 'I9 worker-render a telefonról', 'null');
    return;
  }
  const img = await decode(uri);
  log(img.width() === 2160 && img.height() === 2160, 'I9 2× export a telefonról', `${img.width()}×${img.height()}`);
  log(pixel(img, 5, 5)[3] === 0, 'átlátszó háttér a telefonról kért exportban', `sarok α=${pixel(img, 5, 5)[3]}`);
  removeFile(uri);
}

function AutosaveProbe({ id }: { id: string }) {
  useProjectAutosave(id, true);
  return null;
}

function tempProject(id?: string): Project {
  const p = createEmptyProject('__smoke__', '1:1', undefined, 'image');
  return { ...p, id: id ?? `smoke_${Date.now().toString(36)}`, imageDocs: [testDoc()] };
}

function addTextEdit() {
  const s = useEditorStore.getState();
  const doc = s.project!.imageDocs![0];
  const marker = { kind: 'shape', id: `marker_${Date.now()}`, shape: 'ellipse', position: { x: 0.2, y: 0.2 }, w: 0.1, h: 0.1, fill: '#00ff00' } as ShapeLayer;
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(doc, marker as ImageLayer), label: 'smoke' });
  return marker.id;
}

async function cleanupProject(id: string) {
  useEditorStore.getState().closeProject();
  await deleteProject(id).catch(() => {});
  await deleteCloudProject(id).catch(() => false);
  await clearRecovery(id).catch(() => {});
}

async function smokeAutosave(log: Log, setHarness: (n: ReactNode) => void) {
  const p = tempProject();
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={p.id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  const onDisk = await loadProject(p.id);
  const saved = !!onDisk?.imageDocs?.[0].layers.some((l) => l.id === marker);
  log(saved, 'I1 autosave lemezre ír kilépés nélkül', saved ? 'a réteg a lemezen' : 'nincs a lemezen');
  log(!useEditorStore.getState().dirty, 'I1 mentés után nem piszkos');

  const second = addTextEdit();
  const flushed = await flushProjectSave();
  const afterFlush = await loadProject(p.id);
  log(flushed && !!afterFlush?.imageDocs?.[0].layers.some((l) => l.id === second), 'I1 azonnali mentés (háttérbe lépés útja)');

  const state = useEditorStore.getState();
  writeRecovery(state.project!, state.events);
  await sleep(300);
  const rec = await readRecovery(p.id);
  log(!!rec && recoveryIsFresher(rec.at, new Date(Date.now() - 60000).toISOString()), 'I1 recovery-pillanatkép visszaolvasható');

  // I3: hiányzó rétegfájl felismerése valódi fájlrendszeren
  const photo = { kind: 'photo', id: 'gone', uri: `${projectMediaDir().uri}/nincs_ilyen.png`, position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover' } as PhotoLayer;
  const s = useEditorStore.getState();
  s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: addLayer(s.project!.imageDocs![0], photo as ImageLayer), label: 'smoke' });
  const after = useEditorStore.getState().project!;
  log(after.assets.some((a) => a.uri === photo.uri), 'I2 a rétegfájl assetként regisztrálva');
  log(findMissingMedia(after).some((m) => m.uri === photo.uri), 'I3 a hiányzó rétegfájl felismerve');

  setHarness(null);
  await sleep(100);
  await cleanupProject(p.id);
  log((await loadProject(p.id)) == null, 'takarítás: az ideiglenes projekt törölve');
}

/** 1. fázis: szerkesztés + autosave, utána a Mac leállítja az appot */
async function killPhase1(log: Log, setHarness: (n: ReactNode) => void, id: string) {
  const p = tempProject(id);
  await saveProject(p);
  useEditorStore.getState().loadProject(p, []);
  setHarness(<AutosaveProbe id={id} />);
  await sleep(200);
  const marker = addTextEdit();
  await sleep(2200);
  log(null, 'KILL-READY', marker);
}

/** 2. fázis: az app leállítása után a szerkesztés megvan-e a lemezen */
async function killPhase2(log: Log, id: string) {
  const onDisk = await loadProject(id);
  const count = onDisk?.imageDocs?.[0].layers.filter((l) => l.id.startsWith('marker_')).length ?? 0;
  log(count === 1, 'I1 app-kill után a szerkesztés megmaradt', `${count} jelölő réteg`);
  await cleanupProject(id);
}

/** Csak olvas: a kép-projektek rétegei + a verzió-előzmény, hibakereséshez. */
async function inspectProjects(log: Log) {
  const all = (await listProjects()).filter((p) => p.kind === 'image');
  for (const meta of all) {
    const p = await loadProject(meta.id);
    log(null, `PROJ ${meta.name} ${meta.id}`, `upd=${p?.updatedAt} docs=${p?.imageDocs?.length} assets=${p?.assets.length}`);
    for (const d of p?.imageDocs ?? []) {
      for (const l of d.layers) {
        const uri = (l as PhotoLayer).uri;
        const exists = uri ? (() => { try { return new File(uri).exists; } catch { return false; } })() : null;
        const pos = (l as PhotoLayer).position;
        log(null, `  ${l.kind} ${l.id}`, `w=${(l as PhotoLayer).w} h=${(l as PhotoLayer).h} pos=${pos?.x},${pos?.y} hidden=${!!l.hidden} file=${uri?.split('/').pop()} exists=${exists}`);
      }
    }
    const versions = await loadVersions(meta.id).catch(() => []);
    const summary = versions.slice(0, 6).map((v) => `${v.at.slice(11, 19)}:${v.project.imageDocs?.[0]?.layers.map((l) => (l as PhotoLayer).uri?.split('/').pop() ?? l.kind).join('+')}`);
    log(null, `  verziók: ${versions.length}`, summary.join(' | '));
  }
}

/** A JS-szál mérése 20 mp-ig: 250 ms-os ketyegés, a késés a fagyást mutatja. Túléli a navigációt. */
function startFreezeWatch(log: Log) {
  let last = Date.now();
  let worst = 0;
  let ticks = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    worst = Math.max(worst, now - last - 250);
    last = now;
    ticks += 1;
    if (ticks === 80) {
      clearInterval(timer);
      const s = useEditorStore.getState();
      log(worst < 500, 'JS-szál a valódi stúdióban (20 mp)', `legnagyobb akadás ${worst} ms, dirty=${s.dirty}, past=${s.past.length}`);
      console.log('[IMG-SMOKE] WATCH-DONE');
    }
  }, 250);
}

/** Ideiglenes projekt a tablet-elrendezés megnézéséhez (`kill2` törli). */
export async function tabletProject(id: string): Promise<string> {
  await saveProject(tempProject(id));
  return id;
}

export async function firstImageProjectId(): Promise<string | null> {
  const all = await listProjects();
  return all.find((p) => p.kind === 'image')?.id ?? null;
}

export async function runImageSmoke(
  phase: string,
  log: Log,
  setHarness: (n: ReactNode) => void,
  ratio: number,
  killId: string
): Promise<void> {
  const step = async (name: string, fn: () => unknown) => {
    try {
      await fn();
    } catch (e) {
      log(false, name, String((e as Error)?.message ?? e).slice(0, 300));
    }
  };
  if (phase === 'kill1') {
    await step('kill1', () => killPhase1(log, setHarness, killId));
    return;
  }
  if (phase === 'kill2') {
    await step('kill2', () => killPhase2(log, killId));
    return;
  }
  if (phase === 'ui') {
    startFreezeWatch(log);
    return;
  }
  if (phase === 'inspect') {
    await step('inspect', () => inspectProjects(log));
    return;
  }
  if (phase === 'selectbar') {
    await step('selectbar', async () => {
      setHarness(
        <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center' }}>
          <SelectionBar tool="rect" mode="subtract" selection={applyRing(null, rectRing({ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }), 'new')} canUseLayer canShape={false} onTool={() => {}} onMode={() => {}} onInvert={() => {}} onFeather={() => {}} onAction={() => {}} onClear={() => {}} onDone={() => {}} />
        </View>
      );
      log(true, 'FOTÓZHATÓ', 'a kijelölés sávja a kijelzőn');
      await sleep(6000);
      setHarness(null);
    });
    return;
  }
  if (phase === 'color') {
    await step('color', () => smokeColor(log, setHarness, ratio));
    return;
  }
  if (phase === 'shuttle') {
    await step('shuttle', () => smokeShuttle(log));
    return;
  }
  if (phase === 'studio') {
    await step('studio', () => smokeLiveStudio(log));
    return;
  }
  if (phase === 'actionmenu') {
    await step('actionmenu', () => smokeActionMenu(log));
    return;
  }
  if (phase === 'login') {
    await step('login', () => smokeLogin(log));
    return;
  }
  if (phase === 'wavereset' || phase === 'wavebg') {
    await step(phase, () => smokeWaveformBackground(log, phase === 'wavereset'));
    return;
  }
  if (phase === 'waveform') {
    await step('waveform', () => smokeWaveform(log));
    return;
  }
  if (phase === 'audiomix') {
    await step('audiomix', () => smokeAudioMix(log, setHarness));
    return;
  }
  if (phase === 'audioruler' || phase === 'audiolock') {
    await step(phase, () => smokeAudioRuler(log, phase === 'audiolock'));
    return;
  }
  if (phase === 'albumsheet') {
    await step('albumsheet', () => smokeAlbumSheet(log, setHarness));
    return;
  }
  if (phase === 'offlinespeed') {
    await step('offlinespeed', () => smokeOfflineSpeed(log));
    return;
  }
  if (phase === 'videosync') {
    await step('videosync', () => smokeVideoSync(log));
    return;
  }
  if (phase === 'audioedge') {
    await step('audioedge', () => smokeAudioEdge(log));
    return;
  }
  if (phase === 'audiotags') {
    await step('audiotags', () => smokeAudioTags(log));
    return;
  }
  if (phase === 'videoaudio') {
    await step('videoaudio', () => smokeVideoAudioExport(log, setHarness));
    return;
  }
  if (phase === 'audiofit') {
    await step('audiofit', () => smokeAudioFit(log));
    return;
  }
  if (phase === 'audiometer') {
    await step('audiometer', () => smokeAudioMeter(log));
    return;
  }
  if (phase === 'audiosync') {
    // a klipenkénti lejátszók szinkronja (a még csak a renderben szóló effektes projektek útja)
    previewEngine.forceFallback = true;
    try {
      await step('audiosync', () => smokeAudioSync(log));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'offline') {
    await step('offline', () => smokeOfflineExport(log));
    return;
  }
  if (phase === 'bleed') {
    await step(phase, () => smokeBleed(log));
    return;
  }
  if (phase === 'dspnative') {
    await step(phase, () => smokeDspNative(log));
    return;
  }
  if (phase === 'dspprof') {
    await step(phase, () => smokeDspProf(log));
    return;
  }
  if (phase === 'videoref') {
    await step(phase, () => smokeVideoRef(log));
    return;
  }
  if (phase === 'audiotemplate') {
    await step(phase, () => smokeAudioTemplate(log));
    return;
  }
  if (phase === 'quickvol') {
    await step(phase, () => smokeQuickVolume(log));
    return;
  }
  if (phase === 'ttsdevice') {
    await step(phase, () => smokeTtsDevice(log));
    return;
  }
  if (phase === 'metronome') {
    await step(phase, () => smokeMetronome(log));
    return;
  }
  if (phase === 'bpmoffline') {
    await step(phase, () => smokeBpmOffline(log));
    return;
  }
  if (phase === 'instredit') {
    await step(phase, () => smokeInstrumentEdit(log));
    return;
  }
  if (phase === 'newerschema') {
    await step(phase, () => smokeNewerSchema(log));
    return;
  }
  if (phase === 'veltouch') {
    await step(phase, () => smokeVelTouch(log));
    return;
  }
  if (phase === 'velswing') {
    await step(phase, () => smokeVelSwing(log));
    return;
  }
  if (phase === 'audioremix') {
    await step(phase, () => smokeAudioRemix(log));
    return;
  }
  if (phase === 'refab') {
    await step(phase, () => smokeRefAB(log));
    return;
  }
  if (phase === 'masterdyn') {
    await step(phase, () => smokeMasterDyn(log));
    return;
  }
  if (phase === 'fxorder') {
    await step(phase, () => smokeFxOrder(log));
    return;
  }
  if (phase === 'remotegain') {
    await step(phase, () => smokeRemoteGain(log));
    return;
  }
  if (phase === 'lockpersist') {
    await step(phase, () => smokeLockPersist(log));
    return;
  }
  if (phase === 'lockowner') {
    await step(phase, () => smokeLockOwner(log));
    return;
  }
  if (phase === 'lockmember') {
    await step(phase, () => smokeLockMember(log));
    return;
  }
  if (phase === 'collabcleanup') {
    await step(phase, () => smokeCollabCleanup(log));
    return;
  }
  if (phase === 'collabowner') {
    await step(phase, () => smokeCollabOwner(log));
    return;
  }
  if (phase === 'collabmember') {
    await step(phase, () => smokeCollabMember(log));
    return;
  }
  if (phase === 'whoami') {
    await step(phase, () => smokeWhoAmI(log));
    return;
  }
  if (phase === 'tempo') {
    await step(phase, () => smokeTempoMatch(log));
    return;
  }
  if (phase === 'fromvideo') {
    await step(phase, () => smokeFromVideo(log));
    return;
  }
  if (phase === 'clipgain') {
    await step(phase, () => smokeClipGain(log));
    return;
  }
  if (phase === 'gapedit') {
    await step(phase, () => smokeGapEdit(log));
    return;
  }
  if (phase === 'livelufs') {
    await step(phase, () => smokeLiveLufs(log));
    return;
  }
  if (phase === 'takes') {
    await step(phase, () => smokeTakes(log));
    return;
  }
  if (phase === 'punch') {
    await step(phase, () => smokePunch(log));
    return;
  }
  if (phase === 'recpause') {
    await step(phase, () => smokeRecPause(log));
    return;
  }
  if (phase === 'exportgap') {
    await step(phase, () => smokeExportGap(log));
    return;
  }
  if (phase === 'longwave') {
    await step(phase, () => smokeLongWave(log));
    return;
  }
  if (phase === 'aiundo') {
    await step(phase, () => smokeAiUndo(log));
    return;
  }
  if (phase === 'longcodec') {
    await step(phase, () => smokeLongCodec(log));
    return;
  }
  if (phase === 'console') {
    await step(phase, () => smokeConsole(log));
    return;
  }
  if (phase === 'touchmodes') {
    await step(phase, () => smokeTouchModes(log));
    return;
  }
  if (phase === 'a11y') {
    await step(phase, () => smokeA11y(log));
    return;
  }
  if (phase === 'linkedmix') {
    await step(phase, () => smokeLinkedMix(log));
    return;
  }
  if (phase === 'musicws') {
    await step(phase, () => smokeMusicWorkspace(log));
    return;
  }
  if (phase === 'pianoroll2') {
    await step(phase, () => smokePianoRoll2(log));
    return;
  }
  if (phase === 'modeldl') {
    await step(phase, () => smokeModelDownload(log));
    return;
  }
  if (phase === 'mixassist') {
    await step(phase, () => smokeMixAssist(log));
    return;
  }
  if (phase === 'audioassistant') {
    await step(phase, () => smokeAudioAssistant(log));
    return;
  }
  if (phase === 'audiocheck') {
    await step(phase, () => smokeAudioCheck(log));
    return;
  }
  if (phase === 'presetphoto') {
    await step(phase, () => smokePresetPhoto(log));
    return;
  }
  if (phase === 'userpresets') {
    await step(phase, () => smokeUserPresets(log));
    return;
  }
  if (phase === 'instruments') {
    await step(phase, () => smokeInstruments(log));
    return;
  }
  if (phase === 'stemexport') {
    await step(phase, () => smokeStemExport(log));
    return;
  }
  if (phase === 'extsync') {
    await step(phase, () => smokeExtSync(log));
    return;
  }
  if (phase === 'speechhu') {
    await step(phase, () => smokeSpeechHu(log));
    return;
  }
  if (phase === 'speechedit') {
    await step(phase, () => smokeSpeechEdit(log));
    return;
  }
  if (phase === 'whisperprobe') {
    await step(phase, () => smokeWhisperProbe(log));
    return;
  }
  if (phase === 'silence') {
    await step(phase, () => smokeSilence(log));
    return;
  }
  if (phase === 'beatsplit') {
    await step(phase, () => smokeBeatSplit(log));
    return;
  }
  if (phase === 'loopclip') {
    await step(phase, () => smokeLoopClip(log));
    return;
  }
  if (phase === 'meter') {
    await step(phase, () => smokeMeter(log));
    return;
  }
  if (phase === 'clipboard') {
    await step(phase, () => smokeClipboard(log));
    return;
  }
  if (phase === 'tracksbuses') {
    await step(phase, () => smokeTracksBuses(log));
    return;
  }
  if (phase === 'fxautomation') {
    await step(phase, () => smokeFxAutomation(log));
    return;
  }
  if (phase === 'audiomarkers') {
    await step(phase, () => smokeAudioMarkers(log));
    return;
  }
  if (phase === 'abcompare') {
    await step(phase, () => smokeAbCompare(log));
    return;
  }
  if (phase === 'crossfade') {
    await step(phase, () => smokeCrossfade(log));
    return;
  }
  if (phase === 'longsource') {
    await step(phase, () => smokeLongSource(log));
    return;
  }
  if (phase === 'proexport') {
    await step(phase, () => smokeProExport(log));
    return;
  }
  if (phase === 'denoise') {
    await step(phase, () => smokeDenoise(log));
    return;
  }
  if (phase === 'pitchspike') {
    await step(phase, () => smokePitchSpike(log));
    return;
  }
  if (phase === 'enginefx') {
    await step(phase, () => smokeEngineFx(log));
    return;
  }
  if (phase === 'offlinefx') {
    await step(phase, () => smokeOfflineFx(log));
    return;
  }
  if (phase === 'enginestudio') {
    await step(phase, () => smokeEngineStudio(log, setHarness));
    return;
  }
  if (phase === 'previewengine') {
    await step(phase, () => smokePreviewEngine(log));
    return;
  }
  if (phase === 'enginespike') {
    await step(phase, () => smokeEngineSpike(log));
    return;
  }
  if (phase === 'audioreverse') {
    // a klipenkénti lejátszók útja (a még csak a renderben szóló effektes projekteké) — ezt méri
    previewEngine.forceFallback = true;
    try {
      await step(phase, () => smokeAudioReverse(log));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'nativespeed') {
    await step(phase, () => smokeNativeSpeed(log));
    return;
  }
  if (phase === 'offlinestretch') {
    await step(phase, () => smokeOfflineStretch(log));
    return;
  }
  if (phase === 'audiospeed') {
    // a klipenkénti lejátszók útja (a még csak a renderben szóló effektes projekteké) — ezt méri
    previewEngine.forceFallback = true;
    try {
      await step(phase, () => smokeAudioSpeed(log));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'diskspace') {
    await step(phase, () => smokeDiskSpace(log, setHarness));
    return;
  }
  if (phase === 'interrupt' || phase === 'interruptbg') {
    // a klipenkénti lejátszók útja (a még csak a renderben szóló effektes projekteké) — ezt méri
    previewEngine.forceFallback = true;
    try {
      await step(phase, () => smokeInterrupt(log, setHarness, phase === 'interruptbg'));
    } finally {
      previewEngine.forceFallback = false;
    }
    return;
  }
  if (phase === 'recording') {
    await step('recording', () => smokeRecording(log, setHarness));
    return;
  }
  if (phase === 'audiokill1') {
    await step('audiokill1', () => smokeAudioKillPrepare(log));
    return;
  }
  if (phase === 'audiokill2') {
    await step('audiokill2', () => smokeAudioKillVerify(log));
    return;
  }
  if (phase === 'menus') {
    await step('menus', () => smokeMenus(log, setHarness));
    return;
  }
  if (phase === 'timeline') {
    await step('timeline', () => smokeTimelineZoom(log));
    return;
  }
  if (phase === 'liverecord') {
    await step('liverecord', () => smokeLiveRecord(log, setHarness));
    return;
  }
  if (phase === 'livehost') {
    await step('livehost', () => smokeLiveHost(log));
    return;
  }
  if (phase.startsWith('liveview-')) {
    await step('liveview', () => smokeLiveView(log, phase.slice('liveview-'.length)));
    return;
  }
  if (phase === 'screens') {
    await step('screens', () => smokeGestureScreens(log));
    return;
  }
  if (phase === 'pixel') {
    await step('pixel', () => smokePixel(log, setHarness, ratio));
    return;
  }
  if (phase === 'perfphoto') {
    await step('perfphoto', () => smokePerfPhotos(log, setHarness));
    return;
  }
  if (phase === 'perf') {
    await step('perf', () => smokePerf(log, setHarness));
    return;
  }
  if (phase === 'remix') {
    await step('remix', () => smokeRemix(log, setHarness, ratio));
    return;
  }
  if (phase === 'brand') {
    await step('brand', () => smokeEcosystem(log, setHarness, ratio, true));
    return;
  }
  if (phase === 'eco') {
    await step('eco', () => smokeEcosystem(log, setHarness, ratio));
    return;
  }
  if (phase === 'assistant') {
    await step('assistant', () => smokeAssistant(log, setHarness, ratio));
    return;
  }
  if (phase === 'export13') {
    await step('export13', () => smokeImportExport(log));
    return;
  }
  if (phase === 'grid') {
    await step('grid', () => smokeGrid(log, setHarness, ratio));
    return;
  }
  if (phase === 'pathops') {
    await step('pathops', () => smokePathOps(log, setHarness, ratio));
    return;
  }
  if (phase === 'boolean') {
    await step('boolean', () => smokeBoolean(log, setHarness, ratio));
    return;
  }
  if (phase === 'vector') {
    await step('vector', () => smokeVector(log, setHarness, ratio));
    return;
  }
  if (phase === 'bgremove') {
    await step('bgremove', () => smokeBgRemove(log, setHarness, ratio));
    return;
  }
  if (phase === 'retouch') {
    await step('retouch', () => smokeRetouch(log));
    return;
  }
  if (phase === 'paintmask') {
    await step('paintmask', () => smokePaintMask(log, setHarness, ratio));
    return;
  }
  if (phase === 'logs') {
    await step('logs', async () => {
      // egyedi üzenetű hiba, hogy a szerveren egyértelműen megtalálható legyen
      logCaught('lib/imageSmoke.tsx:logs', new Error(`smoke-naplo-proba ${Platform.OS}`));
      // a Supabase nem dob: a nem létező tábla hibája csak a kérés-szintű naplóból látszik
      const res = await supabase?.from('smoke_nincs_ilyen_tabla').select('id').limit(1);
      log(!!res?.error, 'a Supabase-hiba a hívónak is megmarad', res?.error?.code ?? 'nincs hiba');
      await sleep(4000);
    });
    return;
  }
  if (phase === 'net') {
    await step('net', async () => {
      const probe = async (url: string) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const t0 = Date.now();
        try {
          const r = await fetch(url, { signal: ctrl.signal });
          log(r.ok, 'elérés', `${url} HTTP ${r.status}, ${Date.now() - t0} ms`);
        } catch (e) {
          log(false, 'elérés', `${url} ${String(e).slice(0, 70)}, ${Date.now() - t0} ms`);
        }
        clearTimeout(timer);
      };
      log(true, 'eszköz', Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'telefon');
      await probe('http://192.168.0.34:8081/status');
      await probe('http://192.168.0.34:8787/health');
      await probe('http://192.168.0.34:8081/status');
      await probe('http://192.168.0.34:8787/health');
    });
    return;
  }
  if (phase === 'selection') {
    await step('selection', () => smokeSelection(log, setHarness, ratio));
    return;
  }
  if (phase === 'brushbar') {
    await step('brushbar', async () => {
      setHarness(
        <View style={{ width: Math.min(390, Dimensions.get('window').width), alignSelf: 'center' }}>
          <BrushBar brush={{ ...DEFAULT_BRUSH, tool: 'clone' }} retouch onChange={() => {}} canUndo canRedo={false} onUndo={() => {}} onRedo={() => {}} onCancel={() => {}} onDone={() => {}} />
        </View>
      );
      log(true, 'FOTÓZHATÓ', 'az ecset-sáv a kijelzőn');
      await sleep(7000);
      setHarness(null);
    });
    return;
  }
  if (phase === 'brush') {
    await step('brush', () => smokeBrushEngine(log, setHarness, ratio));
    return;
  }
  if (phase === 'deep3') {
    await step('deep3', () => smokeDeep3(log, setHarness, ratio));
    return;
  }
  if (phase === 'deep2') {
    await step('deep2', () => smokeDeep2(log, setHarness, ratio));
    return;
  }
  if (phase === 'deep') {
    await step('deep', () => smokeDeep(log, setHarness, ratio));
    return;
  }
  if (phase === 'parity') {
    await step('parity', () => smokeParity(log));
    return;
  }
  if (phase === 'sheets') {
    await step('sheets', () => smokeSheets(log, setHarness));
    return;
  }
  if (phase === 'pasteboard') {
    await step('pasteboard', () => smokePasteboard(log, setHarness));
    return;
  }
  const online = await smokeNetwork(log);
  await step('brush', () => smokeBrush(log));
  await step('intake', () => smokeIntake(log));
  await step('capture', () => smokeCapture(log, setHarness, ratio));
  await step('wand', () => smokeWand(log));
  await step('zoom', () => smokeZoomCanvas(log, setHarness));
  // a takarítása bezárja a store projektjét: a felhasználó nyitott munkájához nem nyúlhat
  if (useEditorStore.getState().project) {
    log(null, 'autosave-kör kihagyva', 'nyitott projekt van');
  } else {
    await step('autosave', () => smokeAutosave(log, setHarness));
  }
  if (online) {
    await step('worker', () => smokeWorker(log));
    await step('canvas-ops', () => smokeCanvasOps(log));
    await step('parity', () => smokeParity(log));
  }
}

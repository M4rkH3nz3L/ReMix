/** 🧪 Füstteszt-fázisok (a korábbi src/lib/imageSmoke.tsx gépi bontása). */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import type { ReactNode, RefObject } from 'react';
import { createRef } from 'react';
import { Dimensions, PixelRatio, Platform, View } from 'react-native';
import { Asset } from 'expo-asset';
import { type Href, router } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import '@/lib/dspNativeClient';
import { auditionDrum, auditionNote, lastStartMs, playPcm, previewLooping, previewPosition, stopPreview, warmPreview } from '@/lib/instrumentPreview';
import { renderDrumsPcm, renderSamplerPcm, renderSynthPcm } from '@/lib/instrumentRender';
import { decodeSample } from '@/lib/instrumentClient';
import { applyCommand } from '@/lib/commands';
import { linkedAssets, mixdownVersion, relinkPlan, stillVersion } from '@/lib/linkedAsset';
import { sendMixdownToVideo, sendStillToVideo, sourceVersionOf } from '@/lib/linkedAssetClient';
import { renderProjectVersion } from '@/lib/render';
import { thumbnailFramesOnDevice } from '@/lib/thumbStudio';
import { posterNeedsRefresh, thumbnailDoc, thumbnailDocOf } from '@/lib/thumbnailDoc';
import { renderOnDevice } from '@/lib/renderStageRegistry';
import { projectPreviewSource } from '@/lib/projectPreview';
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
import { t as i18nT } from 'i18next';
import { downloadModel, listCachedModels, removeModel } from '@/lib/modelRegistryClient';
import { bestUsableWhisperModelId, runWhisperSmokeTest, transcribeMediaOnDevice } from '@/lib/whisperClient';
import { catalogEntry } from '@/lib/modelCatalog';
import { integratedLoudness } from '@/lib/loudness';
import { encodeWav16 } from '@/lib/offlineMix';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { mixForExport } from '@/lib/audioExportMix';
import { RenderStage, type RenderStageHandle } from '@/components/studio/image/RenderStage';
import { makeId } from '@/lib/id';
import { createEmptyProject, CURRENT_SCHEMA_VERSION } from '@/lib/projectUtils';
import { deleteProject, loadProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, ImageClip, VideoClip, ImageDoc, Project } from '@/types/project';
import { type Log, decode, pixel, removeFile, sleep, smokeFileHost, toneWav } from './shared';

/** kulcs-sorrendtől független JSON (szerkezeti egyezéshez) */
function sortedJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
}
/** ✋✂️↔️ Érintéses módok (Android emulátoron valódi adb-koppintással/-húzással): vágás, kijelölés, mozgatás; nagy sávok. */
/**
 * ♿ S8 (AUDIO-PROD): minden hang-vezérlőnek van neve a képernyőolvasónak. A Hang Stúdió lapjai
 * SORBAN nyitva maradnak; mindegyiknél `READY <név>` → a héj (`adb shell uiautomator dump`) a
 * `content-desc`/`text` mezőket menti és a címkézetlen érinthető elemeket számolja. A statikus
 * őrteszt (`a11yGuard.test.ts`) a forrást zárja, ez a VALÓDI natív a11y-fát.
 */
export async function smokeA11y(log: Log) {
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
/**
 * 🖼️→🎬 CORE K2 (IMAGE-PROD C2): a kép-lap HIVATKOZÁSKÉNT a videóban — a lap módosítása után a
 * videóban „Frissítés elérhető”, egy koppintás a telefonon rendereli az új képet, egy visszavonás.
 */
export async function smokeLinkedImage(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}, pixelarány ${PixelRatio.get()}`);
  const imageId = 'prj_smoke_linked_image';
  const videoIds: string[] = [];
  await deleteProject(imageId).catch((caught) => logCaught('lib/imageSmoke.tsx:linkimg', caught));
  const doc0 = {
    id: 'lap1',
    name: 'Borító',
    aspectRatio: '1:1',
    width: 320,
    height: 320,
    layers: [
      { kind: 'fill', id: 'bg', fill: '#3070d0' },
      { kind: 'shape', id: 'r', shape: 'rectangle', position: { x: 0.5, y: 0.5 }, w: 0.5, h: 0.5, fill: '#ff0000' },
    ],
  } as unknown as ImageDoc;
  const base = createEmptyProject('smoke borító', '1:1', undefined, 'image');
  const image: Project = { ...base, id: imageId, imageDocs: [doc0] };
  await saveProject(image);
  const ref = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
  setHarness(
    <View style={{ width: 1, height: 1 }}>
      <RenderStage ref={ref} />
    </View>
  );
  await sleep(300);
  const st = useEditorStore.getState;
  const waitFor = async (cond: () => boolean, ms: number) => {
    for (let i = 0; i < ms / 100 && !cond(); i++) await sleep(100);
    return cond();
  };
  const center = async (uri: string) => {
    const img = await decode(uri);
    return pixel(img, Math.round(img.width() / 2), Math.round(img.height() / 2)).slice(0, 3);
  };
  try {
    // 📊 CORE K4: tiszta napló; a Kép Stúdió valódi megnyitása = a lánc 1. stúdiója (az útvonal naplózza)
    await clearCswcrLog();
    router.push(`/studio/image/${imageId}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== imageId; i++) await sleep(200);
    await sleep(800);
    router.back();
    await sleep(600);
    // 1) küldés hivatkozással egy ÚJ videó-projektbe (a telefonos render-színpad képével)
    const uri0 = await ref.current!.render(doc0, 320);
    if (!uri0) throw new Error('nincs telefonos render');
    const video = await sendStillToVideo(image, doc0, uri0, null, { newName: 'smoke kép-videó' });
    videoIds.push(video.id);
    const asset = linkedAssets(video)[0];
    const v0 = stillVersion(doc0);
    const vClip = video.tracks.find((t) => t.type === 'video')!.clips[0] as ImageClip;
    log(
      asset?.source?.output === 'still' && asset.source.docId === 'lap1' && asset.source.version === v0 && vClip.docId === 'lap1',
      'a videó a kép-lapra hivatkozik (verzióval), a klip a rétegeket is hordozza',
      `${asset?.source?.output} ${asset?.source?.docId} ${asset?.source?.version}`
    );
    // 2) a lap módosul a Kép Stúdióban (piros → zöld) és mentődik
    const doc1 = { ...doc0, layers: [doc0.layers[0], { ...doc0.layers[1], fill: '#00c000' }] } as ImageDoc;
    await saveProject({ ...image, imageDocs: [doc1] });
    const stored = await sourceVersionOf(imageId, { output: 'still', docId: 'lap1' });
    log(stored === stillVersion(doc1) && stored !== v0, 'a lap módosítása új kimenet-verziót ad (a tárolt = a tartalomé)', `${v0} → ${stored}`);
    // 3) a videó megnyitása → „Frissítés elérhető”
    setHarness(null);
    router.push(`/editor/${video.id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== video.id; i++) await sleep(200);
    await sleep(1500);
    const stale = await waitFor(() => ((runDevAction('linked.stale') as string[] | undefined)?.length ?? 0) === 1, 10000);
    log(stale, '„Frissítés elérhető”: a videó észleli a lap új verzióját', JSON.stringify(runDevAction('linked.stale')));
    log(true, 'FOTÓZHATÓ', 'a „Frissítés elérhető” sáv a videó-szerkesztő tetején');
    await sleep(1500);
    // 4) egy koppintás: a telefon rendereli az új képet, a klip és a beágyazott rétegek is frissülnek
    const clipOf = () => st().project!.tracks.find((t) => t.type === 'video')!.clips[0] as ImageClip;
    const loadedUri = clipOf().uri;
    const before = await center(loadedUri);
    await runDevAction('linked.update');
    const updated = await waitFor(() => clipOf().uri !== loadedUri, 20000);
    const after = await center(clipOf().uri);
    const asset1 = st().project!.assets.find((a) => a.source?.docId === 'lap1');
    const embedded = st().project!.imageDocs?.find((d) => d.id === 'lap1');
    const embeddedFill = (embedded?.layers[1] as { fill?: string } | undefined)?.fill;
    log(
      updated && after[1] > 150 && after[0] < 60 && before[0] > 200 && asset1?.source?.version === stored && embeddedFill === '#00c000',
      'egy koppintás: az új kép (zöld) a telefonon, a verzió a forrásé, a beágyazott rétegek is frissek',
      `közép ${before.join(',')} → ${after.join(',')}, verzió ${asset1?.source?.version}, réteg ${embeddedFill}`
    );
    const cleared = await waitFor(() => ((runDevAction('linked.stale') as string[] | undefined)?.length ?? 0) === 0, 8000);
    log(cleared, 'a sáv eltűnik a frissítés után');
    // 5) egy visszavonás: a régi kép, verzió és rétegek
    st().undo();
    await sleep(300);
    const asset2 = st().project!.assets.find((a) => a.source?.docId === 'lap1');
    const fill2 = (st().project!.imageDocs?.find((d) => d.id === 'lap1')?.layers[1] as { fill?: string } | undefined)?.fill;
    log(clipOf().uri === loadedUri && asset2?.source?.version === v0 && fill2 === '#ff0000', 'egy visszavonás: a régi kép, verzió és rétegek', `${asset2?.source?.version} · ${fill2}`);
    st().redo();
    await sleep(300);
    // 📊 CORE K4: a videó VALÓDI renderje (a telefonon) befejezi a láncot → a mérőszám
    const t0 = Date.now();
    const rendered = await renderProjectVersion(st().project!).catch((caught) => {
      logCaught('lib/imageSmoke.tsx:linkimg-render', caught);
      return null;
    });
    const stats = (await runDevAction('cswcr.stats')) as CswcrStats;
    log(!!rendered && stats.link.link >= 1 && stats.link.copy === 0, 'CSWCR: a kép → videó átadás hivatkozás volt (link-arány 1)', `render ${Date.now() - t0} ms · link ${stats.link.link}, másolat ${stats.link.copy}`);
    log(stats.flow.multiStudio >= 1 && stats.flow.started >= 1 && stats.flow.completed >= 1 && stats.flow.relinks >= 1, 'CSWCR: a kép → videó lánc többstúdiós, elkezdett és a videó-exporttal befejezett; a frissítés elfogadva', `láncok ${stats.flow.chains}, többstúdiós ${stats.flow.multiStudio}, elkezdett ${stats.flow.started}, befejezett ${stats.flow.completed}, relink ${stats.flow.relinks}, CSWCR ${stats.flow.cswcr?.toFixed(2)}`);
    if (rendered?.uri) removeFile(rendered.uri);
    router.back();
    await sleep(600);
    // 6) MEGLÉVŐ videó-projektbe: a klip a meglévők után, hivatkozással
    const existing = await loadProject(video.id);
    if (existing) {
      const n0 = existing.tracks.find((t) => t.type === 'video')!.clips.length;
      const stage2 = createRef<RenderStageHandle>() as RefObject<RenderStageHandle>;
      setHarness(
        <View style={{ width: 1, height: 1 }}>
          <RenderStage ref={stage2} />
        </View>
      );
      await sleep(300);
      const uri2 = await stage2.current!.render(doc1, 320);
      const v2 = uri2 ? await sendStillToVideo(image, doc1, uri2, existing, { newName: '-' }) : null;
      const n1 = v2?.tracks.find((t) => t.type === 'video')!.clips.length ?? 0;
      log(!!v2 && v2.id === video.id && n1 === n0 + 1 && linkedAssets(v2).length >= 2, 'küldés meglévő videóba: a klip a meglévők után, hivatkozással', `${n0} → ${n1} klip`);
      setHarness(null);
    }
  } finally {
    setHarness(null);
    if (st().project && videoIds.includes(st().project!.id)) {
      router.back();
      await sleep(500);
    }
    await deleteProject(imageId).catch((caught) => logCaught('lib/imageSmoke.tsx:linkimg-del', caught));
    for (const id of videoIds) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:linkimg-del2', caught));
  }
}
/**
 * 🖼️ CORE K5 (IMAGE-PROD C3): szerkeszthető videó-thumbnail — kockák a telefonon, a lap a
 * videó-projektben (egy köteg), a Kép Stúdió ugyanazon a projekten nyitja, az előnézet és a
 * feed-poszter a lapból készül, mentés után is megvan.
 */
export async function smokeThumbDoc(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}, pixelarány ${PixelRatio.get()}`);
  const asset = Asset.fromModule(require('../../../assets/videos/fekvo.mp4'));
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const id = 'prj_smoke_thumbdoc';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:thumbdoc', caught));
  const base = createEmptyProject('smoke thumbnail', '16:9', undefined, 'video');
  const clip = { id: 'v', kind: 'video', uri, start: 0, duration: 8, trimIn: 0, sourceDuration: 10, speed: 1, volume: 1, filterId: 'none' } as VideoClip;
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'video' ? { ...tr, clips: [clip] } : tr)) });
  const st = useEditorStore.getState;
  try {
    router.push(`/editor/${id}` as Href);
    for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
    await sleep(1200);
    // 1) kockák a telefonon (szerver nélkül)
    const t0 = Date.now();
    const frames = (await thumbnailFramesOnDevice(st().project!)) ?? [];
    const sizes = await Promise.all(frames.map(async (f) => (await decode(f.uri)).width()));
    log(frames.length === 4 && sizes.every((w) => w > 100), 'képkockák a telefonon a videóból', `${frames.length} kocka (${frames.map((f) => f.t).join(', ')} s), szélesség ${sizes.join('/')}, ${Date.now() - t0} ms`);
    if (frames.length === 0) throw new Error('nincs kocka');
    // 2) a választott kockából a lap — ugyanaz a köteg, amit az export-panel ad
    const doc = thumbnailDoc({ id: 'th', name: 'Thumbnail', frameUri: frames[1].uri, headline: 'NAGY CÍM', aspect: 16 / 9, aspectRatio: '16:9', layerId: makeId });
    const past0 = st().past.length;
    st().applyBatch([{ type: 'UPSERT_IMAGE_DOC', doc }, { type: 'SET_THUMBNAIL_DOC', docId: 'th' }], 'user');
    log(thumbnailDocOf(st().project!)?.id === 'th' && st().past.length === past0 + 1, 'a thumbnail-lap a videó-projektben, egy visszavonás-lépés', `${st().project!.imageDocs?.length} lap`);
    st().undo();
    log(!st().project!.thumbnailDocId && !st().project!.imageDocs?.some((d) => d.id === 'th'), 'egy visszavonás: a lap és a hivatkozás is eltűnik');
    st().redo();
    // 3) a Kép Stúdió ugyanazon a projekten nyitja a lapot, a cím szerkeszthető
    router.push(`/studio/image/${id}?doc=th` as Href);
    await sleep(2000);
    const live = st().project!.imageDocs!.find((d) => d.id === 'th')!;
    st().dispatch({ type: 'UPSERT_IMAGE_DOC', doc: { ...live, layers: live.layers.map((l) => (l.kind === 'text' ? { ...l, text: 'JAVÍTOTT CÍM', color: '#ffcc00' } : l)) } }, 'user');
    const thumbed = await (async () => {
      for (let i = 0; i < 80; i++) {
        const d = st().project!.imageDocs!.find((x) => x.id === 'th');
        if (d?.thumbUri) return d.thumbUri;
        await sleep(100);
      }
      return null;
    })();
    log(st().project!.id === id && !!thumbed, 'a Kép Stúdió ugyanazt a projektet nyitja; a szerkesztett lapnak élő bélyegképe van (a telefonon)', `${thumbed?.split('/').pop()}`);
    router.back();
    await sleep(1200);
    // 4) az előnézet a lapból, a poszter a lapból (a telefonos színpadon, a videó-szerkesztőben)
    const prev = projectPreviewSource(st().project!);
    log(prev?.type === 'image' && prev.uri === thumbed, 'a projekt-előnézet a thumbnail-lap képe', `${prev?.type}`);
    const thumb = thumbnailDocOf(st().project!)!;
    const fake = { url: 'https://x/v.mp4', posterUrl: 'https://x/p.jpg', posterKey: 'régi' };
    log(null, 'FOTÓZHATÓ-RENDER', 'a poszter-render alatt a rejtett színpad nem látszik');
    const t1 = Date.now();
    let poster: string | null = null;
    while (Date.now() - t1 < 6000) poster = await renderOnDevice(thumb, 720, { format: 'jpg', quality: 0.9 });
    const pimg = poster ? await decode(poster) : null;
    const textPx = pimg ? pixel(pimg, Math.round(pimg.width() / 2), Math.round(pimg.height() * 0.8)) : [];
    log(posterNeedsRefresh(fake, thumb) && !!pimg && pimg.height() === 720 && pimg.width() === 1280, 'a feed-poszter a lapból, a telefonon (a régi poszter elavultként jelölve)', `${pimg?.width()}×${pimg?.height()}, a cím helyén ${textPx.slice(0, 3).join(',')}`);
    // 5) mentés + újratöltés: a lap és a hivatkozás megmarad, az aktuális sémával (v9 óta)
    await saveProject(st().project!);
    const reloaded = await loadProject(id);
    log(reloaded?.thumbnailDocId === 'th' && !!thumbnailDocOf(reloaded) && reloaded.schemaVersion === CURRENT_SCHEMA_VERSION, `mentés után is megvan (séma v${CURRENT_SCHEMA_VERSION})`, `v${reloaded?.schemaVersion}`);
    frames.forEach((f) => removeFile(f.uri));
    if (poster) removeFile(poster);
  } finally {
    if (st().project?.id === id) {
      router.back();
      await sleep(500);
    }
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:thumbdoc-del', caught));
  }
}
export async function smokeLinkedMix(log: Log) {
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
export async function smokeTouchModes(log: Log) {
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
  log(cut && Math.abs(at - 4) < 0.6 && Math.abs(at * 44100 - Math.round(at * 44100)) < 1e-6, 'vágás-mód: egy koppintás a klipen → ott vág, a minta-rácson (V6)', `${clips().length} darab, vágás ${at.toFixed(3)} s`);
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
export async function smokeModelDownload(log: Log) {
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
export async function smokeMixAssist(log: Log) {
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
export async function smokeAudioAssistant(log: Log) {
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
export async function smokeAudioCheck(log: Log) {
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
export async function smokePresetPhoto(log: Log) {
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
export async function smokeUserPresets(log: Log) {
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
export async function smokeInstruments(log: Log) {
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

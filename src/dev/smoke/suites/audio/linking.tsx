/** 🧪 Füstteszt — stúdiók közti kapcsolat: hivatkozott kép/mix, „Hol használom?”, hangparancs videóba. (Áthelyezve: phases08, phases12, phases13; viselkedés-változás nélkül.) */
import { type ReactNode, type RefObject, createRef } from 'react';
import { Platform, Dimensions, PixelRatio, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { applyCommand } from '@/lib/commands';
import { linkedAssets, stillVersion, mixdownVersion, relinkPlan } from '@/lib/linkedAsset';
import { sendStillToVideo, sourceVersionOf, sendMixdownToVideo } from '@/lib/linkedAssetClient';
import { renderProjectVersion } from '@/lib/render';
import { clearCswcrLog, type CswcrStats, logCswcr } from '@/lib/cswcrClient';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { type RenderStageHandle, RenderStage } from '@/components/studio/image/RenderStage';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, Project, ImageClip, AudioClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { decode, pixel, removeFile } from '../../helpers/image';
import { toneWav } from '../../helpers/audio';
import { devTypeAssistant } from '@/components/studio/audio/AudioAssistantBar';
import '@/lib/dspNativeClient';

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
/** 🔍 C6: „Hol használom?" — a hang-projektre hivatkozó videók listája (új és meglévő videóba küldve), a frissíthetők jelölve. */
export async function smokeUsages(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const audioId = 'prj_smoke_usage_audio';
  const created: string[] = [];
  await deleteProject(audioId).catch((caught) => logCaught('lib/imageSmoke.tsx:usages', caught));
  const base = createEmptyProject('smoke használat dal', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: toneWav('smoke_usage.wav', 2), start: 0, duration: 2, trimIn: 0, sourceDuration: 2, volume: 0.5, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const audio: Project = { ...base, id: audioId, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) };
  await saveProject(audio);
  const st = useEditorStore.getState;
  try {
    // 1) egy meglévő videó-projektbe és egy újba küldve (hivatkozással)
    const existing = { ...createEmptyProject('smoke használat A', '9:16', undefined, 'video'), id: 'prj_smoke_usage_va' };
    await saveProject(existing);
    created.push(existing.id);
    const v1 = await sendMixdownToVideo(audio, existing, { newName: '-' });
    const v2 = await sendMixdownToVideo(audio, null, { newName: 'smoke használat B' });
    if (v2) created.push(v2.id);
    log(null, 'diag0', `v1 ${v1?.id}, v2 ${v2?.id}`);
    router.push(`/studio/audio/${audioId}` as Href);
    const t0 = Date.now();
    for (let i = 0; i < 150 && st().project?.id !== audioId; i++) await sleep(200);
    log(null, 'diag1', `${Date.now() - t0} ms, projekt ${st().project?.id}`);
    log(true, 'FOTÓZHATÓ', 'nav');
    await sleep(4000);
    await sleep(1000);
    log(null, 'diag', `stúdió ${String(runDevAction('audio.workspace'))}, projekt ${st().project?.id}, akció ${typeof runDevAction('audio.usages')}`);
    const u1 = (await runDevAction('audio.usages')) as string[] | null;
    log(!!v1 && !!v2 && JSON.stringify(u1) === JSON.stringify(['smoke használat A', 'smoke használat B']), '„Hol használom?": a két hivatkozó videó (a meglévő és az új), név szerint', String(JSON.stringify(u1)));
    // 2) a zene változik → mindkettő frissíthető
    st().dispatch({ type: 'UPDATE_CLIP', clipId: 'c', patch: { volume: 1 } }, 'user');
    const u2 = (await runDevAction('audio.usages')) as string[] | null;
    log(JSON.stringify(u2) === JSON.stringify(['smoke használat A*', 'smoke használat B*']), 'a zene módosítása után mindkét videó „frissíthető"', JSON.stringify(u2));
  } finally {
    router.back();
    await sleep(500);
    for (const id of [audioId, ...created]) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:usages-del', caught));
  }
}
/** 🔗 C7: stúdiók közti hangparancs — „küldd egy új videóba” → a hang-projekt mixdownja HIVATKOZÁSKÉNT egy új
 *  videó-projekt zene-sávjára (C2), a videó-szerkesztő nyílik. */
export async function smokeC7(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_c7';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:c7', caught));
  const base = createEmptyProject('smoke C7 dal', '9:16', undefined, 'audio');
  const c: AudioClip = { kind: 'audio', id: 'm', label: 'zene', uri: toneWav('smoke_c7.wav', 3), start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 0.8, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [c] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  let vidId: string | null = null;
  try {
    runDevAction('audio.assistant');
    for (let i = 0; i < 50 && runDevAction('assistant.text') === undefined; i++) await sleep(100);
    const sentence = 'küldd egy új videóba';
    for (let k = 0; k < 5 && runDevAction('assistant.text') !== sentence; k++) {
      devTypeAssistant(sentence);
      await sleep(300);
    }
    log(true, 'FOTÓZHATÓ', 'az asszisztens: „Videóba hivatkozással: új videó”');
    await sleep(1500);
    runDevAction('assistant.apply');
    for (let i = 0; i < 150 && (st().project?.id === id || (st().project?.kind ?? 'video') !== 'video'); i++) await sleep(200);
    await sleep(800);
    const p = st().project;
    vidId = p && p.id !== id ? p.id : null;
    const clip = p?.tracks.find((t) => t.type === 'music')?.clips[0] as AudioClip | undefined;
    const asset = p?.assets.find((a) => a.id === clip?.assetId);
    log(!!vidId && (p?.kind ?? 'video') === 'video' && asset?.source?.projectId === id && Math.abs((clip?.duration ?? 0) - 3) < 0.05, 'a parancs: új videó-projekt, a zene-sávon a hang-projekt mixdownja hivatkozásként (a videó-szerkesztő nyílt)', `videó ${vidId} · forrás ${asset?.source?.projectId} · ${clip?.duration.toFixed(2)} s`);
  } finally {
    router.back();
    await sleep(500);
    if (vidId) await deleteProject(vidId).catch((caught) => logCaught('lib/imageSmoke.tsx:c7-vid', caught));
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:c7-del', caught));
  }
}

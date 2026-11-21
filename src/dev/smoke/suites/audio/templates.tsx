/** 🧪 Füstteszt — létrehozás sablonból: hang-sablon, zene-munkaterület, podcast-munkafolyamat. (Áthelyezve: phases09, phases11, phases12; viselkedés-változás nélkül.) */
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { deleteProject, saveProject, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { type Log, sleep } from '../../helpers/core';
import '@/lib/dspNativeClient';

/** 🧩 AP7: az „Új projekt” űrlap hang-sablonnal (a valódi létrehozási út): zene és podcast. */
/**
 * 🎨 IMAGE-PROD S8 (DS0): a „+ Új projekt → Design" a VALÓDI létrehozási úton a választott sablonnal
 * (márkára színezve) a Kép Stúdió Design munkaterületén nyílik; a munkaterület váltható, offline.
 */
export async function smokeDesignEntry(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const created: string[] = [];
  const name = 'smoke design thumbnail';
  try {
    router.replace('/studio' as Href);
    await sleep(1500);
    runDevAction('studio.fillCreate', { name, kind: 'design', designTemplate: 'youtubeThumb' });
    await sleep(400);
    const t0 = Date.now();
    await runDevAction('studio.create');
    for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
    await sleep(1500);
    const p = st().project;
    if (p?.name === name) created.push(p.id);
    const doc = p?.imageDocs?.[0];
    const kinds = (doc?.layers ?? []).map((l) => l.kind).join('+');
    log(p?.kind === 'design' && doc?.width === 1280 && doc.height === 720 && (doc.layers.length ?? 0) >= 3, 'a Design-projekt a sablon vásznán és szerkeszthető rétegeivel indul', p ? `${p.kind}, ${doc?.width}×${doc?.height}, rétegek: ${kinds}, ${Date.now() - t0} ms` : 'nincs projekt');
    const ws = (await runDevAction('image.workspace')) as { ws: string; tools: string[] } | undefined;
    log(ws?.ws === 'design' && ws.tools[0] === 'templates' && ws.tools[1] === 'size', 'a Kép Stúdió a Design munkaterületen nyílik: sablon és méret elöl', `${ws?.ws}: ${ws?.tools.join(', ')}`);
    log(true, 'FOTÓZHATÓ', 'a Design munkaterület (sablonból nyílt lap, Design-sín)');
    await sleep(6000);
    const back = (await runDevAction('image.workspace', 'image')) as { ws: string } | undefined;
    await sleep(300);
    const now = (await runDevAction('image.workspace')) as { ws: string; tools: string[] } | undefined;
    log(back !== undefined && now?.ws === 'image' && now.tools[0] === 'photo' && st().project?.id === p?.id, 'a munkaterület váltható (ugyanaz a dokumentum)', `${now?.ws}: ${now?.tools.slice(0, 3).join(', ')}…`);
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke design ')).map((m) => m.id);
    for (const id of new Set([...created, ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:design-del', caught));
      await deleteCloudProject(id);
    }
    const remain = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name.startsWith('smoke design ')).length;
    log(remain === 0, 'takarítás: a teszt-projekt a felhőből is törölve', `maradt ${remain}`);
  }
}
export async function smokeAudioTemplate(log: Log) {
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
export async function smokeMusicWorkspace(log: Log) {
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
/** ▶️ C4: a Podcast-sablon a valódi létrehozási úton elindítja a Podcast-epizód munkafolyamatot; lépések, kihagyás, egy undo, a vége. */
export async function smokeWorkflow(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { currentStep, finishCurrent, isRunComplete, runProgress } = await import('@/lib/workflowTemplate');
  const st = useEditorStore.getState;
  const name = 'smoke munkafolyamat';
  let createdId: string | null = null;
  try {
    router.replace('/studio' as Href);
    await sleep(1500);
    runDevAction('studio.fillCreate', { name, kind: 'audio', audioTemplate: 'podcast' });
    await sleep(400);
    await runDevAction('studio.create');
    for (let i = 0; i < 60 && st().project?.name !== name; i++) await sleep(200);
    await sleep(1200);
    const p = st().project;
    createdId = p?.name === name ? p.id : null;
    const r0 = p?.workflowRun;
    log(!!r0 && r0.templateId === 'podcast-episode' && currentStep(r0)?.id === 'record' && r0.steps.length === 8, 'a Podcast-sablon elindítja a Podcast-epizód munkafolyamatot (8 lépés, a felvétel fut)', r0 ? `${r0.templateId}, ${currentStep(r0)?.id}` : 'nincs futás');
    log(true, 'FOTÓZHATÓ', 'a munkafolyamat-sáv a Hang Stúdió tetején');
    await sleep(2000);
    // kész → szinkron; kihagyás → tisztítás; egy undo → vissza a szinkronra
    const now = () => new Date().toISOString();
    st().dispatch({ type: 'SET_WORKFLOW_RUN', run: finishCurrent(st().project!.workflowRun!, 'done', now()) }, 'user');
    st().dispatch({ type: 'SET_WORKFLOW_RUN', run: finishCurrent(st().project!.workflowRun!, 'skipped', now()) }, 'user');
    const r1 = st().project!.workflowRun!;
    st().undo();
    const r2 = st().project!.workflowRun!;
    log(currentStep(r1)?.id === 'clean' && currentStep(r2)?.id === 'sync' && runProgress(r1).skipped === 1, 'kész / kihagyás a következő lépésre lép (egy parancs); egy visszavonás visszalép', `${currentStep(r1)?.id} → undo → ${currentStep(r2)?.id}`);
    // a végéig; mentés + újratöltés után is megvan
    let r = st().project!.workflowRun!;
    while (currentStep(r)) {
      st().dispatch({ type: 'SET_WORKFLOW_RUN', run: finishCurrent(r, 'done', now()) }, 'user');
      r = st().project!.workflowRun!;
    }
    await saveProject(st().project!);
    const reloaded = await loadProject(st().project!.id);
    log(isRunComplete(r) && !!reloaded?.workflowRun && isRunComplete(reloaded.workflowRun), 'a munkafolyamat végigmegy, és mentés + újratöltés után is megvan', `${runProgress(r).done}/${runProgress(r).total}`);
    st().dispatch({ type: 'SET_WORKFLOW_RUN', run: null }, 'user');
    log(!st().project!.workflowRun, 'a sáv bezárása a futást lezárja', '');
  } finally {
    router.replace('/studio' as Href);
    await sleep(500);
    const { deleteCloudProject, listCloudProjectMetas } = await import('@/lib/cloudSync');
    const leftovers = (await listCloudProjectMetas().catch(() => [])).filter((m) => m.name === name).map((m) => m.id);
    for (const id of new Set([...(createdId ? [createdId] : []), ...leftovers])) {
      await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:wf-del', caught));
      await deleteCloudProject(id);
    }
  }
}

/** 🧪 Füstteszt — élő adás: adó, rögzítés, néző, Live Stúdió. (Áthelyezve: phases03; viselkedés-változás nélkül.) */
import type { ReactNode } from 'react';
import { Platform, Dimensions, View } from 'react-native';
import { startLive, endLive } from '@/lib/live';
import { setRecord } from '@/lib/liveDoc';
import { RecordToggle } from '@/components/live/RecordToggle';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject, deleteProject, listProjects, loadProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import '@/lib/dspNativeClient';

/** Élő adás két eszközön: az egyik ad, a másik néz; a szerver oldali ellenőrzés a Macről fut. */
export async function smokeLiveHost(log: Log) {
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
export async function smokeLiveRecord(log: Log, setHarness: (n: ReactNode) => void) {
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
export async function smokeLiveView(log: Log, id: string) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  router.push(`/live/${id}` as Href);
  await sleep(30000);
  log(true, 'FOTÓZHATÓ', 'néző');
  await sleep(6000);
  router.back();
}
/** A Live Stúdió a valódi képernyőn: panelek, tablet-elrendezés, fogók. */
export async function smokeLiveStudio(log: Log) {
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

/** 🧪 Füstteszt — két-eszközös együttműködés: tulaj/tag, sáv-zár, takarítás. (Áthelyezve: phases07; viselkedés-változás nélkül.) */
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { useAuth } from '@/store/authStore';
import { useCollabLive } from '@/store/collabLiveStore';
import { ensureShared, inviteMember, respondToInvite, pullSharedProject, removeMember } from '@/lib/collab';
import { deleteCloudProject } from '@/lib/cloudSync';
import { canUseCloud } from '@/lib/backend';
import { supabase } from '@/lib/supabase';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject, deleteProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { Project, AudioClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { toneWav } from '../../helpers/audio';
import '@/lib/dspNativeClient';

/** 👤 ki van bejelentkezve ezen az eszközön (a kétkészülékes collab-próbához) */
export async function smokeWhoAmI(log: Log) {
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
export async function smokeCollabOwner(log: Log) {
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
export async function smokeCollabMember(log: Log) {
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
export async function smokeCollabCleanup(log: Log) {
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
/** 🔒 R2 tulaj (iPad): megosztja a hang-projektet, zárolja a zenét, majd felold; ellenőrzi, hogy a tag zene-szerkesztése csak feloldás után jön át. */
export async function smokeLockOwner(log: Log) {
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
export async function smokeLockMember(log: Log) {
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
export async function smokeLockPersist(log: Log) {
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

/** 🧪 Füstteszt — megosztás: hang-poszt remixe, sávos remix, Shop- és hangcsomag. (Áthelyezve: phases05, phases07; viselkedés-változás nélkül.) */
import { File } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { listPostsByIds, remixFromPost } from '@/lib/feed';
import type { FeedPost } from '@/types/social';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { packFromProject } from '@/lib/soundPack';
import { listShopItems, purchaseItem, getPayload, storeSoundPack, syncOwnedSoundPacks } from '@/lib/shop';
import { useSoundPacks } from '@/store/soundPackStore';
import { useAuth } from '@/store/authStore';
import { createEmptyProject } from '@/lib/projectUtils';
import { loadProject, deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { smokeFileHost } from '../../helpers/env';
import { remixRoute } from '@/lib/imageRemix';
import '@/lib/dspNativeClient';

/**
 * 🔀 C3 e2e a VALÓDI feeden (prod — engedéllyel, 2026-11-15): egy teszt-alkotó nem listázott hang-posztja
 * sáv-leírással (a Mac-ről, azonosító a fájlszerveren); az iPad a valódi úton olvassa (RLS, ellenőrző) és
 * remixeli: a fájl az R2-ről letöltve, a remix szerkeszthető sávokkal.
 */
export async function smokeRemixTracksProd(log: Log) {
  const postId = (await (await fetch(`${smokeFileHost()}/c3post.txt`)).text()).trim();
  const [post] = await listPostsByIds([postId]);
  log(!!post && post.sourceKind === 'audio' && !!post.remixTracks, 'a poszt a feedről: hang-poszt, ellenőrzött sáv-leírással', post ? `${post.remixTracks?.tracks.length ?? 0} sáv` : `nincs (${postId.slice(0, 8)})`);
  if (!post) return;
  const id = await remixFromPost(post);
  const p = id ? await loadProject(id) : null;
  const clips = (p?.tracks ?? []).flatMap((t) => t.clips as AudioClip[]);
  const ok = clips.length === 2 && clips.every((c) => c.uri.startsWith('file://') && (new File(c.uri).size ?? 0) > 1000);
  log(!!p && p.bpm === 92 && ok && p.remixOf?.postId === post.id, 'a remix az R2-ről letöltött sávokkal, tempóval, eredettel', `${clips.length} klip, ${p?.bpm} BPM, ${clips.map((c) => new File(c.uri).size).join('/')} bájt`);
  if (id) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:remixtracksprod', caught));
}
/**
 * 🔀 C3: a hang-poszt remixe a sávokkal — a sáv-leírású poszt (a Mac fájlszerverén lévő hangokkal, a prod
 * nélkül) az app `remixFromPost`-ján át: a fájlok letöltve, a sávok és a tempó megvannak, a klipek helyiek.
 */
export async function smokeRemixTracks(log: Log) {
  const host = smokeFileHost();
  const clipOf = (id: string, file: string, start: number): AudioClip => ({ kind: 'audio', id, uri: `${host}/${file}`, label: file, start, duration: 2, trimIn: 0, sourceDuration: 2, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported' });
  const post = {
    id: `smoke_rt_${Date.now().toString(36)}`,
    creator: { id: 'x', username: 'smoke', displayName: 'Smoke' },
    title: 'Sávos poszt',
    description: '',
    hashtags: [],
    videoUri: null,
    posterUri: null,
    aspectRatio: '9:16',
    durationSec: 4,
    rendered: false,
    sourceKind: 'audio',
    remixable: true,
    remixTracks: {
      v: 1,
      bpm: 104,
      tracks: [
        { id: 't1', type: 'voiceover', name: 'Ének', clips: [clipOf('a', 'speech_hu.wav', 0), clipOf('b', 'speech_hu.wav', 2)] },
        { id: 't2', type: 'aux1', name: 'Második hang', clips: [clipOf('c', 'speech_en.wav', 1)] },
      ],
      trackMix: { voiceover: { gain: -2 } },
    },
  } as unknown as FeedPost;
  const id = await remixFromPost(post);
  const p = id ? await loadProject(id) : null;
  const clips = (p?.tracks ?? []).flatMap((t) => t.clips.map((c) => ({ t: t.type, c: c as AudioClip })));
  log(!!p && p.kind === 'audio' && p.bpm === 104 && p.remixOf?.postId === post.id, 'a remix hang-projekt, a poszt tempójával és eredetével', p ? `${p.kind}, ${p.bpm} BPM` : 'nincs projekt');
  log(clips.length === 3 && clips.filter((x) => x.t === 'voiceover').length === 2 && clips.some((x) => x.t === 'aux1'), 'a sávok és a klipek megvannak (2 + 1)', clips.map((x) => `${x.t}:${x.c.start}`).join(', '));
  const localOk = clips.every((x) => x.c.uri.startsWith('file://') && new File(x.c.uri).exists);
  const shared = new Set(clips.filter((x) => x.t === 'voiceover').map((x) => x.c.assetId)).size === 1;
  log(localOk && shared && p?.trackMix?.voiceover?.gain === -2, 'a klipek helyi fájlokra mutatnak (közös fájl → közös asset), a keverés átjött', `${clips.map((x) => (x.c.uri.split('/').pop() ?? '').slice(0, 24)).join(', ')}`);
  if (id) await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:remixtracks', caught));
}
/**
 * 🛍️ V4 e2e a VALÓDI Shopon (prod adatbázis — engedéllyel, 2026-11-15): a „SMOKE V4 hangcsomag” ingyenes
 * tételt egy teszt-eladó teszi ki (a Mac-ről); a bejelentkezett felhasználó az app kódján át megveszi
 * (RPC), a tartalom RLS-sel olvasható, a csomag a tárba kerül, „új eszközön” a fiókból visszajön, és a
 * loopja a stúdióban szól. Ingyenes tétel → nincs Coin-mozgás.
 */
export async function smokeShopPack(log: Log) {
  const me = useAuth.getState().user;
  log(!!me, 'bejelentkezett vevő', me ? `${me.email?.slice(0, 2)}…` : 'nincs bejelentkezve');
  if (!me) return;
  const item = (await listShopItems({ kind: 'soundpack' })).find((i) => i.title === 'SMOKE V4 hangcsomag');
  log(!!item && item.sellerId !== me.id && item.priceCents === 0, 'a teszt-hangcsomag a piacon (más eladótól, ingyen)', item ? `${item.id.slice(0, 8)}, ${item.priceCents} cent` : 'nincs');
  if (!item) return;
  let payload: unknown = null;
  try {
    payload = await purchaseItem(item.id);
  } catch (e) {
    // a korábbi futás már megvette (egyedi vásárlás) → a tartalom a payload-táblából
    log(null, 'vásárlás', e instanceof Error ? e.message : String(e));
    payload = await getPayload(item.id);
  }
  log(storeSoundPack(item.id, payload), 'a megvett tartalom ellenőrizve, a csomag a telefonon', `${(payload as { loops?: unknown[] } | null)?.loops?.length ?? 0} loop`);
  log((await getPayload(item.id)) !== null, 'a tartalom a vevőnek olvasható (RLS)');
  // „új eszköz”: a helyi tárból törölve, a fiókból visszajön
  useSoundPacks.getState().removePack(item.id);
  const added = await syncOwnedSoundPacks();
  log(added >= 1 && useSoundPacks.getState().packs.some((p) => p.itemId === item.id), 'új eszközön a fiókból visszaszinkronizálva', `${added} csomag`);
  const st = useEditorStore.getState;
  const id = `prj_smoke_shoppack_${Date.now().toString(36)}`;
  await saveProject({ ...createEmptyProject('smoke shop-csomag', '9:16', undefined, 'audio'), id });
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const c = await runDevAction('loops.place', `pack_${item.id}_pk0`);
    const placed = st().project?.tracks.flatMap((tr) => tr.clips).find((x): x is AudioClip => x.id === c && x.kind === 'audio');
    const doc = placed ? st().project?.instrumentDocs?.find((d) => d.id === placed.instrumentDocId) : undefined;
    log(placed?.label === 'Smoke dob' && doc?.kind === 'drums' && doc.drums?.pattern.kick.filter(Boolean).length === 12, 'a megvett loop a stúdióban: dob-minta 4 ütemre (3 lábdob × 4)', `${placed?.label}, ${doc?.drums?.pattern.kick.filter(Boolean).length} lábdob`);
    router.back();
    await sleep(500);
  } finally {
    useSoundPacks.getState().removePack(item.id);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:shoppack', caught));
  }
}
/**
 * 🛍️ V4: hangcsomag — beépített loopokból hangszer-mintás projekt → csomag → (JSON, a vevői ellenőrzőn át) a
 * telefonos tárba → a loop-könyvtárból visszahelyezve ugyanaz a minta, a csomag-loop nevével; offline,
 * a Shop (prod adatbázis) nélkül.
 */
export async function smokeSoundPack(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const st = useEditorStore.getState;
  const id = `prj_smoke_pack_${Date.now().toString(36)}`;
  const itemId = `smoke_${Date.now().toString(36)}`;
  await saveProject({ ...createEmptyProject('smoke csomag', '9:16', undefined, 'audio'), id });
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const a = await runDevAction('loops.place', 'house');
    st().setPlayhead(10);
    const b = await runDevAction('loops.place', 'bassWalk');
    const src = st().project!;
    log(typeof a === 'string' && typeof b === 'string' && (src.instrumentDocs?.length ?? 0) >= 2, 'a forrás-projektben két hangszer-minta (dob + basszus)', `${a}, ${b}, ${src.instrumentDocs?.length} minta`);
    const pack = packFromProject(src, 'Smoke csomag');
    log(pack?.loops.length === 2 && pack.loops[0].category === 'drums' && pack.loops[1].category === 'bass', 'a projektből csomag: dob + basszus loop', pack?.loops.map((l) => `${l.name}/${l.category}`).join(', '));
    // a vevő oldala: a payload JSON-ként jön, az ellenőrzőn át kerül a tárba
    const stored = storeSoundPack(itemId, JSON.parse(JSON.stringify(pack)));
    log(stored && useSoundPacks.getState().packs.some((p) => p.itemId === itemId), 'a megvett csomag a telefonos tárban');
    const drumId = `pack_${itemId}_pk0`;
    st().setPlayhead(20);
    const c = await runDevAction('loops.place', drumId);
    const p2 = st().project!;
    const placed = p2.tracks.flatMap((tr) => tr.clips).find((x): x is AudioClip => x.id === c && x.kind === 'audio');
    const doc = placed ? p2.instrumentDocs?.find((d) => d.id === placed.instrumentDocId) : undefined;
    const orig = src.instrumentDocs?.find((d) => d.kind === 'drums');
    const same = !!doc?.drums && !!orig?.drums && JSON.stringify(doc.drums.pattern) === JSON.stringify(orig.drums.pattern);
    log(!!placed && placed.label === pack?.loops[0].name && same, 'a csomag-loop visszahelyezve: a minta azonos, a felirat a csomagé', `${placed?.label}, minta ${same ? 'azonos' : 'ELTÉR'}`);
    router.back();
    await sleep(500);
  } finally {
    useSoundPacks.getState().removePack(itemId);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:soundpack', caught));
  }
}
/** 🎵 R6 hang-poszt remixe: a poszt videójának hangja kinyerve → hang-projekt (a Hang Stúdióban nyílik), a forrás megjelölve. Prod nélkül: szintetikus poszt a teszt-szerver videójával. */
export async function smokeAudioRemix(log: Log) {
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

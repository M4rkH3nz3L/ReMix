import { t as tr } from 'i18next';

import { MIN_CLIP_DURATION } from '@/constants/editor';
import { ensureClipAssets } from '@/lib/assetResolve';
import { makeId } from '@/lib/id';
import { splitKeyframes } from '@/lib/keyframes';
import { masterPreset } from '@/lib/audioMaster';
import { createImageDoc, type ImageDocBackground } from '@/lib/imageDoc';
import { createLiveDoc } from '@/lib/liveDoc';
import { projectKindMeta } from '@/lib/projectKinds';
import type {
  AdjustClip,
  AspectRatio,
  Asset,
  AudioMasterTarget,
  Clip,
  ImageClip,
  Project,
  ProjectKind,
  ProjectSeo,
  Track,
  TrackType,
  VideoClip,
} from '@/types/project';

/**
 * 🎛️ Fajta-specifikus létrehozási beállítások (az „Új projekt” űrlapból):
 * kép → vászonméret + háttér; hang → master-cél (az alap hangosság/plafon preset).
 */
export interface CreateProjectConfig {
  image?: {
    width?: number;
    height?: number;
    background?: ImageDocBackground;
    format?: 'raster' | 'vector';
  };
  audioMasterTarget?: AudioMasterTarget;
}

/** A projekt fajtája, alapértelmezéssel (a régi, kind nélküli projektek videók). */
export function projectKind(project: { kind?: ProjectKind }): ProjectKind {
  return project.kind ?? 'video';
}

/**
 * A projekt-fajtához tartozó szerkesztő-útvonal — a főképernyő ebből routol a
 * megfelelő stúdióba (a videó a teljes `/editor`, a kép/hang a saját stúdiója).
 */
export function studioRoute(kind: ProjectKind | undefined, id: string): string {
  const meta = projectKindMeta(kind);
  // a KÉSZ stúdiók a saját útvonalukra; a stúdió-nélküli (CreativeDocument-
  // bővítés) fajták a videó-editorra esnek vissza, amíg a stúdiójuk el nem készül
  return meta.editable ? meta.route(id) : `/editor/${id}`;
}

const CANONICAL_TRACKS: { type: TrackType; name: string }[] = [
  { type: 'video', name: 'lib.projectUtils.trackVideo' },
  { type: 'pip', name: 'PiP' },
  { type: 'adjust', name: 'Grade' },
  { type: 'text', name: 'lib.projectUtils.trackText' },
  { type: 'captions', name: 'lib.projectUtils.trackCaptions' },
  { type: 'overlay', name: 'lib.projectUtils.trackOverlay' },
  { type: 'interactive', name: 'lib.projectUtils.trackInteractive' },
  { type: 'music', name: 'lib.projectUtils.trackMusic' },
  { type: 'voiceover', name: 'Voiceover' },
  { type: 'sfx', name: 'SFX' },
];

export function createEmptyProject(
  name: string,
  aspectRatio: AspectRatio,
  seo?: ProjectSeo,
  kind: ProjectKind = 'video',
  config?: CreateProjectConfig
): Project {
  const now = new Date().toISOString();
  return {
    id: makeId('prj'),
    name,
    kind,
    aspectRatio,
    fps: 30,
    // a SEO-meta a létrehozáskor kötelező (Új projekt űrlap); demo/import útján
    // hiányozhat — ezért opcionális a mezőn, és csak akkor kerül be, ha van
    ...(seo ? { seo } : {}),
    // MINDEN fajta megkapja a kanonikus sávokat: a kép/hang kimenete a
    // videó-editorban is használható, és így a közös `trackOf`/lib-függvények
    // sosem dobnak hiányzó-sáv kivételt (a stúdiók a szerkesztő-UI-t szűkítik).
    tracks: CANONICAL_TRACKS.map((t) => ({
      id: makeId('trk'),
      type: t.type,
      name: tr(t.name),
      clips: [],
    })),
    assets: [],
    // 🎨 a képstúdió a réteg-fát szerkeszti → egy üres kép-dokumentum előre,
    // hogy a stúdiónak legyen mivel indulnia (a kirasterizált PNG lesz a média).
    // A vászonméret + háttér a létrehozó-űrlapból (config.image).
    ...(kind === 'image'
      ? { imageDocs: [createImageDoc(name, aspectRatio, () => makeId('lyr'), config?.image)] }
      : {}),
    // 🎚️ a hang-projekt alap master-célja (az első beállítás): a loudness/plafon
    // preset a cél szerint (podcast/zene/social/videó) — a MasterSheet később módosítja.
    ...(kind === 'audio' && config?.audioMasterTarget
      ? { audioMaster: masterPreset(config.audioMasterTarget) }
      : {}),
    // 🎥 a live-stúdió a scene/forrás-grafet szerkeszti → egy kiinduló live-doc
    // (Main jelenet + kamera + ReMix-cél); a Live-hub a „Go live"-nál ezt hozza.
    ...(kind === 'live' ? { live: createLiveDoc(name, () => makeId('live')) } : {}),
    createdAt: now,
    updatedAt: now,
    schemaVersion: 6,
  };
}

/** közös: trimmelt, üres- és duplikátum-mentes tokenlista (kis/nagybetű-érzéketlen). */
function dedupeTokens(parts: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

/** „#viral, fun  travel" → ['viral','fun','travel'] — `#` nélkül, szó/vessző mentén. */
export function parseHashtags(input: string): string[] {
  return dedupeTokens(input.replace(/#/g, ' ').split(/[\s,]+/));
}

/** „főzés, gyors recept" → ['főzés','gyors recept'] — vesszős lista (szóköz megengedett). */
export function parseKeywords(input: string): string[] {
  return dedupeTokens(input.split(','));
}

/**
 * Minden kanonikus sáv MEGLÉTÉNEK biztosítása — a hiányzókat üresen pótolja (a
 * meglévő sávok és klipjeik érintetlenek). Így egy régi mentett projekt, amiben
 * még nincs `pip`/`adjust` sáv, nem dönti le a szerkesztőt (`trackOf` kivétel).
 */
function ensureCanonicalTracks(project: Project): Project {
  const have = new Set(project.tracks.map((t) => t.type));
  const missing = CANONICAL_TRACKS.filter((t) => !have.has(t.type)).map((t) => ({
    id: makeId('trk'),
    type: t.type,
    name: tr(t.name),
    clips: [] as Clip[],
  }));
  return { ...project, tracks: [...project.tracks, ...missing], schemaVersion: 5 };
}

export function findAssetByUri(project: Project, uri: string): Asset | null {
  return project.assets.find((a) => a.uri === uri) ?? null;
}

/**
 * A projekt média-asseteinek ISMERT bájt-összege (uri szerint deduplikálva). Csak a
 * betöltött `asset.size`-okat összegzi (ezt a szerver-backup tölti fel a mért
 * bájttal) — kliens-oldali BECSLÉS. A hiteles, pontos per-projekt tárhely (amit a MI
 * tárolónkon foglal) a `projectStorageBytes(projectId)` a `@/lib/storageQuota`-ból.
 */
export function projectMediaBytes(project: Project): number {
  const seen = new Set<string>();
  let total = 0;
  for (const a of project.assets) {
    if (seen.has(a.uri)) {
      continue;
    }
    seen.add(a.uri);
    total += a.size ?? 0;
  }
  return total;
}

/** Séma-migráció betöltéskor — idempotens, lépcsőzetes. */
export function migrateProject(project: Project): Project {
  let next = project;
  if (next.schemaVersion < 2 || !Array.isArray(next.assets)) {
    next = migrateToV2(next);
  }
  if (next.schemaVersion < 3) {
    next = migrateToV3(next);
  }
  if (next.schemaVersion < 4) {
    // v3 → v4: a kulcskocka-mezők opcionálisak, csak a verzió lép
    next = { ...next, schemaVersion: 4 };
  }
  if (next.schemaVersion < 5) {
    // v4 → v5: a később bevezetett sávok (pip, adjust) pótlása a régi projektekben
    next = ensureCanonicalTracks(next);
  }
  if (next.schemaVersion < 6) {
    // v5 → v6: projekt-fajta (kind) — a régi, kind nélküli projektek videók
    next = { ...next, kind: next.kind ?? 'video', schemaVersion: 6 };
  }
  // 🔗 verzió-független backfill (ADR-012): a séma-migráció utáni úton (preset/AI/
  // hang-leválasztás) assetId NÉLKÜL hozzáadott media-klipek is kapjanak asset-linket.
  // Determinisztikus id (assetIdForUri) → idempotens + round-trip- és collab-stabil.
  next = ensureClipAssets(next);
  return next;
}

/** v1 → v2: asset-registry a médiaklipek uri-jaiból, a klipek assetId-t kapnak. */
function migrateToV2(project: Project): Project {
  const assets: Asset[] = [];
  const byUri = new Map<string, Asset>();

  const assetFor = (clip: Clip): Asset | null => {
    if (clip.kind !== 'video' && clip.kind !== 'image' && clip.kind !== 'audio') {
      return null;
    }
    const existing = byUri.get(clip.uri);
    if (existing) {
      return existing;
    }
    const asset: Asset = {
      id: makeId('ast'),
      kind: clip.kind,
      uri: clip.uri,
      provider: 'local',
      name: 'label' in clip ? clip.label : undefined,
      duration: clip.kind === 'video' ? clip.sourceDuration : undefined,
    };
    byUri.set(clip.uri, asset);
    assets.push(asset);
    return asset;
  };

  const tracks = project.tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const asset = assetFor(clip);
      return asset ? ({ ...clip, assetId: asset.id } as Clip) : clip;
    }),
  }));

  return { ...project, tracks, assets, schemaVersion: 2 };
}

/**
 * v2 → v3: sáv-bővítés. A régi egyetlen hang-sáv klipjei forrás szerint a
 * Zene / Voiceover sávra kerülnek; létrejön a Felirat, Matrica és SFX sáv.
 */
function migrateToV3(project: Project): Project {
  const oldTracks = project.tracks as { type: string; clips: Clip[]; id: string; name: string }[];
  const byType = new Map(oldTracks.map((t) => [t.type, t]));
  const legacyAudio = byType.get('audio')?.clips ?? [];

  const clipsFor = (type: TrackType): Clip[] => {
    switch (type) {
      case 'music':
        return legacyAudio.filter((c) => c.kind === 'audio' && c.source !== 'voiceover');
      case 'voiceover':
        return legacyAudio.filter((c) => c.kind === 'audio' && c.source === 'voiceover');
      default:
        return byType.get(type)?.clips ?? [];
    }
  };

  return {
    ...project,
    tracks: CANONICAL_TRACKS.map((t) => ({
      id: byType.get(t.type)?.id ?? makeId('trk'),
      type: t.type,
      name: tr(t.name),
      clips: clipsFor(t.type),
    })),
    schemaVersion: 3,
  };
}

/**
 * 🎚️ Melyik klip-fajtát fogadhat egy sáv — a MOVE_CLIP (sávok közti mozgatás)
 * kompatibilitás-guardja. A kanonikus modell: a kép-sávok (video/pip) videót és
 * képet; a hang-sávok (music/voiceover/sfx) hangot; a szöveg/felirat szöveget;
 * az overlay a matricát (shape/kép); a többi a saját fajtáját. Pure → tesztelhető.
 */
const TRACK_HOSTS: Record<TrackType, Clip['kind'][]> = {
  video: ['video', 'image'],
  pip: ['video', 'image'],
  adjust: ['adjust'],
  text: ['text'],
  captions: ['text'],
  overlay: ['shape', 'image'],
  interactive: ['interactive'],
  music: ['audio'],
  voiceover: ['audio'],
  sfx: ['audio'],
};

export function canHostClip(trackType: TrackType, kind: Clip['kind']): boolean {
  return TRACK_HOSTS[trackType]?.includes(kind) ?? false;
}

/**
 * Egy klip-fajtát fogadó sávok a KANONIKUS sorrendben (a „sávváltás" + a sávok-
 * közti mozgatás ehhez igazodik). Pl. videó → [video, pip]; hang → [music,
 * voiceover, sfx]; szöveg → [text, captions].
 */
export function compatibleTracksFor(kind: Clip['kind']): TrackType[] {
  return CANONICAL_TRACKS.map((t) => t.type).filter((type) => canHostClip(type, kind));
}

export function trackOf(project: Project, type: TrackType): Track {
  const found = project.tracks.find((t) => t.type === type);
  if (!found) {
    throw new Error(`Hiányzó sáv: ${type}`);
  }
  return found;
}

export function findClip(
  project: Project,
  clipId: string
): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) {
      return { track, clip };
    }
  }
  return null;
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}

export function trackEnd(track: Track): number {
  return track.clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/**
 * A projekt teljes hossza (a leghosszabb sáv vége).
 *
 * ⚡ MEMOIZÁLVA a projekt-objektum IDENTITÁSÁRA. Ez a függvény a legforróbb
 * útvonalon fut: a `TransportBar` zustand-selectorában (tehát MINDEN store-
 * `set`-nél), a rAF-óra minden tickjében, a `setPlayhead` clampjében és a
 * `Timeline` minden renderjében — lejátszás közben ez percenként több ezer
 * teljes klip-bejárást jelentene.
 *
 * A cache azért helyes, mert a szerkesztés KIZÁRÓLAG a command buson megy
 * (`applyCommand`), ami spread-alapú, immutábilis: bármilyen változás ÚJ
 * projekt-objektumot ad, tehát új cache-bejegyzést. Helyben mutáló írás
 * elavult értéket adna — ilyen a kódbázisban nincs (az audit 0 megkerülést
 * talált), és a `WeakMap` miatt a régi projektek szabadon felszabadulnak.
 */
const durationCache = new WeakMap<Project, number>();

export function projectDuration(project: Project): number {
  const hit = durationCache.get(project);
  if (hit !== undefined) {
    return hit;
  }
  const value = project.tracks.reduce((max, t) => Math.max(max, trackEnd(t)), 0);
  durationCache.set(project, value);
  return value;
}

/**
 * Üres-e a projekt (egyetlen klip sincs egyetlen sávon sem).
 * A szerkesztő ebből dönti el, hogy a fekete vászon helyett onboardingot
 * mutasson, ami a forrás-binhez vezet (EDITOR-UX §2.5).
 */
export function isProjectEmpty(project: Project): boolean {
  return project.tracks.every((t) => t.clips.length === 0);
}

/** A t időpontban aktív klipek egy sávon (start ≤ t < vég). */
export function clipsAt<T extends Clip>(track: Track, t: number): T[] {
  return track.clips.filter((c) => c.start <= t && t < clipEnd(c)) as T[];
}

/** Az előnézetben megjelenő videó/kép klip: az átfedők közül a legkésőbb kezdődő. */
export function activeVisualClip(project: Project, t: number): Clip | null {
  const track = trackOf(project, 'video');
  const active = clipsAt(track, t);
  if (active.length === 0) {
    return null;
  }
  return active.reduce((a, b) => (b.start >= a.start ? b : a));
}

/**
 * A playheadnél SOON-következő vizuális klip (gapless-előnézethez, EDITOR-UX §2.6):
 * a videó-sávon a legközelebbi, `t` UTÁN kezdődő video/kép klip, ha a `lookaheadSec`
 * ablakba esik. A preview egy második, előre-bufferelt playerrel így a klip-határon
 * kattanás nélkül válthat (a tényleges double-buffer a preview-rétegben, eszközön).
 * `null`, ha nincs ilyen, vagy még túl messze van (akkor ne foglaljunk playert).
 */
export function upcomingVisualClip(
  project: Project,
  t: number,
  lookaheadSec = 1
): VideoClip | ImageClip | null {
  const track = trackOf(project, 'video');
  let best: VideoClip | ImageClip | null = null;
  for (const c of track.clips) {
    if (c.kind !== 'video' && c.kind !== 'image') {
      continue;
    }
    if (c.start <= t || c.start > t + lookaheadSec) {
      continue; // már (majdnem) aktív, vagy még túl messze
    }
    if (!best || c.start < best.start) {
      best = c;
    }
  }
  return best;
}

/** A t-nél épp folyó átmenet (kimenő A klip utolsó `d` mp-ében) — az előnézethez. */
export interface ActiveTransition {
  from: VideoClip | ImageClip;
  to: VideoClip | ImageClip;
  type: NonNullable<VideoClip['transitionOut']>['type'];
  /** 0 → 1 az átmenet-ablakban */
  progress: number;
}

/**
 * A lejátszófejnél épp folyó klip-átmenet: ha egy vizuális klip `transitionOut`-ja
 * a saját utolsó `d` mp-ébe esik és van rákövetkező klip, visszaadja a kimenő (A)
 * és a bejövő (B) klipet + a 0–1 haladást. A fő preview ezt kereszttűnéssel /
 * csúszással közelíti; a pontos xfade a renderben ég be.
 */
export function activeTransition(project: Project, t: number): ActiveTransition | null {
  const track = project.tracks.find((tr) => tr.type === 'video');
  if (!track) {
    return null;
  }
  const clips = (track.clips as Clip[])
    .filter((c): c is VideoClip | ImageClip => c.kind === 'video' || c.kind === 'image')
    .sort((a, b) => a.start - b.start);
  for (let i = 0; i < clips.length - 1; i++) {
    const from = clips[i];
    const tr = from.transitionOut;
    if (!tr) {
      continue;
    }
    const end = from.start + from.duration;
    const d = Math.max(0.1, Math.min(tr.duration, from.duration));
    if (t >= end - d && t < end) {
      return {
        from,
        to: clips[i + 1],
        type: tr.type,
        progress: Math.max(0, Math.min(1, (t - (end - d)) / d)),
      };
    }
  }
  return null;
}

/** A lejátszófejnél aktív PiP-klip (a legutóbb kezdődő) — az előnézeti 2. réteghez. */
export function activePipClip(project: Project, t: number): VideoClip | ImageClip | null {
  const active = activePipClips(project, t);
  return active.length > 0 ? active[active.length - 1] : null;
}

/**
 * A t időpontban aktív ÖSSZES PiP-klip, idősorrendben (a később kezdődő rendereli
 * felül — a render-overlay sorrendjével egyezően). Több egyidejű PiP-hez.
 */
export function activePipClips(project: Project, t: number): (VideoClip | ImageClip)[] {
  // védett: a régi (migráció nélküli) projektekben hiányozhat a pip-sáv
  const track = project.tracks.find((tr) => tr.type === 'pip');
  if (!track) {
    return [];
  }
  return clipsAt(track, t)
    .filter((c): c is VideoClip | ImageClip => c.kind === 'video' || c.kind === 'image')
    .sort((a, b) => a.start - b.start);
}

/**
 * A t időpontban aktív grade-rétegek (adjust-klipek) — az előnézeti tint-
 * közelítéshez és a render enable-ablakaihoz. Idősorrendben.
 */
export function activeAdjustClips(project: Project, t: number): AdjustClip[] {
  const track = project.tracks.find((tr) => tr.type === 'adjust');
  if (!track) {
    return [];
  }
  return clipsAt<AdjustClip>(track, t).sort((a, b) => a.start - b.start);
}

/**
 * Idővonal-idő → forrásfájl-idő egy videóklipen belül.
 * ⏪ `reversed`: a trimmelt forrás-szakasz visszafelé (a végéről az elejére).
 */
export function sourceTimeAt(clip: VideoClip, t: number): number {
  const local = t - clip.start;
  if (clip.reversed) {
    // t=start → az UTOLSÓ használt kocka (trimIn + hossz*speed); t=end → trimIn
    return clip.trimIn + (clip.duration - local) * clip.speed;
  }
  return clip.trimIn + local * clip.speed;
}

/** Klip kettévágása a t időpontban; null, ha t nem esik szigorúan a klip belsejébe. */
export function splitClip(clip: Clip, t: number): [Clip, Clip] | null {
  const offset = t - clip.start;
  if (offset < MIN_CLIP_DURATION || clip.duration - offset < MIN_CLIP_DURATION) {
    return null;
  }
  const first: Clip = { ...clip, duration: offset };
  const second: Clip = {
    ...clip,
    id: makeId('clip'),
    start: t,
    duration: clip.duration - offset,
  };
  if (clip.kind === 'video' && second.kind === 'video') {
    second.trimIn = clip.trimIn + offset * clip.speed;
  }
  if (
    (clip.kind === 'video' || clip.kind === 'image') &&
    (first.kind === 'video' || first.kind === 'image') &&
    (second.kind === 'video' || second.kind === 'image')
  ) {
    const [before, after] = splitKeyframes(clip.keyframes, offset);
    first.keyframes = before;
    second.keyframes = after;
  }
  return [first, second];
}

/** A videóklip jobb széle meddig húzható a forrásanyag alapján (mp, idővonal-időben). */
export function maxVideoDuration(clip: VideoClip): number {
  return (clip.sourceDuration - clip.trimIn) / clip.speed;
}

/**
 * Egy régi uri minden előfordulásának cseréje (klipek + kép-kitöltésű formák
 * imageUri-ja + asset-registry) — a logó/kivágás/vízjel rétegek is relinkelnek.
 */
export function relinkUri(project: Project, oldUri: string, newUri: string): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => {
        let next = clip;
        if ('uri' in next && next.uri === oldUri) {
          next = { ...next, uri: newUri };
        }
        if (next.kind === 'shape' && next.imageUri === oldUri) {
          next = { ...next, imageUri: newUri };
        }
        return next;
      }),
    })),
    assets: project.assets.map((asset) =>
      asset.uri === oldUri ? { ...asset, uri: newUri } : asset
    ),
  };
}

export function replaceClip(project: Project, next: Clip): Project {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => (c.id === next.id ? next : c)),
    })),
  };
}

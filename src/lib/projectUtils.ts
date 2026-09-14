import { t as tr } from 'i18next';

import { MIN_CLIP_DURATION } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { splitKeyframes } from '@/lib/keyframes';
import type {
  AdjustClip,
  AspectRatio,
  Asset,
  Clip,
  ImageClip,
  Project,
  ProjectSeo,
  Track,
  TrackType,
  VideoClip,
} from '@/types/project';

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
  seo?: ProjectSeo
): Project {
  const now = new Date().toISOString();
  return {
    id: makeId('prj'),
    name,
    aspectRatio,
    fps: 30,
    // a SEO-meta a létrehozáskor kötelező (Új projekt űrlap); demo/import útján
    // hiányozhat — ezért opcionális a mezőn, és csak akkor kerül be, ha van
    ...(seo ? { seo } : {}),
    tracks: CANONICAL_TRACKS.map((t) => ({
      id: makeId('trk'),
      type: t.type,
      name: tr(t.name),
      clips: [],
    })),
    assets: [],
    createdAt: now,
    updatedAt: now,
    schemaVersion: 5,
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

export function projectDuration(project: Project): number {
  return project.tracks.reduce((max, t) => Math.max(max, trackEnd(t)), 0);
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

/** Idővonal-idő → forrásfájl-idő egy videóklipen belül. */
export function sourceTimeAt(clip: VideoClip, t: number): number {
  return clip.trimIn + (t - clip.start) * clip.speed;
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

import { SECTION_KINDS } from '@/lib/audioMarkers';
import { nextExtraTrack } from '@/lib/audioTracks';
import { beatSplitTimesT, type SnapMode } from '@/lib/audioTransport';
import { duplicateAfter } from '@/lib/clipDuplicate';
import type { EditorCommand } from '@/lib/commands';
import type { MusicTiming } from '@/lib/musicTime';
import type { Asset, AudioClip, Marker, Project, TrackType } from '@/types/project';

/**
 * 🎧 A hang-stúdió törzsének (AudioStudioBody) tiszta számításai — React és expo nélkül, hogy
 * önmagukban tesztelhetők legyenek. A parancsokat csak ÖSSZEÁLLÍTJÁK; a végrehajtás a hívónál a
 * command buson (`dispatch` / `applyBatch`) megy.
 */

type TracksOf = { tracks: { type: TrackType; clips: { id: string }[] }[] };

/** a hozzáadható aux-sávok sorrendje (a hangszer-minták és a harmónia helye) */
const AUX_LANES: TrackType[] = ['aux1', 'aux2', 'aux3', 'aux4', 'aux5'];

/** a klipet tartalmazó sáv típusa */
export function trackTypeOfClip(project: TracksOf | null | undefined, clipId: string | null | undefined): TrackType | undefined {
  return project?.tracks.find((tr) => tr.clips.some((c) => c.id === clipId))?.type;
}

/** 📋 a beillesztés cél-sávja a store-állapotból (a kijelölt klip sávja, különben a `fallback`) */
export function pasteTargetOf(
  s: { selectedClipId: string | null; project: TracksOf | null },
  fallback: TrackType = 'music'
): TrackType {
  const id = s.selectedClipId;
  return (id && trackTypeOfClip(s.project, id)) || fallback;
}

/** 📑 duplikálás: a kijelölés másolata közvetlenül utána, sávonként (a vágólapot nem írja felül) */
export function duplicateCommands(project: Pick<Project, 'tracks'> | null | undefined, ids: string[], grid: number, newId: () => string): EditorCommand[] {
  const cmds: EditorCommand[] = [];
  for (const tr of project?.tracks ?? []) {
    const picked = tr.clips.filter((c) => ids.includes(c.id));
    if (picked.length > 0) {
      cmds.push({ type: 'ADD_CLIPS', trackType: tr.type, clips: duplicateAfter(picked, grid, newId) });
    }
  }
  return cmds;
}

/** ✂️🥁 a klip szétvágása az ütemrácson — hátulról előre, mert a bal darab tartja meg az azonosítót */
export function beatSplitCommands(clip: { id: string; start: number; duration: number }, timing: MusicTiming, every: 'bar' | 'beat'): EditorCommand[] {
  return beatSplitTimesT(clip, timing, every)
    .reverse()
    .map((time): EditorCommand => ({ type: 'SPLIT_CLIP', clipId: clip.id, time }));
}

/** 🧲 a snap-mód gombja: ki → képkocka → ütem → ki */
export function nextSnapMode(mode: SnapMode): SnapMode {
  return mode === 'off' ? 'frame' : mode === 'frame' ? 'beat' : 'off';
}

/** ⏱️ az előszámlálás léptetése: ki → 1 → 2 ütem → ki */
export function nextCountInBars(bars: number): 0 | 1 | 2 {
  return ((bars + 1) % 3) as 0 | 1 | 2;
}

/** ⏱️ a metronóm-hangerő következő szintje (ismeretlen értékről az elsőre) */
export function nextMetronomeLevel(levels: readonly number[], gain: number): number {
  const i = levels.findIndex((g) => Math.abs(g - gain) < 1e-6);
  return levels[(i + 1) % levels.length];
}

/** 🔖 új marker a megadott időben — a szín a szakasz-fajták közt körbe jár */
export function newMarker(markers: Marker[], id: string, time: number, label: string): Marker {
  return { id, time, label, color: SECTION_KINDS[markers.length % SECTION_KINDS.length].color };
}

/** 🎵 importált (fájlból sütött / letöltött) hang-klip az alapértékekkel */
export function importedAudioClip(p: { id: string; start: number; duration: number; uri: string; label: string; volume?: number }): AudioClip {
  return {
    kind: 'audio',
    id: p.id,
    start: p.start,
    duration: p.duration,
    trimIn: 0,
    sourceDuration: p.duration,
    uri: p.uri,
    label: p.label,
    volume: p.volume ?? 1,
    fadeIn: 0,
    fadeOut: 0,
    source: 'imported',
  };
}

/** a projekt hang-klipje azonosító szerint */
export function findAudioClip(project: Pick<Project, 'tracks'> | null | undefined, clipId: string): AudioClip | undefined {
  return project?.tracks.flatMap((tr) => tr.clips).find((c): c is AudioClip => c.id === clipId && c.kind === 'audio');
}

/** az első hang-klip, amelynek van forrás-fájlja (a tempó-felismerés tartaléka) */
export function firstAudioClipWithUri(project: Pick<Project, 'tracks'>): AudioClip | undefined {
  return project.tracks
    .flatMap((tr) => tr.clips)
    .find((c): c is AudioClip => c.kind === 'audio' && typeof (c as AudioClip).uri === 'string');
}

/** a projekt összes klip-azonosítója (a művelet után az újak kiszűréséhez) */
export function clipIdSet(project: TracksOf | null | undefined): Set<string> {
  return new Set(project?.tracks.flatMap((tr) => tr.clips.map((c) => c.id)) ?? []);
}

/** a `before` halmazban még nem szereplő klipek azonosítói */
export function addedClipIds(project: TracksOf | null | undefined, before: Set<string>): string[] {
  return project?.tracks.flatMap((tr) => tr.clips).filter((c) => !before.has(c.id)).map((c) => c.id) ?? [];
}

/**
 * az első zene-/aux-sáv, ahol a `[start, start+dur)` tartományban nincs klip; ha nincs ilyen, a következő még nem
 * létező aux sáv (a köteg hozza létre, `newTrackName` néven) — a hangszer-minták (dallam, AI-dob) helye
 */
export function freeLaneAt(
  cur: Pick<Project, 'tracks'> | null | undefined,
  start: number,
  dur: number,
  newTrackName: string
): { start: number; trackType: TrackType; newTrackName?: string } {
  const free = (type: TrackType) => !(cur?.tracks.find((tr) => tr.type === type)?.clips ?? []).some((c) => c.start < start + dur && c.start + c.duration > start);
  const lanes = ['music', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5'] as const;
  const exists = (type: TrackType) => !!cur?.tracks.some((tr) => tr.type === type);
  const existing = lanes.find((l) => exists(l) && free(l));
  const fresh = existing ? undefined : lanes.find((l) => !exists(l));
  return { start, trackType: existing ?? fresh ?? 'aux5', ...(fresh ? { newTrackName } : {}) };
}

/** 🎼 az akkordmenet egy részének hangszíne és hangereje */
export const CHORD_PART_WAVE = { chords: 'triangle', bass: 'sawtooth', arp: 'square' } as const;
export const CHORD_PART_VOLUME = { chords: 0.8, bass: 0.8, arp: 0.6, drums: 0.9 } as const;

/**
 * 🎼 az akkordmenet egy részének sávja: az akkordok a zene-sávra, a többi az első létező, ÜRES aux-sávra, amire a
 * köteg még nem tett klipet; ha nincs ilyen, egy új aux-sáv (az ADD_TRACK a `commands`-ba, a típus a `lanes`-be
 * kerül). `null`: nincs több szabad sáv.
 */
export function pickChordLane(
  part: 'chords' | 'bass' | 'arp' | 'drums',
  project: TracksOf | null | undefined,
  lanes: TrackType[],
  commands: EditorCommand[],
  newTrack: (type: TrackType) => EditorCommand
): TrackType | null {
  if (part === 'chords') return 'music';
  const free = AUX_LANES.find((ty) => lanes.includes(ty) && !(project?.tracks.find((tr) => tr.type === ty)?.clips.length) && !commands.some((c) => c.type === 'ADD_CLIP' && c.trackType === ty));
  if (free) return free;
  const next = nextExtraTrack(lanes);
  if (!next) return null;
  lanes.push(next);
  commands.push(newTrack(next));
  return next;
}

/**
 * 🎤 az ének-hangolás eredményének parancsai: a klip a hangolt fájlra mutat (az eredeti forrás és a beállítások a
 * klipen), a harmónia az első üres aux-sávra (ha nincs, egy új sávra). Egy kötegbe valók (egy undo).
 */
export function tuneCommands(
  project: Pick<Project, 'tracks'> | null | undefined,
  clip: AudioClip,
  res: { tunedUri: string | null; harmonyUri: string | null; durationSec: number },
  s: { root: number; minor: boolean; strength: number; harmonySteps?: number },
  sourceUri: string,
  labels: { harmonyLane: string },
  makeId: (prefix: string) => string
): { cmds: EditorCommand[]; harmonyClipId: string | null } {
  const cmds: EditorCommand[] = [];
  const clipId = clip.id;
  if (res.tunedUri) {
    const asset: Asset = { id: makeId('ast'), kind: 'audio', uri: res.tunedUri, provider: 'local', name: `${clip.label} (hangolt)`, duration: res.durationSec };
    cmds.push({ type: 'ADD_ASSET', asset });
    cmds.push({ type: 'UPDATE_CLIP', clipId, patch: { uri: res.tunedUri, assetId: asset.id, tune: { sourceUri, ...(clip.tune?.sourceAssetId ?? clip.assetId ? { sourceAssetId: clip.tune?.sourceAssetId ?? clip.assetId } : {}), root: s.root, minor: s.minor, strength: s.strength, ...(s.harmonySteps ? { harmonySteps: s.harmonySteps } : {}) } } });
  }
  let harmonyClipId: string | null = null;
  if (res.harmonyUri) {
    const lanes = (project?.tracks ?? []).map((tr) => tr.type);
    const free = AUX_LANES.find((ty) => lanes.includes(ty) && !project?.tracks.find((tr) => tr.type === ty)?.clips.length);
    const lane = free ?? nextExtraTrack(lanes);
    if (lane) {
      if (!free) cmds.push({ type: 'ADD_TRACK', track: { id: makeId('trk'), type: lane, name: labels.harmonyLane, clips: [] } });
      const asset: Asset = { id: makeId('ast'), kind: 'audio', uri: res.harmonyUri, provider: 'local', name: labels.harmonyLane, duration: res.durationSec };
      harmonyClipId = makeId('clip');
      cmds.push({
        type: 'ADD_CLIP',
        trackType: lane,
        asset,
        clip: { kind: 'audio', id: harmonyClipId, start: clip.start, duration: clip.duration, trimIn: clip.trimIn ?? 0, sourceDuration: res.durationSec, uri: res.harmonyUri, label: labels.harmonyLane, volume: clip.volume * 0.7, fadeIn: clip.fadeIn, fadeOut: clip.fadeOut, source: 'imported' },
      });
    }
  }
  return { cmds, harmonyClipId };
}

/** 🔇 az AI-zajszűrés forrása: az eredeti (ha a klip már szűrt: annak forrása) */
export function aiDenoiseSource(clip: AudioClip): { sourceUri: string; sourceAssetId: string | undefined } {
  return { sourceUri: clip.aiDenoise?.sourceUri ?? clip.uri, sourceAssetId: clip.aiDenoise?.sourceAssetId ?? clip.assetId };
}

/** 🔇 az AI-zajszűrt fájl parancsai: új asset + a klip rá mutat (az eredeti a klipen marad) */
export function aiDenoiseCommands(
  clip: AudioClip,
  res: { uri: string; durationSec: number },
  strength: number,
  assetId: string
): EditorCommand[] {
  const { sourceUri, sourceAssetId } = aiDenoiseSource(clip);
  const asset: Asset = { id: assetId, kind: 'audio', uri: res.uri, provider: 'local', name: `${clip.label ?? ''} (AI)`.trim(), duration: res.durationSec };
  return [
    { type: 'ADD_ASSET', asset },
    { type: 'UPDATE_CLIP', clipId: clip.id, patch: { uri: res.uri, assetId: asset.id, aiDenoise: { sourceUri, ...(sourceAssetId ? { sourceAssetId } : {}), strength } } },
  ];
}

/** 🔇 az AI-zajszűrés visszavonó patch-e (az eredeti forrás vissza); `null`, ha a klip nem szűrt */
export function resetAiDenoisePatch(clip: AudioClip | undefined): Partial<AudioClip> | null {
  if (!clip?.aiDenoise) return null;
  return { uri: clip.aiDenoise.sourceUri, ...(clip.aiDenoise.sourceAssetId ? { assetId: clip.aiDenoise.sourceAssetId } : {}), aiDenoise: undefined };
}

/** 🎤 a hangolás visszavonó patch-e (az eredeti forrás vissza); `null`, ha a klip nem hangolt */
export function resetTunePatch(clip: AudioClip | undefined): Partial<AudioClip> | null {
  if (!clip?.tune) return null;
  return { uri: clip.tune.sourceUri, ...(clip.tune.sourceAssetId ? { assetId: clip.tune.sourceAssetId } : {}), tune: undefined };
}

/**
 * 🎙️🤖 az asszisztens AI-zajszűrésének klipjei: a megnevezett sávok hang-klipjei — ha a kijelölt klip ezek egyikén
 * van és több jelölt is lenne, csak a kijelölt
 */
export function assistantDenoiseIds(project: Pick<Project, 'tracks'> | null | undefined, tracks: TrackType[], sel: { id: string } | null): string[] {
  const ids = (project?.tracks ?? []).filter((tr) => tracks.includes(tr.type)).flatMap((tr) => tr.clips).filter((c) => c.kind === 'audio').map((c) => c.id);
  return sel && tracks.includes(trackTypeOfClip(project, sel.id) as TrackType) && ids.length > 1 ? [sel.id] : ids;
}

/** az idővonal ablaka: a teljes szélesség és a rajzolandó (látható ± egy képernyő) időtartomány */
export function timelineWindow(duration: number, pxPerSec: number, view: { x: number; w: number }): { timelineW: number; viewW: number; viewFrom: number; viewTo: number } {
  const timelineW = Math.max(320, duration * pxPerSec + 40);
  const viewW = view.w || 1200;
  const viewFrom = Math.max(0, (view.x - viewW) / pxPerSec);
  const viewTo = Math.min((timelineW - 40) / pxPerSec, (view.x + 2 * viewW) / pxPerSec);
  return { timelineW, viewW, viewFrom, viewTo };
}

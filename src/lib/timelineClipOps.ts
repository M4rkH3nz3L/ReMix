/**
 * 🎬 Egy idővonal-klip tiszta számításai (React/RN-mentes → tesztelhető).
 *
 * A `TimelineClip.tsx`-ből kiemelve: illesztési célpontok és a legközelebbi
 * célpont, a drag-to-track döntés, a mozgatás-javaslat, a bal/jobb trim patch,
 * a clip-edge preview idői, a kontextusmenü vágáspontja és a klip címkéje.
 */
import type { TFunction } from 'i18next';

import { MIN_CLIP_DURATION } from '@/constants/editor';
import { trimAudioLeft, trimAudioRight } from '@/lib/audioTrim';
import { cropKeyframes } from '@/lib/keyframes';
import { sourceTimeAt, trimClipLeft, trimClipRight } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import type { Clip, Project } from '@/types/project';

/** 🔍 clip-edge preview: a vágott szél oldala, forrás- és idővonal-ideje */
export interface ClipEdgePreviewState {
  side: 'left' | 'right';
  srcTime: number;
  tlTime: number;
}

/** az illesztéshez szükséges store-szelet (szerkezetileg az EditorState része) */
export interface ClipSnapSource {
  snapTargets: { playhead: boolean; clips: boolean; markers: boolean; beats: boolean; regions: boolean };
  playhead: number;
  beatTimes: number[];
  project: Pick<Project, 'markers' | 'regions' | 'tracks'> | null;
}

/**
 * 🧲 A konfigurált illesztési CÉLPONTOK (a magnet-menü kapcsolói szerint): a
 * lejátszófej, MÁS klipek élei (start+vég), a 🔖 jelölők, a zene-beatek és a
 * 🏷️ régiók határai. A saját klip élei kimaradnak. `snapTargets.off` → üres.
 */
export function collectClipSnapTargets(st: ClipSnapSource, clipId: string): number[] {
  const cfg = st.snapTargets;
  const targets: number[] = [0];
  if (cfg.playhead) {
    targets.push(st.playhead);
  }
  if (cfg.beats) {
    targets.push(...st.beatTimes);
  }
  if (cfg.markers) {
    targets.push(...(st.project?.markers ?? []).map((m) => m.time));
  }
  if (cfg.regions) {
    for (const r of st.project?.regions ?? []) {
      targets.push(r.start, r.end);
    }
  }
  if (cfg.clips) {
    for (const tk of st.project?.tracks ?? []) {
      for (const c of tk.clips) {
        if (c.id !== clipId) {
          targets.push(c.start, c.start + c.duration);
        }
      }
    }
  }
  return targets;
}

/** A `value`-hoz legközelebbi célpont, ha a küszöbön (mp) belül van; különben maga a `value`. */
export function nearestSnapTarget(value: number, targets: number[], thresh: number): number {
  let best = value;
  let bestDist = thresh;
  for (const target of targets) {
    const d = Math.abs(target - value);
    if (d < bestDist) {
      bestDist = d;
      best = target;
    }
  }
  return best;
}

/**
 * ↕️ DRAG-TO-TRACK: ha a függőleges szándék dominál és átlép egy küszöböt (fél+
 * sávnyi), a klip a szomszédos KOMPATIBILIS sávra lép. Csak egyedi, NEM-linkelt/köteg
 * klipre és nem slip/slide módban.
 */
export function wantsTrackStep(dx: number, dy: number, height: number, trimMode: string, isGroup: boolean): boolean {
  return (
    !isGroup &&
    trimMode !== 'slip' &&
    trimMode !== 'slide' &&
    Math.abs(dy) > height * 0.6 &&
    Math.abs(dy) > Math.abs(dx)
  );
}

/** magnetikus él: a START vagy a VÉG illesztése közül a kisebb elmozdulású nyer (≥ 0) */
export function pickSnappedMoveStart(raw: number, snapStart: number, snapEndAsStart: number): number {
  return Math.max(
    0,
    Math.abs(snapStart - raw) <= Math.abs(snapEndAsStart - raw) ? snapStart : snapEndAsStart
  );
}

/** A bal-trim patch-e az (illesztett) új kezdetből — a kulcskockák a tényleges eltolással követik. */
export function trimLeftUpdate(clip: Clip, snappedStart: number) {
  const deltaSec = clamp(snappedStart - clip.start, -clip.start, clip.duration - MIN_CLIP_DURATION);
  // a forrás-ablak fajtánként: videó ⏪ reversed-tudatosan, HANG a trimIn-nel együtt (B2 —
  // korábban a hang csak „elcsúszott"); a kulcskockák a tényleges eltolással követik (B5)
  const patch =
    clip.kind === 'video'
      ? trimClipLeft(clip, deltaSec)
      : clip.kind === 'audio'
        ? trimAudioLeft(clip, deltaSec)
        : { start: clip.start + deltaSec, duration: clip.duration - deltaSec };
  const keyframes =
    'keyframes' in clip && clip.keyframes
      ? { keyframes: cropKeyframes(clip.keyframes, patch.start - clip.start, patch.duration) }
      : {};
  return { ...patch, ...keyframes };
}

/** A jobb-trim patch-e a kívánt (illesztett) hosszból. */
export function trimRightPatch(clip: Clip, desired: number): { duration: number; trimIn?: number } {
  // ⏪ reversed-tudatos forrás-ablak + clamp (a trimClipRight kezeli); a hossz
  // ebből jön, a ripple is ezzel tolja a mögöttes klipeket.
  return clip.kind === 'video'
    ? trimClipRight(clip, desired)
    : clip.kind === 'audio'
      ? // a hang nem nyújtható a valós forrás végén túl
        // ⏪ visszafelé szóló hangnál a trimIn is mozdul (a jobb él a forrás eleje)
        trimAudioRight(clip, desired)
      : { duration: clamp(desired, MIN_CLIP_DURATION, Number.POSITIVE_INFINITY), trimIn: undefined };
}

/** 🔍 bal-trim közben a szél idővonal- és forrás-ideje */
export function leftEdgePreview(clip: Clip, dx: number, pps: number): { tlTime: number; srcTime: number } {
  const deltaSec = clamp(dx / pps, -clip.start, clip.duration - MIN_CLIP_DURATION);
  let tlTime: number;
  let srcTime: number;
  if (clip.kind === 'video') {
    // ⏪ reversed-tudatos: a feloldott él-forrásidő a trimClipLeft patch-ből
    const p = trimClipLeft(clip, deltaSec);
    tlTime = p.start;
    srcTime = sourceTimeAt({ ...clip, ...p }, p.start);
  } else {
    tlTime = clip.start + deltaSec;
    srcTime = 0;
  }
  return { tlTime, srcTime };
}

/** 🔍 jobb-trim közben a szél idővonal- és forrás-ideje */
export function rightEdgePreview(clip: Clip, dx: number, pps: number): { tlTime: number; srcTime: number } {
  let tlTime: number;
  let srcTime: number;
  if (clip.kind === 'video') {
    const p = trimClipRight(clip, clip.duration + dx / pps);
    tlTime = clip.start + p.duration;
    srcTime = sourceTimeAt({ ...clip, ...p }, tlTime);
  } else {
    const duration = clamp(clip.duration + dx / pps, MIN_CLIP_DURATION, Number.POSITIVE_INFINITY);
    tlTime = clip.start + duration;
    srcTime = 0;
  }
  return { tlTime, srcTime };
}

/** frame-nyi küszöb: húzás közben csak érdemi elmozdulásra ad új állapotot (különben `prev`) */
export function nextEdgePreview(
  prev: ClipEdgePreviewState | null,
  side: 'left' | 'right',
  srcTime: number,
  tlTime: number
): ClipEdgePreviewState {
  return prev && prev.side === side && Math.abs(prev.tlTime - tlTime) < 0.02
    ? prev
    : { side, srcTime, tlTime };
}

/** 📋 a kontextusmenü vágáspontja: a lejátszófej, ha a klipen áll; különben a klip közepe */
export function clipMenuSplitAt(playhead: number, clip: Pick<Clip, 'start' | 'duration'>): number {
  const onClip = playhead > clip.start && playhead < clip.start + clip.duration;
  return onClip ? playhead : clip.start + clip.duration / 2;
}

/** A klip felirata az idővonalon (fajta szerint, i18n). */
export function clipLabel(clip: Clip, t: TFunction): string {
  switch (clip.kind) {
    case 'video':
      return clip.comp
        ? t('editor.timelineClip.compound')
        : clip.speed !== 1
          ? t('editor.timelineClip.videoSpeed', { speed: clip.speed })
          : t('editor.timelineClip.video');
    case 'image':
      return t('editor.timelineClip.image');
    case 'text':
      return clip.text || t('editor.timelineClip.text');
    case 'audio':
      return clip.label || t('editor.timelineClip.audio');
    case 'interactive':
      return clip.label || t('editor.timelineClip.hotspot');
    case 'shape':
      return clip.shape === 'ellipse'
        ? t('editor.timelineClip.ellipse')
        : clip.shape === 'line'
          ? t('editor.timelineClip.line')
          : t('editor.timelineClip.rectangle');
    case 'adjust':
      return t('editor.timelineClip.grade');
  }
}

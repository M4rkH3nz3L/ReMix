import { makeId } from '@/lib/id';

/**
 * 🎚️ Automation-lane mag (S-PRODUCER — MASTER §7) — a keverő-paraméterek időbeli
 * automatizálása: volume/pan/mute/send/filter/**plugin-paraméter**. Egy lane egy
 * mixer-csatorna egy paraméterét vezérli időpontok (breakpoint-ok) mentén; a
 * `valueAt` a lejátszófejnél interpolál (mute = lépcsős). A meglévő volume-
 * keyframe általánosítása. Tiszta, expo-mentes, immutábilis.
 */

export type AutomationTarget = 'volume' | 'pan' | 'mute' | 'send' | 'filter' | 'plugin';

export interface AutomationPoint {
  time: number;
  value: number;
}

export interface AutomationLane {
  id: string;
  /** melyik mixer-csatornát/buszt vezérli (a [mixer.ts](./mixer) id-ja) */
  channelId: string;
  target: AutomationTarget;
  /** cél-paraméter kulcs (send → busId, plugin/filter → param-név) */
  param?: string;
  /** interpoláció: folytonos (linear) vagy lépcsős (step — mute/kapcsoló) */
  mode: 'linear' | 'step';
  /** breakpoint-ok idő szerint növekvő sorrendben */
  points: AutomationPoint[];
}

/** Új lane — a mute/kapcsoló-jellegű célok alapból lépcsősek. */
export function createLane(channelId: string, target: AutomationTarget, param?: string): AutomationLane {
  return {
    id: makeId('auto'),
    channelId,
    target,
    ...(param ? { param } : {}),
    mode: target === 'mute' ? 'step' : 'linear',
    points: [],
  };
}

/** Breakpoint upsert (azonos időpontnál FELÜLÍR), idő szerint rendezve tartva. */
export function addPoint(lane: AutomationLane, point: AutomationPoint): AutomationLane {
  const rest = lane.points.filter((p) => p.time !== point.time);
  const points = [...rest, point].sort((a, b) => a.time - b.time);
  return { ...lane, points };
}

export function removePoint(lane: AutomationLane, time: number): AutomationLane {
  const points = lane.points.filter((p) => p.time !== time);
  return points.length === lane.points.length ? lane : { ...lane, points };
}

export function clearLane(lane: AutomationLane): AutomationLane {
  return lane.points.length === 0 ? lane : { ...lane, points: [] };
}

export function isAutomated(lane: AutomationLane): boolean {
  return lane.points.length > 0;
}

/**
 * A paraméter értéke a `time` pillanatban. Üres lane → undefined. A szélek
 * kitartanak (első/utolsó érték); közben `linear` interpolál, `step` az előző
 * pontot tartja.
 */
export function valueAt(lane: AutomationLane, time: number): number | undefined {
  const pts = lane.points;
  if (pts.length === 0) {
    return undefined;
  }
  if (time <= pts[0].time) {
    return pts[0].value;
  }
  if (time >= pts[pts.length - 1].time) {
    return pts[pts.length - 1].value;
  }
  let i = 0;
  while (i < pts.length - 1 && pts[i + 1].time <= time) {
    i++;
  }
  const a = pts[i];
  const b = pts[i + 1];
  if (lane.mode === 'step' || b.time === a.time) {
    return a.value;
  }
  const t = (time - a.time) / (b.time - a.time);
  return Math.round((a.value + (b.value - a.value) * t) * 1e6) / 1e6;
}

/** Egy csatorna adott céljának lane-je egy lane-halmazból (ha van). */
export function findLane(
  lanes: AutomationLane[],
  channelId: string,
  target: AutomationTarget,
  param?: string
): AutomationLane | undefined {
  return lanes.find((l) => l.channelId === channelId && l.target === target && l.param === param);
}

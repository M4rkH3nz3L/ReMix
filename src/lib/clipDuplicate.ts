import { snapToFrame } from '@/lib/frames';
import type { Clip } from '@/types/project';

/**
 * 📑 Duplikálás: a kijelölt klipek másolata közvetlenül a kijelölés VÉGÉRE kerül (az egymáshoz
 * mért távolságuk marad, a kezdet a frame-rácson), új azonosítóval — a vágólapot nem írja felül.
 */
export function duplicateAfter(clips: Clip[], fps: number, makeId: () => string): Clip[] {
  if (clips.length === 0) {
    return [];
  }
  const minStart = Math.min(...clips.map((c) => c.start));
  const end = Math.max(...clips.map((c) => c.start + c.duration));
  const base = snapToFrame(end, fps);
  return clips.map((c) => ({ ...c, id: makeId(), start: base + (c.start - minStart) }) as Clip);
}

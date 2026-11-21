/**
 * 🗓️ A render-sor képernyő (src/app/schedules.tsx) tiszta, expo-mentes magja: kis
 * szöveg- és szám-leképezések. A képernyőből kiemelve (REFACTOR) — a viselkedés változatlan.
 */
import type { RenderJob, RenderWorker } from '@/lib/schedules';

/** az első betű nagybetűs (az állapot-kulcshoz: `active` → `Active`) */
export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** a futó job sávjának szélessége: 3…100 % közé szorítva (a 0 is látszódjon) */
export function progressBarWidth(progress: number): `${number}%` {
  return `${Math.max(3, Math.min(100, progress))}%`;
}

/** a worker rövid azonosítója a névhez: a szerver shortId-ja, különben az id első 6 jele */
export function workerShortId(worker: Pick<RenderWorker, 'shortId' | 'id'>): string {
  return worker.shortId || worker.id.slice(0, 6);
}

/** az adott állapotú jobok száma (az összesítő-sorhoz) */
export function countJobs(jobs: RenderJob[], state: RenderJob['state']): number {
  return jobs.filter((j) => j.state === state).length;
}

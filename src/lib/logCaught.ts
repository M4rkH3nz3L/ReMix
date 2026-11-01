import { classifyError } from '@/lib/errors';

/**
 * 📋 Minden elkapott hiba ide fut: semmi nem tűnhet el nyomtalanul. A `catch` továbbra is kezeli a
 * hibát (a felhasználó nem lát többet), de a nyoma a worker `server/bugs/` mappájába kerül.
 * Szándékosan expo-mentes, így a tiszta magokból is hívható; a kézbesítést a gyökér-layout köti be
 * a `reportBug`-ra. Sosem dob. A worklet nem hívhatja: ott a JS-szál nem érhető el.
 */
export type CaughtSink = (error: unknown, where: string, errorClass: string) => void;

const MAX_EARLY = 50;
let sink: CaughtSink | null = null;
let early: { error: unknown; where: string; errorClass: string }[] = [];

export function logCaught(where: string, error: unknown): void {
  try {
    const errorClass = classifyError(error);
    if (sink) {
      sink(error, where, errorClass);
    } else if (early.length < MAX_EARLY) {
      early.push({ error, where, errorClass });
    }
  } catch {
    // a naplózó nem okozhat újabb hibát, és magát nem jelentheti
  }
}

/** A kézbesítő bekötése; az indulás közben elkapott hibák ekkor mennek ki. */
export function setCaughtSink(next: CaughtSink | null): void {
  sink = next;
  if (next) {
    const pending = early;
    early = [];
    pending.forEach((p) => next(p.error, p.where, p.errorClass));
  }
}

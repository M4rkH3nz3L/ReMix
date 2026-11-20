import { continuesInSource } from '@/lib/audioTrim';
import type { AudioClip } from '@/types/project';

import { EDGE_EPS, EDGE_FADE_SEC } from './model';

/**
 * ✖️ Automatikus crossfade (a DAW-ok alapértelmezése): ha egy sávon a következő klip az előző
 * VÉGÉBE lóg bele, az átfedés alatt az előző kihalkul, a következő felhangosodik — a crossfade
 * hossza az átfedés (a klip mozgatásával állítható). Ha a klip teljesen a másikon belül van,
 * az rétegezés: nincs crossfade.
 */
export function crossfadePairs(clips: Pick<AudioClip, 'id' | 'start' | 'duration'>[]): { outId: string; inId: string; start: number; length: number }[] {
  const pairs: { outId: string; inId: string; start: number; length: number }[] = [];
  const sorted = clips.slice().sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aEnd = a.start + a.duration;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.start >= aEnd - EDGE_EPS) break;
      if (b.start + b.duration <= aEnd + EDGE_EPS || b.start <= a.start + EDGE_EPS) continue; // rétegezés
      pairs.push({ outId: a.id, inId: b.id, start: b.start, length: aEnd - b.start });
    }
  }
  return pairs;
}

export function crossfades(clips: AudioClip[]): Map<string, { in: number; out: number }> {
  const out = new Map<string, { in: number; out: number }>();
  for (const p of crossfadePairs(clips)) {
    const ea = out.get(p.outId) ?? { in: 0, out: 0 };
    const eb = out.get(p.inId) ?? { in: 0, out: 0 };
    out.set(p.outId, { ...ea, out: Math.max(ea.out, p.length) });
    out.set(p.inId, { ...eb, in: Math.max(eb.in, p.length) });
  }
  return out;
}

/**
 * A klip ténylegesen alkalmazott fade-jei: a felhasználói fade, ennek hiányában 5 ms-os
 * mikro-fade — kivéve a kettévágott klip illesztését (ugyanaz a forrás folytatódik).
 * A szerver `edgeFades`-ének tükre.
 */
export function edgeFades(clips: AudioClip[]): Map<string, { in: number; out: number }> {
  const out = new Map<string, { in: number; out: number }>();
  // ⏩⏪ a forrásban is folytatódó szomszéd (sebesség és irány szerint — a szerver tükre)
  for (const c of clips) {
    const joinedBefore = clips.some(
      (p) => p !== c && p.uri === c.uri && Math.abs(p.start + p.duration - c.start) < EDGE_EPS && continuesInSource(p, c, EDGE_EPS)
    );
    const joinedAfter = clips.some(
      (n) => n !== c && n.uri === c.uri && Math.abs(c.start + c.duration - n.start) < EDGE_EPS && continuesInSource(c, n, EDGE_EPS)
    );
    out.set(c.id, {
      in: c.fadeIn > 0 ? c.fadeIn : joinedBefore ? 0 : EDGE_FADE_SEC,
      out: c.fadeOut > 0 ? c.fadeOut : joinedAfter ? 0 : EDGE_FADE_SEC,
    });
  }
  return out;
}

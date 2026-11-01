import type { LiveTransform } from '@/types/live';

/** 🖐️ Forrás mozgatása és méretezése a vásznon (pure), a vászon arányában. A keret a vásznon marad. */
export const MIN_SOURCE_SIZE = 0.08;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function moveTransform(t: LiveTransform, dx: number, dy: number): LiveTransform {
  return { ...t, x: clamp(t.x + dx, 0, 1 - t.w), y: clamp(t.y + dy, 0, 1 - t.h) };
}

/** a jobb alsó sarok húzása: a bal felső sarok áll */
export function resizeTransform(t: LiveTransform, dx: number, dy: number): LiveTransform {
  return { ...t, w: clamp(t.w + dx, MIN_SOURCE_SIZE, 1 - t.x), h: clamp(t.h + dy, MIN_SOURCE_SIZE, 1 - t.y) };
}

/** csippentés: a közepe körül, az arány megtartásával */
export function scaleTransform(t: LiveTransform, factor: number): LiveTransform {
  const f = clamp(factor, Math.max(MIN_SOURCE_SIZE / t.w, MIN_SOURCE_SIZE / t.h), Math.min(1 / t.w, 1 / t.h));
  const [w, h] = [t.w * f, t.h * f];
  return { ...t, w, h, x: clamp(t.x + (t.w - w) / 2, 0, 1 - w), y: clamp(t.y + (t.h - h) / 2, 0, 1 - h) };
}

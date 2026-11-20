import { sortedSources } from '@/lib/liveDoc';
import type { Project } from '@/types/project';
import type { LiveScene, LiveTransform } from '@/types/live';

/**
 * A Live Studio (src/app/live/studio/[id].tsx) expo-mentes számításai (REFACTOR:
 * a képernyőből kiemelve, változatlan kifejezésekkel).
 */

/** Vászon-arány a projekt aspectRatio-jából (szélesség:magasság). */
export function aspectValue(ar: string | undefined): number {
  if (ar === '9:16') return 9 / 16;
  if (ar === '1:1') return 1;
  return 16 / 9;
}

/** A vászon mérete: a 9:16 vászon túl magas lenne teljes szélességen → ha kell, a
 *  magasságra korlátozzuk és a szélességet arányosan csökkentjük. */
export function fitCanvas(width: number, aspect: number, maxHeight: number): { w: number; height: number } {
  let w = width;
  let height = w / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    w = height * aspect;
  }
  return { w, height };
}

/** A vászon legnagyobb magassága: tableten 70 %, telefonon 42 % a képernyőből. */
export function canvasMaxHeight(wide: boolean, winH: number): number {
  return wide ? winH * 0.7 : winH * 0.42;
}

/** Egy 0–1 transform képpont-doboza a vásznon (legalább 28 × 22 pt). */
export function sourceRect(t: LiveTransform, w: number, height: number) {
  return {
    left: t.x * w,
    top: t.y * height,
    width: Math.max(28, t.w * w),
    height: Math.max(22, t.h * height),
  };
}

/** 🎥 egyszerre csak EGY élő kamera (iOS) → az első látható kamera-forrás kap képet */
export function primaryCameraIdOf(scene: LiveScene | undefined): string | null {
  return scene ? sortedSources(scene).find((s) => s.kind === 'camera' && s.visible)?.id ?? null : null;
}

/** Az új jelenet alapneve. */
export function nextSceneName(sceneCount: number): string {
  return `Scene ${sceneCount + 1}`;
}

/** Az adás címe: a vágott vázlat, üresen a doc címe, legfeljebb 120 karakter. */
export function startTitle(titleDraft: string, docTitle: string): string {
  return (titleDraft.trim() || docTitle).slice(0, 120);
}

/** 📷 L27: a választott kamera-irány a műsorral együtt mentődik. */
export function projectWithFacing(current: Project, facing: 'front' | 'back'): Project {
  return current.live ? { ...current, live: { ...current.live, cameraFacing: facing } } : current;
}

/** Kamera-irány váltása. */
export function flipFacing(f: 'front' | 'back'): 'front' | 'back' {
  return f === 'front' ? 'back' : 'front';
}

/** 🎚️ a csatorna-erősítés 0..1 sávként (MIN_DB..MAX_DB, nem vágva). */
export function gainLevel(gainDb: number, minDb: number, maxDb: number): number {
  return (gainDb - minDb) / (maxDb - minDb);
}

/** A sáv kitöltésének szélessége (0–100 %-ra vágva). */
export function levelWidth(level: number): `${number}%` {
  return `${Math.max(0, Math.min(1, level)) * 100}%`;
}

/** dB-felirat: a pozitív érték „+” előjellel (szöveg), a többi számként marad. */
export function formatGainDb(db: number): string | number {
  return db > 0 ? `+${db}` : db;
}

/** Az „Add RTMP” gomb tiltva, ha az URL vagy a kulcs üres (vágva). */
export function rtmpSubmitDisabled(rtmpUrl: string, rtmpKey: string): boolean {
  return !rtmpUrl.trim() || !rtmpKey.trim();
}

/** Az új egyéni RTMP-cél bemenete (vágott mezők, üres címke → „RTMP”, bekapcsolva). */
export function rtmpDestinationInput(rtmpLabel: string, rtmpUrl: string, rtmpKey: string) {
  return {
    platform: 'custom' as const,
    label: rtmpLabel.trim() || 'RTMP',
    rtmpUrl: rtmpUrl.trim(),
    streamKey: rtmpKey.trim(),
    enabled: true,
  };
}

/** A cél-mentés hibája: a `live.dest.*` üzenet i18n-kulcs, a többi szerver-üzenet. */
export function isDestErrorKey(msg: string): boolean {
  return msg.startsWith('live.dest.');
}

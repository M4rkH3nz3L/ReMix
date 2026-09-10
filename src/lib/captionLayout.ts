import type { FaceBoxLike } from '@/lib/faceRegion';

/**
 * 🗣️ Caption Studio v2 — pure réteg: beszélő-hozzárendelés (színkód) és
 * dinamikus felirat-pozíció (az arcot kikerülve). React-native import NÉLKÜL,
 * hogy tesztelhető legyen; a detektálás/hívás a CaptionPanelben.
 *
 * A koordináták a vászonra normalizáltak (0–1), az arcdoboz középpont+méret
 * (lásd faceRegion.ts).
 */

/** beszélő-színek: erős kontraszt sötét körvonalon, TikTok-olvashatóság */
export const SPEAKER_COLORS = [
  '#ffffff',
  '#ffd166',
  '#8ef6c4',
  '#9ad2ff',
  '#ff9ecb',
  '#ffb07c',
];

export interface SpeakerInput {
  id: string;
  /** melyik forrásból (kamera/klip) szól a sor — a fő csoportosító kulcs */
  sourceKey: string;
  /** az arc vízszintes középpontja a sor idejében, ha van detektálás */
  faceX?: number;
}

/**
 * Beszélő-index minden sorhoz. Elsődleges jel a forrásklip (A/B kamerás vágásnál
 * a vágás maga a beszélőváltás), másodlagos az arc vízszintes helye — így egy
 * kétfős, egy kamerás beállításban (bal/jobb) is szétválnak a beszélők.
 *
 * A `splitGap` az a vízszintes távolság, ami fölött két arc már külön embernek
 * számít; ez alatt egyetlen (mozgó) beszélőnek vesszük.
 */
export function assignSpeakers(
  lines: SpeakerInput[],
  splitGap = 0.18
): Map<string, number> {
  const out = new Map<string, number>();
  if (lines.length === 0) {
    return out;
  }

  // 1) forrás szerinti alapcsoportok, első megjelenés sorrendjében
  const sourceOrder: string[] = [];
  for (const l of lines) {
    if (!sourceOrder.includes(l.sourceKey)) {
      sourceOrder.push(l.sourceKey);
    }
  }

  let next = 0;
  for (const source of sourceOrder) {
    const group = lines.filter((l) => l.sourceKey === source);
    const xs = group.map((l) => l.faceX).filter((x): x is number => x != null);
    const spread = xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0;

    if (spread < splitGap) {
      // egy beszélő ebből a forrásból
      const idx = next++;
      group.forEach((l) => out.set(l.id, idx));
      continue;
    }
    // két oldal: a szélsőértékek felezőpontja a választóvonal
    const mid = (Math.max(...xs) + Math.min(...xs)) / 2;
    const leftIdx = next++;
    const rightIdx = next++;
    group.forEach((l) => {
      // arc nélküli sor a bal (előbb megjelent) oldalhoz kerül
      out.set(l.id, l.faceX != null && l.faceX > mid ? rightIdx : leftIdx);
    });
  }
  return out;
}

/** a beszélő-index színe (körbefordul, ha több beszélő van, mint szín) */
export function speakerColor(index: number): string {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

/**
 * Dinamikus felirat-pozíció: a felirat a megszokott alsó harmadban marad, amíg
 * nem takarja az arcot; ha takarná, átugrik az arc másik oldalára (fölé vagy
 * alá — amelyik oldalon több hely van), a biztonságos sávon belül.
 *
 * @param face   az arc doboza a sor idejében (null → marad az alapérték)
 * @param preferred a felirat y-középpontja alapból
 * @param band   a felirat sávjának magassága (több sor → nagyobb)
 */
export function captionY(
  face: FaceBoxLike | null,
  preferred = 0.78,
  band = 0.14,
  safeTop = 0.12,
  safeBottom = 0.9
): number {
  const clampY = (v: number) =>
    Math.min(safeBottom - band / 2, Math.max(safeTop + band / 2, v));
  if (!face) {
    return clampY(preferred);
  }
  const capTop = preferred - band / 2;
  const capBottom = preferred + band / 2;
  const faceTop = face.y - face.h / 2;
  const faceBottom = face.y + face.h / 2;
  const overlaps = capTop < faceBottom && capBottom > faceTop;
  if (!overlaps) {
    return clampY(preferred);
  }
  // hely az arc alatt / fölött (a biztonságos sávon belül)
  const below = safeBottom - faceBottom;
  const above = faceTop - safeTop;
  const gap = 0.03;
  if (below >= above) {
    return clampY(faceBottom + gap + band / 2);
  }
  return clampY(faceTop - gap - band / 2);
}

/**
 * A felirat sávmagassága (vászonmagasság-arányban). A `fontSize` a vászon
 * MAGASSÁGÁNAK százaléka (fontPx = fontSize/100 · H, lásd render.js), így egy
 * sorba kb. `aspect·100 / (0.55·fontSize)` karakter fér — ebből jön a sorszám.
 */
export function captionBand(text: string, fontSize: number, aspect = 0.5625): number {
  const size = Math.max(1, fontSize);
  const perLine = Math.max(6, Math.round((aspect * 100) / (0.55 * size)));
  const lines = Math.max(1, Math.ceil(text.trim().length / perLine));
  // sormagasság ≈ 1.25 · fontPx, plusz a háttér/körvonal margója
  return Math.min(0.5, (lines * size * 1.25) / 100 + 0.03);
}

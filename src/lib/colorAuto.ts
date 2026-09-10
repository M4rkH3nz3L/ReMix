import type { ClipAdjust } from '@/types/project';

/**
 * 🎨 Color AI (P1, v1) — pure leképezők: a worker szín-statisztikáiból
 * konzervatív ClipAdjust-javaslat készül (a meglévő képjavítás-motorra, amit
 * az előnézet és a render már ismer). Determinisztikus és tesztelhető;
 * AI-look javaslatok későbbi bővítés.
 */

export interface ColorStats {
  /** 0–1 */
  lumaMean: number;
  lumaP5: number;
  lumaP95: number;
  satMean: number;
  rMean: number;
  gMean: number;
  bMean: number;
  /**
   * 🧑 a bőrtónus-tartományba eső képpontok aránya (0–1). Nem arcdetektálás —
   * RGB-küszöb; portrén tipikusan 0,1–0,4, tájképen ~0.
   */
  skinRatio?: number;
}

/**
 * 🧑 Bőrtónus-védelem: minél nagyobb a bőr aránya a képen, annál óvatosabb a
 * színhő- és telítettség-korrekció. A bőr a legérzékenyebb felület — egy
 * tájképnek jót tesz a +0,2 telítettség, egy arcnak ugyanaz már sárgás/vörhenyes
 * lesz. A fényerő és a kontraszt kevésbé bántja, azokat csak enyhén fogjuk.
 *
 * 40% bőr fölött a hő/telítettség korrekció harmadára esik vissza.
 */
export function protectSkin(adjust: ClipAdjust, skinRatio = 0): ClipAdjust {
  const skin = clampN(skinRatio, 0, 1);
  if (skin < 0.06) {
    return adjust; // gyakorlatilag nincs bőr a képen — teljes korrekció
  }
  const strong = clampN(1 - skin * 1.7, 0.33, 1); // hő + telítettség
  const mild = clampN(1 - skin * 0.6, 0.7, 1); // fényerő + kontraszt
  const out: ClipAdjust = { ...adjust };
  const scale = (v: number | undefined, k: number) =>
    v === undefined ? undefined : dead(round(v * k), 0.02);
  out.temperature = scale(adjust.temperature, strong);
  out.saturation = scale(adjust.saturation, strong);
  out.brightness = scale(adjust.brightness, mild);
  out.contrast = scale(adjust.contrast, mild);
  // a nullára csökkent mezők kerüljenek ki, ne szemeteljenek
  for (const key of ['temperature', 'saturation', 'brightness', 'contrast'] as const) {
    if (!out[key]) {
      delete out[key];
    }
  }
  return out;
}

const clampN = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 100) / 100;

/** 0-közeli értékek eldobása — ne szemetelje tele az adjustot zaj-korrekció */
const dead = (v: number, threshold: number) => (Math.abs(v) < threshold ? 0 : v);

/**
 * Auto Color: cél a kiegyensúlyozott expozíció (luma-átlag ~0,47), egészséges
 * kontraszt (p5–p95 sáv ~0,75), semleges színhő (R≈B) és élő, de nem túltolt
 * szaturáció (~0,32). Minden korrekció fele-erővel megy (konzervatív), és a
 * jelentéktelen eltérések kimaradnak.
 */
export function statsToAutoAdjust(stats: ColorStats): ClipAdjust {
  const brightness = dead(
    round(clampN((0.47 - stats.lumaMean) * 0.7, -0.25, 0.25)),
    0.03
  );
  const spread = Math.max(0.05, stats.lumaP95 - stats.lumaP5);
  const contrast = dead(
    round(clampN((0.75 / spread - 1) * 0.35, -0.2, 0.3)),
    0.04
  );
  const temperature = dead(
    round(clampN((stats.bMean - stats.rMean) * 1.2, -0.2, 0.2)),
    0.03
  );
  const saturation = dead(
    round(clampN((0.32 - stats.satMean) * 1.1, -0.35, 0.35)),
    0.05
  );
  const out: ClipAdjust = {};
  if (brightness !== 0) out.brightness = brightness;
  if (contrast !== 0) out.contrast = contrast;
  if (temperature !== 0) out.temperature = temperature;
  if (saturation !== 0) out.saturation = saturation;
  return protectSkin(out, stats.skinRatio);
}

/**
 * Match Color: a klip statisztikái a referencia-klip felé tolódnak (fele-erős
 * korrekcióval — a teljes kiegyenlítés túltolt szokott lenni).
 */
export function statsToMatchAdjust(
  target: ColorStats,
  reference: ColorStats
): ClipAdjust {
  const brightness = dead(
    round(clampN((reference.lumaMean - target.lumaMean) * 0.75, -0.3, 0.3)),
    0.02
  );
  const tSpread = Math.max(0.05, target.lumaP95 - target.lumaP5);
  const rSpread = Math.max(0.05, reference.lumaP95 - reference.lumaP5);
  const contrast = dead(round(clampN((rSpread / tSpread - 1) * 0.5, -0.3, 0.3)), 0.03);
  const tCast = target.rMean - target.bMean;
  const rCast = reference.rMean - reference.bMean;
  const temperature = dead(round(clampN((rCast - tCast) * 0.9, -0.25, 0.25)), 0.02);
  const saturation = dead(
    round(clampN((reference.satMean - target.satMean) * 0.9, -0.5, 0.5)),
    0.03
  );
  const out: ClipAdjust = {};
  if (brightness !== 0) out.brightness = brightness;
  if (contrast !== 0) out.contrast = contrast;
  if (temperature !== 0) out.temperature = temperature;
  if (saturation !== 0) out.saturation = saturation;
  return protectSkin(out, target.skinRatio);
}

/**
 * 📦 Batch-export (VIDEOT §8) — pure, tesztelhető terv. A kiválasztott platformokból
 * (TikTok/Reels/Shorts/YouTube/Instagram) render-JOB-listát épít: platformonként a
 * `PLATFORM_PRESETS` aspect+settings-e a base fölé merge-elve. Az AZONOS kimeneti
 * konfigot (aspect + settings) ÖSSZEVONJA egy jobbá (a címkék listázva) → nem renderel
 * 3× ugyanazt (TikTok/Reels/Shorts mind 9:16 1080 → egy fájl). A tényleges futtatás
 * (job-onkénti render) a hívóé; itt csak a determinista terv él.
 */
import { PLATFORM_PRESETS, type ExportPlatform, type RenderSettings } from '@/lib/render';

export interface BatchExportJob {
  /** a job által lefedett platformok (az összevonás miatt több is lehet) */
  platforms: ExportPlatform[];
  /** ember-olvasható címke (a lefedett platformok neve, pl. „TikTok · Reels · Shorts") */
  label: string;
  /** a kényszerített vászon-arány ehhez a kimenethez (a preset aspect-je) */
  aspect: string;
  /** a base fölé merge-elt render-beállítás (a preset nyer) */
  settings: RenderSettings;
}

/** stabil kulcs az azonos kimenetek összevonásához (aspect + a settings rendezett JSON-ja) */
function jobKey(aspect: string, settings: RenderSettings): string {
  const rec = settings as unknown as Record<string, unknown>;
  const sorted = Object.keys(rec)
    .sort()
    .reduce<Record<string, unknown>>((o, k) => {
      o[k] = rec[k];
      return o;
    }, {});
  return `${aspect}|${JSON.stringify(sorted)}`;
}

/**
 * A kiválasztott platformokból deduplikált render-job-lista. A bemeneti sorrend stabil;
 * az azonos (aspect+settings) platformok EGY jobba vonódnak (a címke a neveket összefűzi).
 * Üres/ismeretlen bemenet → üres lista.
 */
export function planBatchExport(platforms: ExportPlatform[], base: RenderSettings): BatchExportJob[] {
  const byKey = new Map<string, BatchExportJob>();
  for (const p of platforms) {
    const preset = PLATFORM_PRESETS[p];
    if (!preset) {
      continue;
    }
    const settings: RenderSettings = { ...base, ...preset.settings };
    const key = jobKey(preset.aspect, settings);
    const existing = byKey.get(key);
    if (existing) {
      existing.platforms.push(p);
      existing.label += ` · ${preset.label}`;
    } else {
      byKey.set(key, { platforms: [p], label: preset.label, aspect: preset.aspect, settings });
    }
  }
  return [...byKey.values()];
}

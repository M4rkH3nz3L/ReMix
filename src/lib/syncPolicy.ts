/**
 * 📶 Szinkron-szabályok — PURE mag (expo-mentes, tesztelhető).
 *
 * „Automatikus szinkron csak Wi-Fi-n” (alap: BE): a mentés utáni automatikus
 * projekt-szinkron mobilneten VÁR (Wi-Fi-re váltáskor indul). A user kézi művelete
 * (feltöltés, „Szinkronizálás most”) mindig mehet. Ismeretlen hálózat (pl. a régi
 * app-build még nem ismeri a hálózat-modult) → engedjük, ne akadjon el semmi.
 */

export type ConnectionKind = 'wifi' | 'cellular' | 'none' | 'unknown';

export interface SyncPrefs {
  /** az AUTOMATIKUS szinkron csak Wi-Fi-n (vagy vezetékes hálózaton) fut */
  wifiOnly: boolean;
}

export const DEFAULT_SYNC_PREFS: SyncPrefs = { wifiOnly: true };

/** A tárolt beállítás beolvasása (hiányzó/sérült mező → alapérték). */
export function parseSyncPrefs(raw: string | null | undefined): SyncPrefs {
  try {
    const o = raw ? (JSON.parse(raw) as Partial<SyncPrefs>) : {};
    return { wifiOnly: typeof o.wifiOnly === 'boolean' ? o.wifiOnly : DEFAULT_SYNC_PREFS.wifiOnly };
  } catch {
    return { ...DEFAULT_SYNC_PREFS };
  }
}

/**
 * Indulhat-e most egy szinkron-kör: `run` / `offline` (nincs hálózat) /
 * `waitWifi` (automatikus kör mobilneten, Wi-Fi-only mellett).
 */
export function syncDecision(
  conn: ConnectionKind,
  prefs: SyncPrefs,
  manual: boolean
): 'run' | 'offline' | 'waitWifi' {
  if (conn === 'none') {
    return 'offline';
  }
  if (!manual && prefs.wifiOnly && conn === 'cellular') {
    return 'waitWifi';
  }
  return 'run';
}

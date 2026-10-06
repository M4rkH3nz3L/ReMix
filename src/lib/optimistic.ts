/**
 * ⚡ Optimista UI-frissítés egységes mintája (audit §12.4).
 *
 * A gyors interakciók (like/mentés/követés/vásárlás) AZONNAL frissítik a UI-t,
 * majd a szerver-hívás a háttérben fut. HIBÁNÁL vissza kell görgetni — különben
 * az UI a szerverrel ELLENTÉTES állapotot mutat a következő frissítésig (a user
 * azt hiszi, lájkolt/követ, pedig nem). Eddig ez képernyőnként ad-hoc `catch`-ekkel
 * (vagy sehogy) volt megoldva; ez a közös, tesztelt mag.
 *
 * Tiszta + keretrendszer-független: a React-state-et a `apply`/`rollback`
 * callbackek zárják be, így a mag önmagában tesztelhető (mockolt callbackek).
 */
export interface OptimisticOptions<T> {
  /** azonnali UI-állapot (optimista) */
  apply: () => void;
  /** visszagörgetés a hiba esetére (a `apply` inverze) */
  rollback: () => void;
  /** a szerver-hívás, ami megerősíti vagy elbuktatja az optimista állapotot */
  commit: () => Promise<T>;
  /** opcionális: hiba-kezelés a rollback UTÁN (pl. toast) */
  onError?: (error: unknown) => void;
  /** opcionális: siker-kezelés (pl. a szerver által visszaadott pontos érték) */
  onSuccess?: (result: T) => void;
}

/**
 * Lefuttatja az optimista mintát: `apply()` azonnal, majd `commit()`; hibánál
 * `rollback()` + `onError`, sikernél `onSuccess`. A visszatérés `true`, ha a
 * commit sikerült (nem volt rollback), `false`, ha elbukott. Soha nem dob — a
 * hibát a `rollback`/`onError` nyeli el (fire-and-forget hívható `void`-dal).
 */
export async function runOptimistic<T>(opts: OptimisticOptions<T>): Promise<boolean> {
  opts.apply();
  try {
    const result = await opts.commit();
    opts.onSuccess?.(result);
    return true;
  } catch (error) {
    opts.rollback();
    opts.onError?.(error);
    return false;
  }
}

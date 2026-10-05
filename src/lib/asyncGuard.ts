/**
 * 🛡️ Async race-védelem (audit §12.5) — tiszta, expo-mentes mag.
 *
 * Gyakori hiba: egy async művelet (keresés, betöltés, AI-hívás) válasza AKKOR fut
 * be, amikor már egy ÚJABB hívás van folyamatban, vagy a komponens már unmountolt
 * — és a stale válasz felülírja a frisset / megsérült állapotot ír. Ez a modul két
 * primitívet ad erre (generáció-token + alive-guard), plusz egy „csak a legfrissebb
 * nyer" wrappert. Mind szinkron + determinisztikus → egyszerűen tesztelhető.
 */

export interface GenerationGuard {
  /** Új generáció indítása → a hozzá tartozó token. A korábbiak elavulnak. */
  begin: () => number;
  /** Aktuális-e még ez a token (nem indult-e közben újabb `begin`/`cancel`). */
  isCurrent: (token: number) => boolean;
  /** A jelenlegi generáció érvénytelenítése — minden függőben lévő token elavul. */
  cancel: () => void;
}

/**
 * Generáció-guard: az async válaszok közül CSAK a legfrissebbet fogadjuk el.
 *
 * ```ts
 * const guard = createGenerationGuard();
 * async function load(q: string) {
 *   const token = guard.begin();
 *   const data = await search(q);
 *   if (!guard.isCurrent(token)) return; // elavult → eldobjuk
 *   setResults(data);
 * }
 * ```
 */
export function createGenerationGuard(): GenerationGuard {
  let current = 0;
  return {
    begin: () => {
      current += 1;
      return current;
    },
    isCurrent: (token) => token === current,
    // új (üres) generáció → minden eddigi token elavul, de egy frissen kért
    // begin() sem egyezik a cancel előtti tokennel
    cancel: () => {
      current += 1;
    },
  };
}

export interface AliveGuard {
  /** Él-e még (nem hívták-e meg a `cancel`-t — pl. komponens-unmount). */
  alive: () => boolean;
  /** Leállítás (a késői válaszokat ezután eldobjuk). Idempotens. */
  cancel: () => void;
}

/**
 * Alive-guard: életciklus-jelző (React effect cleanup mintára). A `cancel` után a
 * beérkező async eredményeket a hívó eldobhatja.
 *
 * ```ts
 * useEffect(() => {
 *   const g = createAliveGuard();
 *   fetchData().then((d) => { if (g.alive()) setState(d); });
 *   return g.cancel;
 * }, []);
 * ```
 */
export function createAliveGuard(): AliveGuard {
  let living = true;
  return {
    alive: () => living,
    cancel: () => {
      living = false;
    },
  };
}

/** A `latestOnly` által elavultként eldobott hívás hibája (a hívó csendben elnyelheti). */
export class StaleResponseError extends Error {
  constructor() {
    super('stale-response: egy újabb hívás megelőzte');
    this.name = 'StaleResponseError';
  }
}

/**
 * Egy async függvény „csak a legfrissebb nyer" wrappere: ha egy újabb hívás indul,
 * mielőtt egy korábbi befejeződne, a korábbi promise `StaleResponseError`-ral REJECT-el
 * (nem a stale értéket adja vissza). Így a hívó-oldali állapot sosem íródik felül régi
 * adattal. A `fn` tényleges futása nem szakad meg (nincs AbortSignal), csak az eredménye
 * dobódik el — I/O-leállításhoz használd a `signal`-alapú utat (pl. nativeRender).
 */
export function latestOnly<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  let seq = 0;
  return (...args: A): Promise<R> => {
    seq += 1;
    const mine = seq;
    return fn(...args).then((value) => {
      if (mine !== seq) {
        throw new StaleResponseError();
      }
      return value;
    });
  };
}

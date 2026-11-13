/**
 * 🧪 Fejlesztői akció-regiszter a füstteszthez: a képernyő a saját gombjai mögötti függvényeket
 * itt regisztrálja, a teszt ugyanezeket hívja (gombnyomás helyett). Csak `__DEV__`-ben él.
 */
type Action = (arg?: unknown) => unknown;
const actions = new Map<string, Action>();

/**
 * a füstteszt él-e: dev-buildben mindig; release-ben CSAK a kifejezetten mérésre készült buildben
 * (`EXPO_PUBLIC_RELEASE_SMOKE=1` a build idején) — a kiadott appban nincs hatása
 */
export const smokeEnabled = (): boolean => (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_RELEASE_SMOKE === '1';

const enabled = smokeEnabled;

export function registerDevAction(name: string, fn: Action): () => void {
  if (!enabled()) {
    return () => {};
  }
  actions.set(name, fn);
  return () => {
    if (actions.get(name) === fn) {
      actions.delete(name);
    }
  };
}

export function runDevAction(name: string, arg?: unknown): unknown {
  return actions.get(name)?.(arg);
}

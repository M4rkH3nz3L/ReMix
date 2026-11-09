/**
 * 🧪 Fejlesztői akció-regiszter a füstteszthez: a képernyő a saját gombjai mögötti függvényeket
 * itt regisztrálja, a teszt ugyanezeket hívja (gombnyomás helyett). Csak `__DEV__`-ben él.
 */
type Action = (arg?: unknown) => unknown;
const actions = new Map<string, Action>();

const enabled = () => typeof __DEV__ !== 'undefined' && __DEV__;

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

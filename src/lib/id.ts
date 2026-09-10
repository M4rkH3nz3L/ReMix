let counter = 0;

/** Egyszerű, ütközésbiztos kliens-oldali azonosító. */
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/**
 * 🔗 Link-csoportok összeolvasztása (#59): az új csoport magába szívja azokat a meglévő
 * csoportokat, amelyekkel közös klipje van; a többi csoport változatlan marad. Pure.
 */
export function mergeLinkGroup(links: string[][] | undefined, ids: string[]): string[][] {
  const merged = new Set<string>(ids);
  const rest = (links ?? []).filter((g) => {
    if (g.some((id) => merged.has(id))) {
      g.forEach((id) => merged.add(id));
      return false;
    }
    return true;
  });
  return [...rest, [...merged]];
}

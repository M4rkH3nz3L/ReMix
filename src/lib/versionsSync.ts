import type { ProjectVersion } from '@/lib/storage';

/**
 * 🕓 Verzió-szinkron — tiszta mag. A LOKÁLIS verzió-pillanatképek
 * (`ProjectVersion`, max 20/projekt) a forrás-igazság; a felhő
 * (`cloud_project_versions`) a KÉZI (manual) snapshotok tükre — az auto-verziók
 * zaj lennének a felhőben, azok lokálisak maradnak. A push idempotens (csak a
 * felhőből hiányzó kerül fel), a lista-nézet a kettő UNIÓJA: a csak-felhőben
 * élő verzió (pl. másik eszközről) ☁️-jelölést kap, és letöltéssel áll vissza.
 * Expo-mentes → önmagában tesztelt; a hálózat a `cloudSync.ts`-ben.
 */

/** a felhő-verzió lista-metája (a `data` nélkül — az csak visszaállításkor jön) */
export interface CloudVersionMeta {
  versionId: string;
  name: string;
  at: string;
  kind: 'manual' | 'auto';
}

/** a verzió-lista egységes nézet-eleme (lokális és/vagy felhő) */
export interface VersionListItem {
  id: string;
  name: string;
  at: string;
  kind: 'manual' | 'auto';
  /** van lokális példánya (azonnal visszaállítható) */
  local?: ProjectVersion;
  /** van felhő-példánya (eszközváltás után is él) */
  inCloud: boolean;
}

/** Mely lokális verziók szorulnak feltöltésre: KÉZI + még nincs a felhőben. */
export function pickVersionsToPush(
  local: readonly ProjectVersion[],
  cloudIds: ReadonlySet<string>,
): ProjectVersion[] {
  return local.filter((v) => v.kind !== 'auto' && !cloudIds.has(v.id));
}

/** A lokális + felhő-verziók egyesített, idő-rendezett lista-nézete. */
export function mergeVersionLists(
  local: readonly ProjectVersion[],
  cloud: readonly CloudVersionMeta[],
): VersionListItem[] {
  const byId = new Map<string, VersionListItem>();
  for (const v of local) {
    byId.set(v.id, {
      id: v.id,
      name: v.name,
      at: v.at,
      kind: v.kind === 'auto' ? 'auto' : 'manual',
      local: v,
      inCloud: false,
    });
  }
  for (const c of cloud) {
    const existing = byId.get(c.versionId);
    if (existing) {
      existing.inCloud = true;
    } else {
      byId.set(c.versionId, {
        id: c.versionId,
        name: c.name,
        at: c.at,
        kind: c.kind,
        inCloud: true,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}

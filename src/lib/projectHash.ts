import type { Project } from '@/types/project';

/**
 * 🔑 Render-cache kulcs: a projekt RENDER-RELEVÁNS tartalmának determinisztikus
 * hash-e. A volatilis/nem-render mezőket kihagyjuk (updatedAt, rendered,
 * createdAt, name), így csak a tényleges vágás/klip/asset változás érvényteleníti
 * a cache-t. A kulcshoz a render-beállítás is hozzáadódik (felbontás/fps/…).
 */

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Kulcs-rendezett JSON — a mezők beszúrási sorrendje ne befolyásolja a hasht. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function projectRenderHash(project: Project): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(project)) {
    if (k === 'updatedAt' || k === 'rendered' || k === 'createdAt' || k === 'name') {
      continue;
    }
    rest[k] = v;
  }
  return hashString(stableStringify(rest));
}

/** Render-cache kulcs a projektből + a render-beállításból. */
export function renderCacheKey(project: Project, settings: unknown): string {
  return `${projectRenderHash(project)}_${hashString(stableStringify(settings ?? {}))}`;
}

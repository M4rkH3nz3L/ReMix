/**
 * 🌳 Poszt-remix-lineage (audit §4.7) — tiszta, expo-mentes.
 *
 * A feed-posztok `remixOfId` (a szülő-poszt) linkjeiből egy remix-FÁT épít: ki
 * miből készült (attribúció-badge), egy posztnak hány leszármazottja van (mennyire
 * „terjedt"), és milyen mély a lánc. A [creativeGraph.ts](./creativeGraph.ts) ettől
 * KÜLÖN az AI-kontextus (asset/projekt) gráfja — ez kifejezetten a feed-remixé.
 *
 * Minden bejárás CIKLUS-BIZTOS (a rossz/köröző adat nem végtelen ciklus), és a
 * halmazon kívülre mutató szülő gyökérnek számít ebben a nézetben.
 */

export interface RemixLink {
  id: string;
  /** a szülő-poszt id-ja (null/undefined = eredeti, nincs szülő) */
  remixOfId?: string | null;
  creatorId?: string | null;
}

export interface RemixGraph {
  byId: Map<string, RemixLink>;
  /** szülő-id → gyerek-id-k (beszúrási sorrendben) */
  children: Map<string, string[]>;
  /** gyökerek: nincs (ismert) szülő a halmazban */
  roots: string[];
}

export function buildRemixGraph(links: readonly RemixLink[]): RemixGraph {
  const byId = new Map<string, RemixLink>();
  for (const l of links) {
    if (l && l.id) {
      byId.set(l.id, l);
    }
  }
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const l of links) {
    if (!l || !l.id) {
      continue;
    }
    const parent = l.remixOfId;
    if (parent && byId.has(parent) && parent !== l.id) {
      const arr = children.get(parent) ?? [];
      arr.push(l.id);
      children.set(parent, arr);
    } else {
      // nincs szülő, önmagára mutat, VAGY a szülő nincs a halmazban → gyökér
      roots.push(l.id);
    }
  }
  return { byId, children, roots };
}

/** A közvetlen szülőtől a gyökérig vezető lánc (önmaga NÉLKÜL), ciklus-biztosan. */
export function ancestorChain(g: RemixGraph, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let cur = g.byId.get(id)?.remixOfId ?? null;
  while (cur && g.byId.has(cur) && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = g.byId.get(cur)?.remixOfId ?? null;
  }
  return out;
}

/** Az összes leszármazott id-ja (a csomópont alatti teljes remix-fa), ciklus-biztosan. */
export function descendants(g: RemixGraph, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(g.children.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop() as string;
    if (seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(n);
    stack.push(...(g.children.get(n) ?? []));
  }
  return out;
}

/** Hány remix származik (közvetlenül vagy közvetve) ebből a posztból. */
export function descendantCount(g: RemixGraph, id: string): number {
  return descendants(g, id).length;
}

/** A közvetlen remixek száma (csak az első szint). */
export function directRemixCount(g: RemixGraph, id: string): number {
  return (g.children.get(id) ?? []).length;
}

/** Hány remix-lépés választja el az eredetitől (0 = ez az eredeti/gyökér). */
export function remixDepth(g: RemixGraph, id: string): number {
  return ancestorChain(g, id).length;
}

export interface Attribution {
  /** a lineage GYÖKERE (az eredeti mű) — lehet maga is, ha nincs szülő */
  originalId: string;
  originalCreatorId: string | null;
  /** remix-mélység az eredetihez képest (0 = ez az eredeti) */
  depth: number;
}

/** Egy poszt forrás-attribúciója (az eredeti mű + alkotója + a lánc hossza) — a badge-hez. */
export function attribution(g: RemixGraph, id: string): Attribution | null {
  if (!g.byId.has(id)) {
    return null;
  }
  const chain = ancestorChain(g, id);
  const originalId = chain.length ? chain[chain.length - 1] : id;
  return {
    originalId,
    originalCreatorId: g.byId.get(originalId)?.creatorId ?? null,
    depth: chain.length,
  };
}

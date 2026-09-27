import type { AssetKind, LibraryAsset } from '@/lib/assetLibrary';
import type { Project } from '@/types/project';

/**
 * 🧬 Creative Graph (PM1 — MASTER §26) — a creator világának kapcsolati gráfja:
 * Person → Project → {Video/Audio/Image/Design} → Asset/Brand/Template/Music,
 * remix-lineage-dzsel. Ez adja az AI-nak a „ténylegesen érti a creator világát"
 * réteget, és válaszol a headline-kérdésekre:
 *   • „Hol használtam ezt a logót?"  → `projectsUsingAsset`
 *   • „Mely projektek használják ezt a zenét?"  → `projectsUsingAsset`
 *   • „Miből készült ez a remix?"  → `lineage`
 *
 * Tiszta, szerializálható (sima tömbök), immutábilis reducer — expo-mentes,
 * önmagában tesztelhető. Épít a projekt-modell `remixOf`-lineage-ére és az
 * Asset Library `usage`-ére (a lapos usage-lista gráf-nézete).
 */

export type NodeType =
  | 'person'
  | 'project'
  | 'video'
  | 'audio'
  | 'image'
  | 'design'
  | 'asset'
  | 'brand'
  | 'template'
  | 'music'
  | 'ai';

export type EdgeType =
  | 'owns' // person → project/asset/brand/template
  | 'uses' // project → asset/music/brand
  | 'remixOf' // project → szülő-project (lineage)
  | 'contains'; // project → al-dokumentum

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
}

export interface CreativeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ── Node-id sémák (domain-prefix → ütközésmentes id-k) ───────────────────────
export const personNode = (id: string): string => `person:${id}`;
export const projectNode = (id: string): string => `project:${id}`;
export const assetNode = (id: string): string => `asset:${id}`;
export const brandNode = (id: string): string => `brand:${id}`;
export const templateNode = (id: string): string => `template:${id}`;

/** asset-típus → gráf-node-típus (a „music"/„image"/… kérdésekhez). */
export function assetNodeType(kind: AssetKind): NodeType {
  switch (kind) {
    case 'music':
      return 'music';
    case 'photo':
      return 'image';
    case 'video':
      return 'video';
    case 'voice':
    case 'sfx':
      return 'audio';
    case 'graphic':
      return 'design';
    case 'ai':
      return 'ai';
    default:
      return 'asset';
  }
}

export function emptyGraph(): CreativeGraph {
  return { nodes: [], edges: [] };
}

/**
 * Node beszúrása/frissítése. Meglévő id-nél a MEGLÉVŐ label marad (az első,
 * „valódi" node nyer a későbbi stub felett), a meta összefésülődik.
 */
export function addNode(g: CreativeGraph, node: GraphNode): CreativeGraph {
  const idx = g.nodes.findIndex((n) => n.id === node.id);
  if (idx === -1) {
    return { ...g, nodes: [...g.nodes, node] };
  }
  const prev = g.nodes[idx];
  const merged: GraphNode = {
    ...prev,
    type: prev.type === 'project' || prev.type === node.type ? prev.type : node.type,
    label: prev.label || node.label,
    ...(prev.meta || node.meta ? { meta: { ...prev.meta, ...node.meta } } : {}),
  };
  const nodes = g.nodes.slice();
  nodes[idx] = merged;
  return { ...g, nodes };
}

export function addEdge(g: CreativeGraph, edge: GraphEdge): CreativeGraph {
  const exists = g.edges.some((e) => e.from === edge.from && e.to === edge.to && e.type === edge.type);
  return exists ? g : { ...g, edges: [...g.edges, edge] };
}

export function node(g: CreativeGraph, id: string): GraphNode | undefined {
  return g.nodes.find((n) => n.id === id);
}

export function nodesOfType(g: CreativeGraph, type: NodeType): GraphNode[] {
  return g.nodes.filter((n) => n.type === type);
}

// ── Bejárás ──────────────────────────────────────────────────────────────────

export interface NeighborOpts {
  edgeType?: EdgeType;
  direction?: 'out' | 'in' | 'both';
}

/** Egy node szomszédai (irány + él-típus szerint szűrve). */
export function neighbors(g: CreativeGraph, id: string, opts: NeighborOpts = {}): GraphNode[] {
  const dir = opts.direction ?? 'both';
  const ids = new Set<string>();
  for (const e of g.edges) {
    if (opts.edgeType && e.type !== opts.edgeType) {
      continue;
    }
    if ((dir === 'out' || dir === 'both') && e.from === id) {
      ids.add(e.to);
    }
    if ((dir === 'in' || dir === 'both') && e.to === id) {
      ids.add(e.from);
    }
  }
  return [...ids].map((nid) => node(g, nid)).filter((n): n is GraphNode => !!n);
}

/** „Mely projektek használják ezt az assetet?" (raw asset-id). */
export function projectsUsingAsset(g: CreativeGraph, assetId: string): GraphNode[] {
  return neighbors(g, assetNode(assetId), { edgeType: 'uses', direction: 'in' }).filter((n) => n.type === 'project');
}

/** „Mely assetek szerepelnek ebben a projektben?" (raw project-id). */
export function assetsUsedInProject(g: CreativeGraph, projectId: string): GraphNode[] {
  return neighbors(g, projectNode(projectId), { edgeType: 'uses', direction: 'out' });
}

/** hány projekt hivatkozza az assetet. */
export function usageCount(g: CreativeGraph, assetId: string): number {
  return projectsUsingAsset(g, assetId).length;
}

/**
 * Remix-lineage: a projekt őseinek lánca (legközelebbi szülő elöl). Ciklus-védett.
 */
export function lineage(g: CreativeGraph, projectId: string): GraphNode[] {
  const chain: GraphNode[] = [];
  const seen = new Set<string>();
  let current = projectNode(projectId);
  seen.add(current);
  for (;;) {
    const parents = neighbors(g, current, { edgeType: 'remixOf', direction: 'out' });
    const parent = parents.find((p) => !seen.has(p.id));
    if (!parent) {
      break;
    }
    chain.push(parent);
    seen.add(parent.id);
    current = parent.id;
  }
  return chain;
}

/** Általános leszármazott-bejárás (BFS) egy él-típus mentén (kifelé). */
export function descendants(g: CreativeGraph, nodeId: string, edgeType: EdgeType): GraphNode[] {
  const out: GraphNode[] = [];
  const seen = new Set<string>([nodeId]);
  let frontier = [nodeId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighbors(g, id, { edgeType, direction: 'out' })) {
        if (seen.has(n.id)) {
          continue;
        }
        seen.add(n.id);
        out.push(n);
        next.push(n.id);
      }
    }
    frontier = next;
  }
  return out;
}

// ── Építés a workspace adataiból ──────────────────────────────────────────────

export interface GraphInput {
  personId?: string;
  personName?: string;
  projects?: Project[];
  /** Asset Library assetjei (a `usage`-ből épülnek a project→asset élek). */
  assets?: LibraryAsset[];
  brands?: { id: string; name: string }[];
  templates?: { id: string; name: string }[];
}

/**
 * A Creative Graph összeállítása a creator workspace-éből. Person birtokolja a
 * projekteket/asseteket/brandeket/sablonokat; a projektek használják az
 * asseteket (a library usage-éből); a remixek a szülőre mutatnak.
 */
export function buildGraph(input: GraphInput): CreativeGraph {
  let g = emptyGraph();
  const owner = input.personId ? personNode(input.personId) : null;
  if (owner) {
    g = addNode(g, { id: owner, type: 'person', label: input.personName ?? input.personId! });
  }

  for (const p of input.projects ?? []) {
    const pid = projectNode(p.id);
    g = addNode(g, { id: pid, type: 'project', label: p.name, meta: { kind: p.kind ?? 'video' } });
    if (owner) {
      g = addEdge(g, { from: owner, to: pid, type: 'owns' });
    }
    if (p.remixOf) {
      const parent = projectNode(p.remixOf.projectId);
      g = addNode(g, { id: parent, type: 'project', label: p.remixOf.name });
      g = addEdge(g, { from: pid, to: parent, type: 'remixOf' });
    }
  }

  for (const a of input.assets ?? []) {
    const aid = assetNode(a.id);
    g = addNode(g, { id: aid, type: assetNodeType(a.kind), label: a.name, meta: { kind: a.kind } });
    if (owner) {
      g = addEdge(g, { from: owner, to: aid, type: 'owns' });
    }
    for (const projId of a.usage) {
      const pid = projectNode(projId);
      g = addNode(g, { id: pid, type: 'project', label: projId });
      g = addEdge(g, { from: pid, to: aid, type: 'uses' });
    }
  }

  for (const b of input.brands ?? []) {
    const bid = brandNode(b.id);
    g = addNode(g, { id: bid, type: 'brand', label: b.name });
    if (owner) {
      g = addEdge(g, { from: owner, to: bid, type: 'owns' });
    }
  }

  for (const t of input.templates ?? []) {
    const tid = templateNode(t.id);
    g = addNode(g, { id: tid, type: 'template', label: t.name });
    if (owner) {
      g = addEdge(g, { from: owner, to: tid, type: 'owns' });
    }
  }

  return g;
}

/**
 * 📊 CSWCR — Cross-Studio Workflow Completion Rate (ReMix.md 7. · 11. F1 · AUDIO-PROD C5) — pure mag.
 *
 * A fő mérőszám: a befejezett, többstúdiós, külső eszköz nélküli projekt-láncok aránya az elkezdett
 * többstúdiós láncokhoz képest. MINDEN a telefonon számol (7.3): az események helyben keletkeznek,
 * a lánc a projektek hivatkozásaiból (linked asset `source`, `remixOf`) áll össze. Kifelé semmi —
 * a hozzájárulásos, összesített számláló az F1 közös része, nem ennek a magnak a dolga.
 *
 * Fogalmak (7.2):
 *  • lánc = a hivatkozásokkal összekötött projektek (összefüggő komponens);
 *  • többstúdiós = a láncban legalább két különböző stúdió-fajta szerkesztett;
 *  • elkezdett = a második stúdió-fajta első szerkesztése a láncon;
 *  • befejezett = export, poszt vagy `.rp`-csomag a lánc bármely projektjén az elkezdés után;
 *  • külső eszköz = kész, ReMixben is előállítható kimenet importja a lánc közepén (`external`);
 *    a nyersanyag-import nem számít.
 * Kísérő mutató (7.4): link-arány = a stúdiók közti átadások hány %-a hivatkozás (nem másolat).
 */

export type StudioKind = 'video' | 'image' | 'audio' | 'model3d' | 'live' | 'music' | 'design' | 'motion';

export type CswcrEventType =
  /** a stúdió megnyitotta és szerkesztette a projektet (egy esemény megnyitásonként elég) */
  | 'edit'
  /** átadás egy másik stúdióba: `via` hivatkozás vagy másolat, `toProjectId` a cél */
  | 'handoff'
  /** a „Frissítés elérhető" elfogadása (a hivatkozás él a gyakorlatban) */
  | 'relink'
  | 'export'
  | 'post'
  | 'package'
  /** import; `external: true` = kész kimenet kívülről (lánc-megszakítás), különben nyersanyag */
  | 'import';

export interface CswcrEvent {
  /** ISO idő */
  at: string;
  type: CswcrEventType;
  projectId: string;
  kind: StudioKind;
  via?: 'link' | 'copy';
  toProjectId?: string;
  external?: boolean;
}

export const CSWCR_LOG_MAX = 5000;

/** esemény a naplóba (új tömb; a napló felső korlátja a legrégebbiek elhagyásával) */
export function recordEvent(log: readonly CswcrEvent[], e: CswcrEvent, max = CSWCR_LOG_MAX): CswcrEvent[] {
  const next = [...log, e];
  return next.length > max ? next.slice(next.length - max) : next;
}

export interface LinkRatio {
  link: number;
  copy: number;
  /** 0–1, vagy null, ha még nem volt átadás */
  ratio: number | null;
}

/** a stúdiók közti átadások hány része hivatkozás (7.4 link-arány; cél 100 %) */
export function linkRatio(log: readonly CswcrEvent[]): LinkRatio {
  let link = 0;
  let copy = 0;
  for (const e of log) {
    if (e.type !== 'handoff') continue;
    if (e.via === 'link') link++;
    else copy++;
  }
  const total = link + copy;
  return { link, copy, ratio: total > 0 ? link / total : null };
}

export interface ChainProject {
  id: string;
  kind: StudioKind;
  /** a projektek, amelyekre ez hivatkozik (linked asset forrása, remix-eredet) */
  links: readonly string[];
}

/** a projektek összefüggő láncai (union-find a hivatkozás-éleken); az eredmény rendezett, determinisztikus */
export function chains(projects: readonly ChainProject[]): string[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    // útvonal-tömörítés
    let c = x;
    while (parent.get(c) !== undefined && parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (const p of projects) {
    if (!parent.has(p.id)) parent.set(p.id, p.id);
    for (const l of p.links) {
      if (!parent.has(l)) parent.set(l, l);
      union(p.id, l);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of [...parent.keys()].sort()) {
    const r = find(id);
    const g = groups.get(r) ?? [];
    g.push(id);
    groups.set(r, g);
  }
  return [...groups.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

export interface FlowStats {
  /** láncok száma összesen */
  chains: number;
  /** legalább két stúdió-fajta szerkesztett benne */
  multiStudio: number;
  /** elkezdett többstúdiós láncok (a második stúdió első szerkesztése megtörtént) */
  started: number;
  /** elkezdett ÉS befejezett (export / poszt / csomag az elkezdés után), külső kimenet nélkül */
  completed: number;
  /** completed / started, vagy null, ha nincs elkezdett lánc */
  cswcr: number | null;
  /** a „Frissítés elérhető" elfogadásai (7.4 frissítés-elfogadás számlálója) */
  relinks: number;
}

const FINISHING: ReadonlySet<CswcrEventType> = new Set(['export', 'post', 'package']);

/** a CSWCR a láncokból és a helyi eseménynaplóból (minden a telefonon) */
export function flowStats(projects: readonly ChainProject[], log: readonly CswcrEvent[]): FlowStats {
  const kindOf = new Map(projects.map((p) => [p.id, p.kind] as const));
  const byProject = new Map<string, CswcrEvent[]>();
  for (const e of log) {
    const list = byProject.get(e.projectId) ?? [];
    list.push(e);
    byProject.set(e.projectId, list);
  }
  let multiStudio = 0;
  let started = 0;
  let completed = 0;
  const all = chains(projects);
  for (const chain of all) {
    const events = chain
      .flatMap((id) => byProject.get(id) ?? [])
      .sort((a, b) => a.at.localeCompare(b.at));
    // többstúdiós: két különböző fajta szerkesztett (a projekt fajtája az esemény fajtája)
    const kinds = new Set<StudioKind>();
    let startedAt: string | null = null;
    let finishedAfterStart = false;
    let externalAfterStart = false;
    for (const e of events) {
      const k = e.kind ?? kindOf.get(e.projectId);
      if (e.type === 'edit' && k) {
        kinds.add(k);
        if (kinds.size >= 2 && startedAt === null) startedAt = e.at;
      }
      if (startedAt !== null && e.at >= startedAt) {
        if (FINISHING.has(e.type)) finishedAfterStart = true;
        if (e.type === 'import' && e.external) externalAfterStart = true;
      }
    }
    if (kinds.size >= 2) multiStudio++;
    if (startedAt !== null) {
      started++;
      if (finishedAfterStart && !externalAfterStart) completed++;
    }
  }
  const relinks = log.filter((e) => e.type === 'relink').length;
  return { chains: all.length, multiStudio, started, completed, cswcr: started > 0 ? completed / started : null, relinks };
}

/** a projekt hivatkozásai a lánchoz: linked asset forrás-projektek + remix-eredet */
export function chainProjectOf(p: {
  id: string;
  kind?: string;
  assets?: readonly { source?: { projectId: string } }[];
  remixOf?: { projectId: string };
}): ChainProject {
  const links = new Set<string>();
  for (const a of p.assets ?? []) if (a.source?.projectId) links.add(a.source.projectId);
  if (p.remixOf?.projectId) links.add(p.remixOf.projectId);
  return { id: p.id, kind: (p.kind as StudioKind) ?? 'video', links: [...links].sort() };
}

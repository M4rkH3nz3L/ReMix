/**
 * 🔄 Globális verziókövetés (E-Versions — MASTER §18) — MINDEN alkotótípusnak
 * közös állapotgép + verzió-verem: Draft → Review → Approved → Published →
 * Archived, v1/v2/v3, és a diff/restore/duplicate/branch/compare/approve
 * műveletek. Domain-AGNOSZTIKUS: a verzió egy `ref`-et (snapshot-azonosító /
 * hash) hordoz; a TARTALMI diff a típus-specifikus modulé (video: versionDiff,
 * code: codeDiff, …). Ez a KÖZÖS állapot- és lineage-réteg.
 *
 * Tiszta, expo-mentes, immutábilis, determinisztikus (`makeId`/`now` injektálva).
 */

export type VersionStatus = 'draft' | 'review' | 'approved' | 'published' | 'archived';

export const VERSION_STATUSES: VersionStatus[] = ['draft', 'review', 'approved', 'published', 'archived'];

/** engedélyezett állapot-átmenetek (a jóváhagyási munkafolyamat). */
const TRANSITIONS: Record<VersionStatus, VersionStatus[]> = {
  draft: ['review', 'archived'],
  review: ['approved', 'draft', 'archived'],
  approved: ['published', 'draft', 'archived'],
  published: ['archived', 'draft'], // újranyitás javításra
  archived: ['draft'], // visszaállítás archívumból
};

export function canTransition(from: VersionStatus, to: VersionStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: VersionStatus): VersionStatus[] {
  return TRANSITIONS[from];
}

export interface VersionEntry {
  id: string;
  /** v1, v2, … (automatikus) */
  label: string;
  status: VersionStatus;
  /** tetszőleges tartalom-referencia (snapshot-id / hash) — domain-agnosztikus */
  ref?: string;
  note?: string;
  /** duplicate/branch/restore szülő-verzió id-ja (lineage) */
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VersionHistory {
  versions: VersionEntry[];
  /** az aktuálisan kiválasztott verzió id-ja */
  currentId: string | null;
}

export function emptyHistory(): VersionHistory {
  return { versions: [], currentId: null };
}

/** a következő címke (v{max+1}) a meglévő címkékből. */
function nextLabel(history: VersionHistory): string {
  let max = 0;
  for (const v of history.versions) {
    const m = /^v(\d+)$/.exec(v.label);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return `v${max + 1}`;
}

export interface AddVersionInput {
  ref?: string;
  note?: string;
  status?: VersionStatus;
  parentId?: string;
}

/** Új verzió (auto-címkével), és beállítja aktuálisnak. */
export function addVersion(
  history: VersionHistory,
  input: AddVersionInput,
  makeId: () => string,
  now: string
): VersionHistory {
  const entry: VersionEntry = {
    id: makeId(),
    label: nextLabel(history),
    status: input.status ?? 'draft',
    ...(input.ref !== undefined ? { ref: input.ref } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.parentId ? { parentId: input.parentId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return { versions: [...history.versions, entry], currentId: entry.id };
}

function mapVersion(history: VersionHistory, id: string, fn: (v: VersionEntry) => VersionEntry): VersionHistory {
  let changed = false;
  const versions = history.versions.map((v) => {
    if (v.id !== id) {
      return v;
    }
    changed = true;
    return fn(v);
  });
  return changed ? { ...history, versions } : history;
}

/**
 * Állapot-átmenet — CSAK ha engedélyezett (`canTransition`), különben változatlan.
 * A jóváhagyási workflow motorja.
 */
export function setStatus(history: VersionHistory, id: string, status: VersionStatus, now: string): VersionHistory {
  const v = history.versions.find((x) => x.id === id);
  if (!v || !canTransition(v.status, status)) {
    return history;
  }
  return mapVersion(history, id, (x) => ({ ...x, status, updatedAt: now }));
}

/** Kényelmi: jóváhagyás / publikálás. */
export const approveVersion = (h: VersionHistory, id: string, now: string): VersionHistory => setStatus(h, id, 'approved', now);
export const publishVersion = (h: VersionHistory, id: string, now: string): VersionHistory => setStatus(h, id, 'published', now);
export const archiveVersion = (h: VersionHistory, id: string, now: string): VersionHistory => setStatus(h, id, 'archived', now);

export function setCurrent(history: VersionHistory, id: string): VersionHistory {
  return history.versions.some((v) => v.id === id) ? { ...history, currentId: id } : history;
}

export function updateNote(history: VersionHistory, id: string, note: string, now: string): VersionHistory {
  return mapVersion(history, id, (v) => ({ ...v, note, updatedAt: now }));
}

/**
 * Duplikálás/branch: a forrás `ref`-jéből ÚJ DRAFT verzió (parent = forrás),
 * és aktuálissá válik. (A „branch" és a „duplicate" ugyanaz a lineage-művelet.)
 */
export function duplicateVersion(history: VersionHistory, id: string, makeId: () => string, now: string): VersionHistory {
  const src = history.versions.find((v) => v.id === id);
  if (!src) {
    return history;
  }
  return addVersion(history, { ref: src.ref, parentId: src.id, note: `branch of ${src.label}` }, makeId, now);
}

/**
 * Visszaállítás: egy régi verzió `ref`-jéből ÚJ DRAFT (nem-destruktív — a
 * történet megmarad), parent = a visszaállított verzió, és aktuálissá válik.
 */
export function restoreVersion(history: VersionHistory, id: string, makeId: () => string, now: string): VersionHistory {
  const src = history.versions.find((v) => v.id === id);
  if (!src) {
    return history;
  }
  return addVersion(history, { ref: src.ref, parentId: src.id, note: `restored from ${src.label}` }, makeId, now);
}

/** Verzió törlése (a currentId-t a legutolsóra állítja, ha az esett ki). */
export function removeVersion(history: VersionHistory, id: string): VersionHistory {
  const versions = history.versions.filter((v) => v.id !== id);
  if (versions.length === history.versions.length) {
    return history;
  }
  const currentId = history.currentId === id ? versions[versions.length - 1]?.id ?? null : history.currentId;
  return { versions, currentId };
}

// ── Lekérdezések ──────────────────────────────────────────────────────────────

export function currentVersion(history: VersionHistory): VersionEntry | null {
  return history.versions.find((v) => v.id === history.currentId) ?? null;
}

export function versionById(history: VersionHistory, id: string): VersionEntry | undefined {
  return history.versions.find((v) => v.id === id);
}

/** A legutóbbi adott státuszú verzió (pl. az utolsó „published"). */
export function latestByStatus(history: VersionHistory, status: VersionStatus): VersionEntry | null {
  for (let i = history.versions.length - 1; i >= 0; i--) {
    if (history.versions[i].status === status) {
      return history.versions[i];
    }
  }
  return null;
}

/** Egy verzió lineage-e: az ősök lánca (legközelebbi szülő elöl), ciklus-védve. */
export function lineage(history: VersionHistory, id: string): VersionEntry[] {
  const chain: VersionEntry[] = [];
  const seen = new Set<string>([id]);
  let cur = history.versions.find((v) => v.id === id);
  while (cur?.parentId && !seen.has(cur.parentId)) {
    const parent = history.versions.find((v) => v.id === cur!.parentId);
    if (!parent) {
      break;
    }
    chain.push(parent);
    seen.add(parent.id);
    cur = parent;
  }
  return chain;
}

export interface VersionComparison {
  from: VersionEntry;
  to: VersionEntry;
  statusChanged: boolean;
  /** azonos-e a tartalom-referencia (ha igen, nincs tartalmi változás) */
  sameRef: boolean;
}

/**
 * Két verzió META-összehasonlítása (státusz + ref-azonosság). A TARTALMI diff a
 * típus-specifikus modulé (a `from.ref`/`to.ref` snapshotokból).
 */
export function compareVersions(history: VersionHistory, fromId: string, toId: string): VersionComparison | null {
  const from = history.versions.find((v) => v.id === fromId);
  const to = history.versions.find((v) => v.id === toId);
  if (!from || !to) {
    return null;
  }
  return { from, to, statusChanged: from.status !== to.status, sameRef: from.ref === to.ref };
}

export function statusCounts(history: VersionHistory): Record<VersionStatus, number> {
  const out = Object.fromEntries(VERSION_STATUSES.map((s) => [s, 0])) as Record<VersionStatus, number>;
  for (const v of history.versions) {
    out[v.status]++;
  }
  return out;
}

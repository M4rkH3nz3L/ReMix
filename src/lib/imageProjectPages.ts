/**
 * 🖼️📄 Kép-projekt LAPOK (TECH-TOP §2.2) — pure + tesztelt.
 *
 * A kép-projekt egy GALÉRIA: több, külön szerkeszthető `ImageDoc` (lap) a
 * `project.imageDocs`-ban. Ez a mag a lapok sorrend-/duplikálás-/index-logikáját adja
 * (a tényleges mutáció a command-buson: `UPSERT_IMAGE_DOC` / `REMOVE_IMAGE_DOC` /
 * `REORDER_IMAGE_DOCS`). SZÁNDÉKOSAN expo-mentes → tesztelhető.
 */
import type { ImageDoc, Project } from '@/types/project';

/** A projekt lapjai (üres tömb, ha nincs). A lista sorrendje = a lap-sorrend. */
export function imagePages(project: Pick<Project, 'imageDocs'>): ImageDoc[] {
  return project.imageDocs ?? [];
}

/** Hány lap van. */
export function pageCount(project: Pick<Project, 'imageDocs'>): number {
  return imagePages(project).length;
}

/** Törölhető-e lap (legalább egynek maradnia kell). */
export function canRemovePage(project: Pick<Project, 'imageDocs'>): boolean {
  return pageCount(project) > 1;
}

/** Egy lap-index a [0, count-1] tartományba szorítva (üres galériára 0). */
export function clampPageIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(index), count - 1));
}

/** A törlés UTÁN melyik lap legyen aktív (a törölt helyén lévő, különben az előző). */
export function pageIndexAfterRemoval(removedIndex: number, countBefore: number): number {
  const countAfter = Math.max(0, countBefore - 1);
  return clampPageIndex(removedIndex, countAfter);
}

/**
 * Lapok ÁTRENDEZÉSE (drag-reorder): a `from` indexű lapot a `to` indexre mozgatja.
 * Érvénytelen/azonos index → az EREDETI tömb-referencia (no-op, history-barát).
 */
export function reorderPages(docs: ImageDoc[], from: number, to: number): ImageDoc[] {
  const n = docs.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) {
    return docs;
  }
  const next = docs.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** A lapok új sorrendje id-lista alapján (a `REORDER_IMAGE_DOCS` command bemenete). */
export function orderIds(docs: ImageDoc[]): string[] {
  return docs.map((d) => d.id);
}

/**
 * Egy lap DUPLIKÁTUMA: új doc-id + „… másolat" név, a renderelt PNG-cache ürítve (a
 * másolatot újra kell rasterizálni). A réteg-fa mély-másolt (a rétegek önálló példányok).
 */
export function duplicatePage(doc: ImageDoc, newId: string): ImageDoc {
  const clone = JSON.parse(JSON.stringify(doc)) as ImageDoc;
  clone.id = newId;
  clone.name = `${doc.name} másolat`;
  delete clone.renderedUri;
  return clone;
}

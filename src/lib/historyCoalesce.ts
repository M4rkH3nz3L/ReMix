import type { EditorCommand } from '@/lib/commands';
import type { ImageDoc, Project } from '@/types/project';

/**
 * 🔗 Undo-összevonás: egy csúszka-HÚZÁS vagy egy gyors léptető-sorozat EGY
 * visszavonási lépés legyen (profi szerkesztő-viselkedés), ne 20–50.
 *
 * MIÉRT: a csúszkák mozgás közben folyamatosan commitolnak (élő előnézet), és
 * minden commit külön history-lépés volt — a Visszavonás így lépésenként húzta
 * vissza a húzást (élő iPhone-teszt, P1).
 *
 * Szabály: két egymást követő parancs összevonható, ha
 *   • UGYANAZ a kulcsa (ugyanaz a cél és ugyanazok a mezők — lásd `coalesceKey`), és
 *   • `COALESCE_WINDOW_MS`-on belül érkezett az előzőhöz képest.
 * Csak a „folytonos" szerkesztések vonhatók össze; a szerkezeti műveletek (vágás,
 * törlés, hozzáadás, mozgatás) kulcsa null → mindig külön lépés.
 */
export const COALESCE_WINDOW_MS = 800;

/**
 * 🖼️ A kép-dokumentum szerkesztésének kulcsa az ELŐZŐ állapothoz mérve: két lépés csak
 * akkor von össze, ha UGYANAZON a rétegen UGYANAZOKAT a mezőket állítja (egy húzás).
 * Szerkezeti változás (réteg hozzáadás / törlés / sorrend) → null: mindig külön lépés.
 * Réteg nem változott, csak doc-szintű mező (pl. csoport-opacitás) → a mezők a kulcs.
 */
function imageDocKey(doc: ImageDoc, label: string | undefined, project: Project | null | undefined): string | null {
  const prev = project?.imageDocs?.find((d) => d.id === doc.id);
  if (!prev) {
    return null;
  }
  const sameOrder =
    prev.layers.length === doc.layers.length && prev.layers.every((l, i) => l.id === doc.layers[i].id);
  if (!sameOrder) {
    return null;
  }
  const fieldsOf = (a: object, b: object) => {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return [...new Set([...Object.keys(ra), ...Object.keys(rb)])]
      .filter((k) => JSON.stringify(ra[k]) !== JSON.stringify(rb[k]))
      .sort();
  };
  const changed = doc.layers.filter((l, i) => JSON.stringify(l) !== JSON.stringify(prev.layers[i]));
  if (changed.length > 1) {
    return null; // több réteg egyszerre (igazítás, tömeges művelet) → önálló lépés
  }
  if (changed.length === 1) {
    const before = prev.layers.find((l) => l.id === changed[0].id)!;
    return `imagedoc:${doc.id}:${changed[0].id}:${fieldsOf(before, changed[0]).join(',')}:${label ?? ''}`;
  }
  const { layers: _a, ...docFields } = doc;
  const { layers: _b, ...prevFields } = prev;
  return `imagedoc:${doc.id}:doc:${fieldsOf(prevFields, docFields).join(',')}:${label ?? ''}`;
}

export function coalesceKey(command: EditorCommand, project?: Project | null): string | null {
  switch (command.type) {
    case 'UPDATE_CLIP':
      // ugyanaz a klip + ugyanazok a mezők (pl. sebesség-húzás ≠ hangerő-húzás)
      return `clip:${command.clipId}:${Object.keys(command.patch).sort().join(',')}`;
    case 'UPSERT_IMAGE_DOC':
      return imageDocKey(command.doc, command.label, project);
    case 'SET_MODEL3D_DOC':
      // ugyanaz a művelet-címke (pl. „Méret") egymás után = egy húzás → egy lépés
      return command.label ? `model3d:${command.doc.id}:${command.label}` : null;
    default:
      return null;
  }
}

export interface LastCommit {
  key: string | null;
  at: number;
}

/** Összevonandó-e a mostani parancs az előzővel (az új history-lépés helyett). */
export function shouldCoalesce(prev: LastCommit | null, key: string | null, now: number): boolean {
  return !!prev && key !== null && prev.key === key && now - prev.at <= COALESCE_WINDOW_MS;
}

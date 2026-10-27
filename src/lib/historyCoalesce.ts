import type { EditorCommand } from '@/lib/commands';

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

export function coalesceKey(command: EditorCommand): string | null {
  switch (command.type) {
    case 'UPDATE_CLIP':
      // ugyanaz a klip + ugyanazok a mezők (pl. sebesség-húzás ≠ hangerő-húzás)
      return `clip:${command.clipId}:${Object.keys(command.patch).sort().join(',')}`;
    case 'UPSERT_IMAGE_DOC':
      return `imagedoc:${command.doc.id}:${command.label ?? ''}`;
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

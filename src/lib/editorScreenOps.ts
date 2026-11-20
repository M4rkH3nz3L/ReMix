/**
 * 🎬 A videó-szerkesztő képernyő (src/app/editor/[id].tsx) tiszta, expo-mentes magja:
 * autosave-időzítés, mély-link panelek, képarány-léptetés, proxy-előmelegítés
 * URI-listája és a méret-osztály → elrendezés döntés. A képernyőből kiemelve.
 */
import type { PanelId } from '@/store/editorState';
import type { Project } from '@/types/project';

export const AUTOSAVE_MS = 800;

/** exponenciális visszalépés: 0,8 s → 1,6 s → 3,2 s … max 10 s */
export function autosaveDelay(saveAttempt: number): number {
  return saveAttempt === 0 ? AUTOSAVE_MS : Math.min(AUTOSAVE_MS * 2 ** saveAttempt, 10_000);
}

/** csak a kijelölés nélkül is nyitható (standalone) paneleket engedjük paramból */
export function isDeepLinkPanel(panel: string): boolean {
  const openable = new Set<PanelId>([
    'assistant',
    'export',
    'captions',
    'audio',
    'library',
    'transcript',
    'sticker',
    'imagedoc',
  ]);
  return openable.has(panel as PanelId);
}

/** a következő képarány a körben (ismeretlen jelenlegi → az első) */
export function nextAspectRatio<T>(ids: readonly T[], current: T): T {
  return ids[(ids.indexOf(current) + 1) % ids.length];
}

/** vágási proxyk előmelegítéséhez: a videósávok videó-klipjeinek URI-jai */
export function videoClipUris(project: Project): string[] {
  return project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'video')
    .map((c) => c.uri);
}

/** a közreműködők képernyő útvonala (megosztott projektnél a tulajjal) */
export function collabScreenPath(id: string, collab: { ownerId: string } | null): string {
  return `/collab/${id}${collab ? `?owner=${collab.ownerId}` : ''}`;
}

export type EditorLayoutKind = 'expanded' | 'mediumLandscape' | 'medium' | 'stacked';

/** elrendezés méret-osztály szerint (lásd a képernyő elrendezés-kommentjét) */
export function editorLayoutKind(L: {
  isExpanded: boolean;
  sizeClass: string;
  isLandscape: boolean;
}): EditorLayoutKind {
  if (L.isExpanded) {
    return 'expanded';
  } else if (L.sizeClass === 'medium' && L.isLandscape) {
    return 'mediumLandscape';
  } else if (L.sizeClass === 'medium') {
    return 'medium';
  }
  return 'stacked';
}

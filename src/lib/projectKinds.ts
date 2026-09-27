import type { ProjectKind } from '@/types/project';

/**
 * 🎛️ Projekt-fajta katalógus (PM1 — CreativeDocument) — EGY hely, ami kimondja
 * minden `ProjectKind`-ról: van-e KÉSZ szerkesztő-stúdiója (`editable`), mi az
 * ikonja/emojija/i18n-címkéje és a stúdió-útvonala. A UI (create-választó,
 * lista-kártya) és a routing EBBŐL épül, hogy a „mely stúdiók élesek" igazság
 * ne szóródjon szét.
 *
 * Az `editable: false` fajták ADAT-szinten léteznek (a Workspace/Creative Graph/
 * Memory/⌘K hordozza és címkézi őket), de nem hozhatók létre UI-ból, amíg a
 * stúdiójuk el nem készül — így sosem nyílik meg félkész/hibás szerkesztő.
 *
 * Tiszta, expo-mentes (az ikon sima string; a UI castolja a glyph-map-re).
 */
export interface ProjectKindMeta {
  id: ProjectKind;
  emoji: string;
  /** Ionicons név (a lista-kártya fajta-ikonjához). */
  icon: string;
  /** i18n-kulcs (`studio.kind.<id>`). */
  label: string;
  /** van-e KÉSZ szerkesztő-stúdiója. */
  editable: boolean;
  /** a szerkesztő-útvonal az id-hez. */
  route: (id: string) => string;
}

export const PROJECT_KINDS: Record<ProjectKind, ProjectKindMeta> = {
  video: { id: 'video', emoji: '🎬', icon: 'videocam', label: 'studio.kind.video', editable: true, route: (id) => `/editor/${id}` },
  image: { id: 'image', emoji: '📸', icon: 'image', label: 'studio.kind.image', editable: true, route: (id) => `/studio/image/${id}` },
  audio: { id: 'audio', emoji: '🎧', icon: 'musical-notes', label: 'studio.kind.audio', editable: true, route: (id) => `/studio/audio/${id}` },
  // ── CreativeDocument-bővítés (stúdió TBD) ──────────────────────────────────
  writing: { id: 'writing', emoji: '✍️', icon: 'document-text', label: 'studio.kind.writing', editable: false, route: (id) => `/studio/writing/${id}` },
  code: { id: 'code', emoji: '💻', icon: 'code-slash', label: 'studio.kind.code', editable: false, route: (id) => `/studio/code/${id}` },
  music: { id: 'music', emoji: '🎵', icon: 'musical-note', label: 'studio.kind.music', editable: false, route: (id) => `/studio/music/${id}` },
  design: { id: 'design', emoji: '🎨', icon: 'color-palette', label: 'studio.kind.design', editable: false, route: (id) => `/studio/design/${id}` },
};

/** Minden fajta, definíciós sorrendben. */
export const ALL_PROJECT_KINDS: ProjectKind[] = Object.keys(PROJECT_KINDS) as ProjectKind[];

/** Van-e a fajtának KÉSZ szerkesztő-stúdiója (a hiányzó/ismeretlen kind = videó). */
export function isEditableKind(kind: ProjectKind | undefined): boolean {
  return PROJECT_KINDS[kind ?? 'video'].editable;
}

/** A UI-ból LÉTREHOZHATÓ fajták (a create-választóhoz) — csak a kész stúdiók. */
export function creatableKinds(): ProjectKindMeta[] {
  return ALL_PROJECT_KINDS.map((k) => PROJECT_KINDS[k]).filter((m) => m.editable);
}

/** A fajta metaadata (a hiányzó/ismeretlen kind = videó). */
export function projectKindMeta(kind: ProjectKind | undefined): ProjectKindMeta {
  return PROJECT_KINDS[kind ?? 'video'];
}

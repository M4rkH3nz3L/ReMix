import { device3DCaps, has3DStudio, type Device3DCaps } from '@/lib/deviceCaps';
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
  // ── 🎥 Live Studio — van stúdiója (/live/studio/[id]), de a Live-hubból
  //    („Go live") jön létre, ezért `editable: false` → kimarad a generikus
  //    „Új projekt" választóból (creatableKinds). A route a lista-megnyitáshoz él.
  live: { id: 'live', emoji: '🎥', icon: 'radio', label: 'studio.kind.live', editable: false, route: (id) => `/live/studio/${id}` },
  // ── 🧊 3D Stúdió — CSAK LiDAR-os eszközön (3D-Studio.md §1.1): a kész stúdió (3D-1) a
  //    `isKindAvailable` kapun át jelenik meg; LiDAR nélkül sehol (választó, lista, ⌘K, útvonal).
  model3d: { id: 'model3d', emoji: '🧊', icon: 'cube', label: 'studio.kind.model3d', editable: true, route: (id) => `/studio/model3d/${id}` },
};

/** Minden fajta, definíciós sorrendben. */
export const ALL_PROJECT_KINDS: ProjectKind[] = Object.keys(PROJECT_KINDS) as ProjectKind[];

/** Van-e a fajtának KÉSZ szerkesztő-stúdiója (a hiányzó/ismeretlen kind = videó). */
export function isEditableKind(kind: ProjectKind | undefined): boolean {
  return PROJECT_KINDS[kind ?? 'video'].editable;
}

/**
 * 🔒 Létezik-e a fajta EZEN az eszközön (3D-Studio.md §1.1). A `model3d` csak
 * LiDAR-os eszközön — máshol a fajta a UI-ban SEHOL nem jelenik meg (választó,
 * projektlista, ⌘K, útvonal). A többi fajtát nem korlátozza a hardver.
 */
export function isKindAvailable(kind: ProjectKind | undefined, caps: Device3DCaps = device3DCaps()): boolean {
  return (kind ?? 'video') !== 'model3d' || has3DStudio(caps);
}

/** A UI-ból LÉTREHOZHATÓ fajták (a create-választóhoz) — csak a kész ÉS ezen az eszközön elérhető stúdiók. */
export function creatableKinds(caps: Device3DCaps = device3DCaps()): ProjectKindMeta[] {
  return ALL_PROJECT_KINDS.map((k) => PROJECT_KINDS[k]).filter((m) => m.editable && isKindAvailable(m.id, caps));
}

/**
 * A listázható projektek: az ezen az eszközön nem elérhető fajtájúak (pl. LiDAR
 * nélkül a 3D) REJTVE — nem törölve; a felhőben/másik eszközön megmaradnak.
 */
export function visibleProjects<T extends { kind?: ProjectKind }>(items: T[], caps: Device3DCaps = device3DCaps()): T[] {
  return items.filter((p) => isKindAvailable(p.kind, caps));
}

/** A fajta metaadata (a hiányzó/ismeretlen kind = videó). */
export function projectKindMeta(kind: ProjectKind | undefined): ProjectKindMeta {
  return PROJECT_KINDS[kind ?? 'video'];
}

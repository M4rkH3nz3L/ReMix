import { createLiveMixer } from '@/lib/liveMixer';
import type {
  LiveDestination,
  LiveDoc,
  LivePlatform,
  LiveScene,
  LiveSource,
  LiveSourceKind,
  LiveSourceRef,
  LiveTransform,
  LiveVisibility,
} from '@/types/live';

/**
 * 🎥 Live Studio tiszta-mag: a `LiveDoc` létrehozása és mutációja — pure, expo-
 * mentes, önmagában tesztelhető (lásd AGENTS.md). A vászon-pozíciók 0–1
 * normalizáltak (preview=render=egress paritás). A szerkesztő-UI ezeket hívja,
 * az eredményt a `SET_LIVE_DOC` command teszi a projektbe (undo-zható) — mint az
 * `imageDoc.ts` ↔ `UPSERT_IMAGE_DOC`.
 *
 * Az id-generátort INJEKTÁLJUK (`genId`), hogy a mag determinisztikusan
 * tesztelhető legyen és ne hívjon render-tiltott `Date.now()`/`Math.random()`-ot
 * (mint a `createImageDoc`).
 */

export type GenId = () => string;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** méret 0–1, de pozitív (ne legyen 0 szélesség/magasság). */
const clampSize = (v: number): number => (v <= 0 ? 0.01 : v > 1 ? 1 : v);

/** Alap vászon-elhelyezés forrás-fajtánként (OBS-szerű kiindulás). */
export function defaultTransformFor(kind: LiveSourceKind, z = 0): LiveTransform {
  switch (kind) {
    case 'camera':
    case 'screen':
    case 'browser':
      return { x: 0, y: 0, w: 1, h: 1, z }; // teljes vászon
    case 'logo':
      return { x: 0.72, y: 0.04, w: 0.24, h: 0.12, z }; // jobb-felső sarok
    case 'text':
      return { x: 0.08, y: 0.75, w: 0.84, h: 0.15, z }; // alsó-harmad (lower-third)
    case 'shape':
      return { x: 0.3, y: 0.3, w: 0.4, h: 0.4, z };
    case 'image':
    case 'video':
    default:
      return { x: 0.25, y: 0.2, w: 0.5, h: 0.5, z }; // középre, közepes
  }
}

/** Új forrás (még nincs jelenethez kötve). A `z`-t a hívó/`addSource` állítja. */
export function newSource(
  kind: LiveSourceKind,
  genId: GenId,
  opts?: { label?: string; ref?: LiveSourceRef; transform?: Partial<LiveTransform>; z?: number }
): LiveSource {
  const base = defaultTransformFor(kind, opts?.z ?? 0);
  return {
    id: genId(),
    kind,
    visible: true,
    transform: normalizeTransform({ ...base, ...(opts?.transform ?? {}) }),
    ...(opts?.label ? { label: opts.label } : {}),
    ...(opts?.ref ? { ref: opts.ref } : {}),
  };
}

function normalizeTransform(t: LiveTransform): LiveTransform {
  return {
    x: clamp01(t.x),
    y: clamp01(t.y),
    w: clampSize(t.w),
    h: clampSize(t.h),
    z: Number.isFinite(t.z) ? t.z : 0,
    ...(t.rotation != null ? { rotation: t.rotation } : {}),
  };
}

/** Egy jelenet (üres vagy megadott forrásokkal). */
export function newScene(name: string, genId: GenId, sources: LiveSource[] = []): LiveScene {
  return { id: genId(), name, sources };
}

/**
 * Új live-dokumentum: egy „Main" jelenet egy teljes-vászon kamera-forrással +
 * a ReMix-feed mint alap (engedélyezett) cél.
 */
export function createLiveDoc(
  title: string,
  genId: GenId,
  opts?: { visibility?: LiveVisibility }
): LiveDoc {
  const camera = newSource('camera', genId, { label: 'Camera' });
  const scene = newScene('Main', genId, [camera]);
  const remix: LiveDestination = {
    id: genId(),
    platform: 'remix',
    label: 'ReMix',
    enabled: true,
  };
  return {
    title: title.trim() || 'Live',
    visibility: opts?.visibility ?? 'public',
    scenes: [scene],
    activeSceneId: scene.id,
    destinations: [remix],
    mixer: createLiveMixer(),
  };
}

// ── lekérdezések ────────────────────────────────────────────────────────────

export function activeScene(doc: LiveDoc): LiveScene | undefined {
  return doc.scenes.find((s) => s.id === doc.activeSceneId) ?? doc.scenes[0];
}

export function sceneById(doc: LiveDoc, sceneId: string): LiveScene | undefined {
  return doc.scenes.find((s) => s.id === sceneId);
}

/** A jelenet forrásai z-rend szerint (növekvő = hátulról előre). */
export function sortedSources(scene: LiveScene): LiveSource[] {
  return [...scene.sources].sort((a, b) => a.transform.z - b.transform.z);
}

// ── jelenet-műveletek (mind új LiveDoc-ot ad vissza, mutáció nélkül) ──────────

export function addScene(doc: LiveDoc, name: string, genId: GenId): LiveDoc {
  const scene = newScene(name.trim() || `Scene ${doc.scenes.length + 1}`, genId);
  return { ...doc, scenes: [...doc.scenes, scene] };
}

export function removeScene(doc: LiveDoc, sceneId: string): LiveDoc {
  if (doc.scenes.length <= 1 || !sceneById(doc, sceneId)) {
    return doc; // az utolsó jelenet nem törölhető
  }
  const scenes = doc.scenes.filter((s) => s.id !== sceneId);
  const activeSceneId = doc.activeSceneId === sceneId ? scenes[0].id : doc.activeSceneId;
  return { ...doc, scenes, activeSceneId };
}

export function renameScene(doc: LiveDoc, sceneId: string, name: string): LiveDoc {
  const next = name.trim();
  if (!next) {
    return doc;
  }
  return mapScene(doc, sceneId, (s) => ({ ...s, name: next }));
}

export function setActiveScene(doc: LiveDoc, sceneId: string): LiveDoc {
  if (!sceneById(doc, sceneId) || doc.activeSceneId === sceneId) {
    return doc;
  }
  return { ...doc, activeSceneId: sceneId };
}

export function setSceneTransition(doc: LiveDoc, sceneId: string, transitionMs: number): LiveDoc {
  const ms = Math.max(0, Math.round(transitionMs));
  return mapScene(doc, sceneId, (s) => ({
    ...s,
    ...(ms > 0 ? { transitionMs: ms } : { transitionMs: undefined }),
  }));
}

// ── forrás-műveletek ─────────────────────────────────────────────────────────

/** Forrás hozzáadása egy jelenethez — a z a jelenet legfelső fölé kerül. */
export function addSource(
  doc: LiveDoc,
  sceneId: string,
  kind: LiveSourceKind,
  genId: GenId,
  opts?: { label?: string; ref?: LiveSourceRef; transform?: Partial<LiveTransform> }
): LiveDoc {
  const scene = sceneById(doc, sceneId);
  if (!scene) {
    return doc;
  }
  const topZ = scene.sources.reduce((m, s) => Math.max(m, s.transform.z), -1);
  const source = newSource(kind, genId, { ...opts, z: topZ + 1 });
  return mapScene(doc, sceneId, (s) => ({ ...s, sources: [...s.sources, source] }));
}

export function updateSource(
  doc: LiveDoc,
  sceneId: string,
  sourceId: string,
  patch: Partial<Omit<LiveSource, 'id' | 'transform'>> & { transform?: Partial<LiveTransform> }
): LiveDoc {
  return mapScene(doc, sceneId, (s) => ({
    ...s,
    sources: s.sources.map((src) => {
      if (src.id !== sourceId) {
        return src;
      }
      const { transform: tPatch, ...rest } = patch;
      const next: LiveSource = { ...src, ...rest };
      if (tPatch) {
        next.transform = normalizeTransform({ ...src.transform, ...tPatch });
      }
      return next;
    }),
  }));
}

export function removeSource(doc: LiveDoc, sceneId: string, sourceId: string): LiveDoc {
  return mapScene(doc, sceneId, (s) => ({
    ...s,
    sources: s.sources.filter((src) => src.id !== sourceId),
  }));
}

export function toggleSourceVisible(doc: LiveDoc, sceneId: string, sourceId: string): LiveDoc {
  const scene = sceneById(doc, sceneId);
  const src = scene?.sources.find((x) => x.id === sourceId);
  if (!src) {
    return doc;
  }
  return updateSource(doc, sceneId, sourceId, { visible: !src.visible });
}

/** Z-rend léptetés: a forrás előre/hátra a jeleneten belül. */
export function reorderSource(
  doc: LiveDoc,
  sceneId: string,
  sourceId: string,
  dir: 'front' | 'back' | 'up' | 'down'
): LiveDoc {
  const scene = sceneById(doc, sceneId);
  if (!scene) {
    return doc;
  }
  const ordered = sortedSources(scene);
  const idx = ordered.findIndex((s) => s.id === sourceId);
  if (idx < 0) {
    return doc;
  }
  let target = idx;
  if (dir === 'front') target = ordered.length - 1;
  else if (dir === 'back') target = 0;
  else if (dir === 'up') target = Math.min(ordered.length - 1, idx + 1);
  else if (dir === 'down') target = Math.max(0, idx - 1);
  if (target === idx) {
    return doc;
  }
  const moved = ordered.splice(idx, 1)[0];
  ordered.splice(target, 0, moved);
  // újra-sorszámozzuk a z-t 0..n-1-re (stabil, hézagmentes)
  const reindexed = new Map(ordered.map((s, i) => [s.id, i]));
  return mapScene(doc, sceneId, (s) => ({
    ...s,
    sources: s.sources.map((src) => ({
      ...src,
      transform: { ...src.transform, z: reindexed.get(src.id) ?? src.transform.z },
    })),
  }));
}

// ── cél-műveletek ────────────────────────────────────────────────────────────

export function addDestination(
  doc: LiveDoc,
  platform: LivePlatform,
  label: string,
  genId: GenId,
  opts?: { enabled?: boolean; rtmpUrl?: string }
): LiveDoc {
  const dest: LiveDestination = {
    id: genId(),
    platform,
    label: label.trim() || platform,
    enabled: opts?.enabled ?? false,
    ...(opts?.rtmpUrl ? { rtmpUrl: opts.rtmpUrl } : {}),
  };
  return { ...doc, destinations: [...doc.destinations, dest] };
}

export function removeDestination(doc: LiveDoc, destId: string): LiveDoc {
  // a ReMix-feed alap-cél nem törölhető
  const dest = doc.destinations.find((d) => d.id === destId);
  if (!dest || dest.platform === 'remix') {
    return doc;
  }
  return { ...doc, destinations: doc.destinations.filter((d) => d.id !== destId) };
}

export function toggleDestination(doc: LiveDoc, destId: string, enabled?: boolean): LiveDoc {
  let changed = false;
  const destinations = doc.destinations.map((d) => {
    if (d.id !== destId) {
      return d;
    }
    const next = enabled ?? !d.enabled;
    if (next !== d.enabled) {
      changed = true;
    }
    return { ...d, enabled: next };
  });
  return changed ? { ...doc, destinations } : doc;
}

/** Az engedélyezett külső (nem-ReMix) célok — a Pro-kapuhoz / egresshez. */
export function enabledExternalDestinations(doc: LiveDoc): LiveDestination[] {
  return doc.destinations.filter((d) => d.enabled && d.platform !== 'remix');
}

// ── meta ─────────────────────────────────────────────────────────────────────

export function setTitle(doc: LiveDoc, title: string): LiveDoc {
  const next = title.trim();
  if (!next || next === doc.title) {
    return doc;
  }
  return { ...doc, title: next };
}

export function setVisibility(doc: LiveDoc, visibility: LiveVisibility): LiveDoc {
  if (visibility === doc.visibility) {
    return doc;
  }
  return { ...doc, visibility };
}

// ── belső ────────────────────────────────────────────────────────────────────

function mapScene(doc: LiveDoc, sceneId: string, fn: (s: LiveScene) => LiveScene): LiveDoc {
  if (!sceneById(doc, sceneId)) {
    return doc;
  }
  return { ...doc, scenes: doc.scenes.map((s) => (s.id === sceneId ? fn(s) : s)) };
}

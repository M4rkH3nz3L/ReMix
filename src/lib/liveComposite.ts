import { activeScene } from '@/lib/liveDoc';
import type { LiveDoc, LiveSourceKind } from '@/types/live';

/**
 * 🎥 Élő kompozíció wire-formátuma (Fázis B): a host a jelenet-állapotot a
 * realtime-csatornán broadcastolja, a néző ebből rendereli a kompozíciót
 * (kamera/képernyő `VideoTrack` rétegek + szöveg/alakzat/logó overlay-ek). EGY
 * jelenet-modell, két renderelő (host + néző ugyanazt a `ScenePayload`-ot
 * rendezi) — lásd devs/tasks/LIVE.md Fázis B.
 *
 * Kompakt (rövid kulcsok), mert gyakran megy át a csatornán scene-váltáskor /
 * overlay-toggle-kor. Tiszta, expo-mentes → tesztelhető.
 */

/** Egy forrás a wire-formátumban (rövid kulcsok a kisebb payloadért). */
export interface SceneLayer {
  id: string;
  kind: LiveSourceKind;
  /** 0–1 bounding box + z-rend (+ opcionális forgatás). */
  t: { x: number; y: number; w: number; h: number; z: number; r?: number };
  /** látható. */
  v: boolean;
  /** text-forrás megjelenített szövege (jelenleg a label). */
  text?: string;
  /** image/logo média-URI-ja. */
  uri?: string;
  /** shape kitöltő-színe. */
  color?: string;
}

export interface ScenePayload {
  sceneId: string;
  title?: string;
  layers: SceneLayer[];
}

/** A live-dokumentum AKTÍV jelenetének kódolása a csatornára. */
export function encodeScenePayload(doc: LiveDoc): ScenePayload {
  const scene = activeScene(doc);
  if (!scene) {
    return { sceneId: '', layers: [] };
  }
  return {
    sceneId: scene.id,
    title: doc.title,
    layers: scene.sources.map((s) => {
      const layer: SceneLayer = {
        id: s.id,
        kind: s.kind,
        v: s.visible,
        t: {
          x: s.transform.x,
          y: s.transform.y,
          w: s.transform.w,
          h: s.transform.h,
          z: s.transform.z,
          ...(s.transform.rotation != null ? { r: s.transform.rotation } : {}),
        },
      };
      if (s.kind === 'text' && (s.label || s.ref?.url)) {
        layer.text = s.label ?? '';
      }
      const uri = s.ref?.uri ?? (s.kind === 'browser' ? s.ref?.url : undefined);
      if (uri && (s.kind === 'image' || s.kind === 'logo')) {
        layer.uri = uri;
      }
      return layer;
    }),
  };
}

/** A renderelendő rétegek: csak a LÁTHATÓK, z-rend szerint (hátulról előre). */
export function compositeLayers(payload: ScenePayload): SceneLayer[] {
  return payload.layers.filter((l) => l.v).sort((a, b) => a.t.z - b.t.z);
}

/** Van-e az aktív jelenetben LÁTHATÓ adott fajtájú forrás (pl. kell-e kamera-publish). */
export function sceneHasVisible(payload: ScenePayload, kind: LiveSourceKind): boolean {
  return payload.layers.some((l) => l.v && l.kind === kind);
}

/** CSS-%-pozíció a 0–1 transzformból (RN `left/top/width/height` %-ot is elfogad). */
export function layerPercentBox(l: SceneLayer): {
  left: `${number}%`;
  top: `${number}%`;
  width: `${number}%`;
  height: `${number}%`;
} {
  return {
    left: `${l.t.x * 100}%`,
    top: `${l.t.y * 100}%`,
    width: `${l.t.w * 100}%`,
    height: `${l.t.h * 100}%`,
  };
}

const LAYER_KINDS: readonly LiveSourceKind[] = ['camera', 'screen', 'image', 'video', 'text', 'shape', 'logo', 'browser'];
const MAX_LAYERS = 32;
const num = (v: unknown, lo: number, hi: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' ? v.slice(0, max) : undefined;

/**
 * 🛡️ PRO-LIVE L2 — a bejövő (nem megbízható) jelenet-payload validálása. Hibás / rosszindulatú
 * adat eddig kivételt dobott a renderelőben (néző-DoS), és tetszőleges kép-URL-t is
 * betölthetett. Itt: típus-, tartomány- és méret-korlátok; kép csak nyilvános `https://`;
 * ismeretlen fajta kimarad. `null` = eldobandó.
 */
export function parseScenePayload(raw: unknown): ScenePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.layers)) return null;
  const layers: SceneLayer[] = [];
  for (const item of o.layers.slice(0, MAX_LAYERS)) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Record<string, unknown>;
    const kind = l.kind as LiveSourceKind;
    if (!LAYER_KINDS.includes(kind)) continue;
    const t = (l.t && typeof l.t === 'object' ? l.t : {}) as Record<string, unknown>;
    const layer: SceneLayer = {
      id: str(l.id, 64) ?? `l${layers.length}`,
      kind,
      v: l.v === true,
      t: {
        x: num(t.x, -1, 2, 0),
        y: num(t.y, -1, 2, 0),
        w: num(t.w, 0, 2, 1),
        h: num(t.h, 0, 2, 1),
        z: num(t.z, -1000, 1000, 0),
        ...(typeof t.r === 'number' && Number.isFinite(t.r) ? { r: num(t.r, -360, 360, 0) } : {}),
      },
    };
    const text = str(l.text, 300);
    if (text !== undefined) layer.text = text;
    const uri = str(l.uri, 2048);
    if (uri && /^https:\/\//i.test(uri)) layer.uri = uri;
    const color = str(l.color, 32);
    if (color && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)) layer.color = color;
    layers.push(layer);
  }
  return { sceneId: str(o.sceneId, 64) ?? '', ...(str(o.title, 120) ? { title: str(o.title, 120) } : {}), layers };
}


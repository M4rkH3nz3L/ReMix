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

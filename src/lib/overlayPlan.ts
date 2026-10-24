import type { Clip, Project, TextClip } from '@/types/project';

/**
 * 🖼️ Eszközön-render overlay-terv — tiszta mag (Android szöveg/felirat).
 *
 * A szöveg-klipek az eszköz-renderben előre raszterizált, TELJES-vásznas PNG-ként
 * mennek a natív kompozitorra (a PNG-t a preview-komponens snapshotja adja →
 * pixel-hű), a belépő animációt pedig a natív oldal játssza újra a preview ZÁRT
 * KÉPLETŰ görbéivel (TextOverlay.tsx ↔ OverlayRender.kt 1:1). Itt dől el, mely
 * klipek vihetők eszközre, és mik az animáció-paraméterek. Expo-mentes, tesztelt.
 */

/** a preview-val 1:1 újrajátszható belépő animációk (zárt képlet, állandó raszter) */
const CLOSED_FORM_ANIMS = new Set(['fade', 'slide', 'pop', 'pulse', 'shake']);
/** idő-függő TARTALMÚ animációk — ezek raszterrel nem vihetők (→ felhő) */
const TIME_VARYING_ANIMS = new Set(['typewriter', 'karaoke']);

/** a preview eltolás-amplitúdói (dp a vászon-dobozban — TextOverlay.tsx) */
const SLIDE_AMP_DP = 30;
const SHAKE_AMP_DP = 2;

/**
 * Raszterrel NEM vihető szöveg-klip (idő-függő tartalom / mozgás-pálya) —
 * az ilyen projekt a felhő-renderre megy (paritás-kapu).
 */
export function textClipUnsupportedOnDevice(clip: TextClip): boolean {
  if (clip.textMotion) {
    return true; // szó/karakter-szintű mozgás (reveal/typeOn/wave…) — idő-függő
  }
  if (clip.animation && TIME_VARYING_ANIMS.has(clip.animation)) {
    return true;
  }
  if (clip.keyframes && Object.keys(clip.keyframes).length > 0) {
    return true; // pozíció/skála-pálya — a statikus raszter nem követi
  }
  return false;
}

export interface TextOverlaySpec {
  clipId: string;
  atSec: number;
  durationSec: number;
  opacity: number;
  /** zárt képletű belépő animáció ('none' = statikus) */
  anim: 'none' | 'fade' | 'slide' | 'pop' | 'pulse' | 'shake';
  /** eltolás-amplitúdó a vászon-magasság arányában (slide/shake) */
  ampNorm: number;
  /** animáció-horgony (a szöveg-doboz közepe), 0–1 vászon-koordináta */
  anchorX: number;
  anchorY: number;
}

function isTextClip(clip: Clip): clip is TextClip {
  return clip.kind === 'text';
}

/** a projekt eszközre vihető szöveg-klipjei (idő-sorrendben) */
export function deviceTextClips(project: Project): TextClip[] {
  const out: TextClip[] = [];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (isTextClip(clip) && !textClipUnsupportedOnDevice(clip)) {
        out.push(clip);
      }
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** van-e raszterrel NEM vihető szöveg-klip (→ renderParity 'text' rés) */
export function hasUnsupportedTextClips(project: Project): boolean {
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (isTextClip(clip) && textClipUnsupportedOnDevice(clip)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Overlay-specifikációk a natív tervhez (a PNG-út a raszter-híd dolga). Az
 * `outHeightDp` a raszter-vászon magassága — az amplitúdók ehhez normalizálódnak,
 * így a natív eltolás PONT annyi, amennyit a snapshot-kontextus preview-ja mutatna.
 */
export function deviceTextOverlaySpecs(project: Project, outHeightDp: number): TextOverlaySpec[] {
  const h = Math.max(1, outHeightDp);
  return deviceTextClips(project).map((clip) => {
    const anim =
      clip.animation && CLOSED_FORM_ANIMS.has(clip.animation)
        ? (clip.animation as TextOverlaySpec['anim'])
        : 'none';
    return {
      clipId: clip.id,
      atSec: clip.start,
      durationSec: clip.duration,
      // a TextClip-nek nincs külön opacity mezője — a raszter hordozza a kinézetet
      opacity: 1,
      anim,
      ampNorm: anim === 'slide' ? SLIDE_AMP_DP / h : anim === 'shake' ? SHAKE_AMP_DP / h : 0,
      anchorX: clip.position.x,
      anchorY: clip.position.y,
    };
  });
}

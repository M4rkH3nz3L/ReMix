import type { Clip, Project, VideoClip } from '@/types/project';

/**
 * 🎯 Eszközön-render PARITÁS-KAPU — tiszta mag (WYSIWYG-szabály).
 *
 * Termék-szabály: a user AZT kapja a kész videóban, amit a szerkesztőben lát.
 * A natív (eszközön) motor ma vágást/összefűzést/sebességet/hangkeverést tud
 * (+ Androidon filterId-tintet) — szöveget, effekteket, átmeneteket, kulcskockákat
 * NEM. Eddig a plan-builder ezeket NÉMÁN eldobta → a kész videóból hiányzott a
 * felirat és az effekt. Ez a mag felsorolja, MI hiányozna az eszköz-renderből;
 * ha a lista nem üres, a render-orchesztrátor a TELJES paritású felhő-útra vált
 * (vagy explicit lokál-kérésnél értelmes hibát ad). Ahogy a natív motor bővül,
 * innen kell törölni a megfelelő ellenőrzést — a kapu a paritás szerződése.
 */

export type RenderPlatform = 'ios' | 'android';

/** az eszköz-renderből MA hiányzó képességek (a felhő-render mindet tudja) */
export type LocalRenderGap =
  | 'text'
  | 'image'
  | 'shape'
  | 'adjustLayer'
  | 'interactive'
  | 'effects'
  | 'adjust'
  | 'filter'
  | 'filterIntensity'
  | 'transition'
  | 'keyframes'
  | 'transform'
  | 'opacity'
  | 'mask'
  | 'matte'
  | 'chromaKey'
  | 'fade'
  | 'reversed'
  | 'nestedComp'
  | 'particles'
  | 'audioMaster';

/** az identitás-transzform (alap pozíció/skála) nem számít eltérésnek */
function isNonDefaultTransform(t: VideoClip['transform']): boolean {
  if (!t) {
    return false;
  }
  return (
    (typeof t.scale === 'number' && Math.abs(t.scale - 1) > 1e-6) ||
    (typeof t.x === 'number' && Math.abs(t.x) > 1e-6) ||
    (typeof t.y === 'number' && Math.abs(t.y) > 1e-6) ||
    (typeof t.rotation === 'number' && Math.abs(t.rotation) > 1e-6)
  );
}

/** van-e ténylegesen beállított érték az adjust-ban (üres objektum = nincs) */
function hasAdjust(adjust: VideoClip['adjust']): boolean {
  return !!adjust && Object.values(adjust).some((v) => typeof v === 'number' && Math.abs(v) > 1e-6);
}

function videoClipGaps(clip: VideoClip, platform: RenderPlatform, out: Set<LocalRenderGap>): void {
  if (clip.effects && clip.effects.length > 0) {
    out.add('effects');
  }
  if (hasAdjust(clip.adjust)) {
    out.add('adjust');
  }
  // a filterId-tintet az Android-motor ismeri (FilterPresets), az iOS-motor MA
  // dekódolja, de nem alkalmazza → iOS-en a filter paritás-rés
  if (clip.filterId && clip.filterId !== 'none' && platform === 'ios') {
    out.add('filter');
  }
  if (clip.filterId && clip.filterId !== 'none' && typeof clip.filterIntensity === 'number') {
    out.add('filterIntensity'); // az egyéni erősséget a natív preset nem ismeri
  }
  if (clip.transitionOut) {
    out.add('transition');
  }
  if (clip.keyframes && Object.keys(clip.keyframes).length > 0) {
    out.add('keyframes');
  }
  if (isNonDefaultTransform(clip.transform)) {
    out.add('transform');
  }
  if (typeof clip.opacity === 'number' && clip.opacity < 1) {
    out.add('opacity');
  }
  if (clip.mask) {
    out.add('mask');
  }
  if (clip.matte) {
    out.add('matte');
  }
  if (clip.chromaKey) {
    out.add('chromaKey');
  }
  if ((clip.fadeInSec ?? 0) > 0 || (clip.fadeOutSec ?? 0) > 0) {
    out.add('fade');
  }
  if (clip.reversed) {
    out.add('reversed');
  }
  if (clip.comp) {
    out.add('nestedComp');
  }
}

function clipKindGap(clip: Clip): LocalRenderGap | null {
  switch (clip.kind) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'shape':
      return 'shape';
    case 'adjust':
      return 'adjustLayer';
    case 'interactive':
      return 'interactive';
    default:
      return null;
  }
}

/**
 * Mi HIÁNYOZNA az eszközön-renderelt videóból ehhez a projekthez képest.
 * Üres lista = az eszköz-motor bitre pontosan vissza tudja adni a tartalmat
 * (vágás/sebesség/hang/Android-filter) → mehet lokálisan. Determinista.
 */
export function localRenderGaps(project: Project, platform: RenderPlatform): LocalRenderGap[] {
  const out = new Set<LocalRenderGap>();
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const kindGap = clipKindGap(clip);
      if (kindGap) {
        out.add(kindGap);
        continue;
      }
      if (clip.kind === 'video') {
        videoClipGaps(clip, platform, out);
      }
    }
  }
  if (project.particles) {
    out.add('particles');
  }
  // a mester-lánc / sáv-mixer a natív hangkeverésben nincs leképezve
  if (project.audioMaster) {
    out.add('audioMaster');
  }
  const mixed = Object.values(project.trackMix ?? {}).some(
    (m) => typeof m?.gain === 'number' && Math.abs(m.gain - 1) > 1e-6,
  );
  if (mixed) {
    out.add('audioMaster');
  }
  return [...out].sort();
}

/** Igaz, ha az eszköz-motor a LÁTOTT tartalmat hiánytalanul vissza tudja adni. */
export function localRenderMatchesPreview(project: Project, platform: RenderPlatform): boolean {
  return localRenderGaps(project, platform).length === 0;
}

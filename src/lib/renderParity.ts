import { textClipUnsupportedOnDevice } from '@/lib/overlayPlan';
import type { AudioClip, Clip, Project, VideoClip } from '@/types/project';

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
  | 'audioMaster'
  // 🧩 B10: a natív motor EGY videósávot fűz — a PiP/overlay-sáv videója rés
  | 'pip'
  // 🎞️ B15: videó-feldolgozás, amit csak a felhő-render tud
  | 'videoFx'
  // 🎙️ B15: hangfeldolgozás (Voice Studio, effekt-lánc, ducking) és hang-mozgás
  | 'voiceFx'
  | 'audioFx'
  | 'audioFade'
  | 'pan'
  | 'audioAutomation';

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
  // 🎞️ B15: a felhő-render ffmpeg-láncai — a natív motor ezeket CSENDBEN elhagyná
  if (
    clip.stabilize?.automatic ||
    (clip.timeInterp && clip.timeInterp !== 'none' && clip.speed !== 1) ||
    (clip.motionBlur ?? 0) > 0 ||
    clip.faceBlur ||
    clip.selective ||
    clip.lighting ||
    clip.tilt3d ||
    clip.backgroundFill === 'blur'
  ) {
    out.add('videoFx');
  }
  if (clip.voiceEnhance || clip.deReverb) {
    out.add('voiceFx');
  }
}

/** 🎙️ B15: a hangklip a natív keverőben csak hangerővel + vágással megy */
function audioClipGaps(clip: AudioClip, out: Set<LocalRenderGap>): void {
  if ((clip.fadeIn ?? 0) > 0 || (clip.fadeOut ?? 0) > 0) {
    out.add('audioFade');
  }
  if (typeof clip.pan === 'number' && Math.abs(clip.pan) > 1e-6) {
    out.add('pan');
  }
  if (clip.audioFx && Object.values(clip.audioFx).some((v) => v !== undefined && v !== null && v !== false)) {
    out.add('audioFx');
  }
  if (clip.autoDuck) {
    out.add('audioFx');
  }
  if (clip.voiceEnhance || clip.deReverb) {
    out.add('voiceFx');
  }
  if ((clip.keyframes?.volume?.length ?? 0) > 0 || (clip.keyframes?.pan?.length ?? 0) > 0) {
    out.add('audioAutomation');
  }
}

function clipKindGap(clip: Clip, platform: RenderPlatform): LocalRenderGap | null {
  switch (clip.kind) {
    case 'text':
      // 🖼️ Androidon a szöveg az overlay-úton (preview-snapshot PNG + natív
      // belépő-animáció) eszközön megy — csak az idő-függő tartalmú klip rés;
      // iOS-en a natív motor még nem tud overlay-t → minden szöveg felhő-út
      return platform === 'ios' || textClipUnsupportedOnDevice(clip) ? 'text' : null;
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
      const kindGap = clipKindGap(clip, platform);
      if (kindGap) {
        out.add(kindGap);
        continue;
      }
      if (clip.kind === 'video') {
        // a natív terv CSAK a fő videósávot fűzi — más sáv videója (PiP/overlay)
        // vágásként jelenne meg (B10) → felhő-út
        if (track.type !== 'video') {
          out.add('pip');
        }
        videoClipGaps(clip, platform, out);
      } else if (clip.kind === 'audio') {
        audioClipGaps(clip, out);
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

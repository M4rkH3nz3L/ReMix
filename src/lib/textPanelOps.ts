import type { TextTemplate } from '@/constants/textTemplates';
import type { TextClip, TextStyle } from '@/types/project';

/**
 * 🔤 A videó-szerkesztő szöveg-paneljének (`components/editor/panels/TextPanel.tsx`)
 * expo-mentes magja: sablon-patch, a granuláris szöveg-stílus összefésülése, az
 * előjeles százalék-kijelzés, a kinetikus lépésköz alapértéke és a követési
 * szakasz vége. (REFACTOR: a TextPanel.tsx-ből kiemelve, a számítás változatlan.)
 */

/**
 * Sablon alkalmazása: MINDEN look-mezőt explicit átír (a nem használtakat is
 * nullázza — text3d/háttér —, hogy két sablon közt ne ragadjon be a régi
 * stílus). A szöveg tartalma, időzítése, kulcskockái és kiemelései maradnak.
 */
export function templatePatch(t: TextTemplate): Partial<TextClip> {
  const f = t.fields;
  return {
    fontFamily: f.fontFamily,
    fontSize: f.fontSize,
    fontWeight: f.fontWeight ?? 'bold',
    color: f.color,
    backgroundColor: f.backgroundColor ?? null,
    stylePreset: f.stylePreset ?? 'plain',
    animation: f.animation ?? 'none',
    text3d: f.text3d,
    position: f.position,
  };
}

/** 🎨 granuláris szöveg-stílus: a patch ráfésülése; üresen a textStyle is eltűnik */
export function mergeTextStyle(ts: TextStyle, patch: Partial<TextStyle>): TextStyle | undefined {
  const next = { ...ts, ...patch };
  // az undefined mezőket kiszűrjük, hogy üresen a textStyle is eltűnjön
  (Object.keys(next) as (keyof TextStyle)[]).forEach((k) => next[k] === undefined && delete next[k]);
  return Object.keys(next).length ? next : undefined;
}

/** előjeles egész százalék (pl. „+4", „-10", „0") */
export const signedPercent = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

/** a kinetikus animáció alap-lépésköze (mp) a bontás szerint */
export const kineticStaggerDefault = (by: string | undefined) =>
  by === 'char' ? 0.03 : by === 'word' ? 0.08 : 0.14;

/** a követési szakasz vége: a playheadtől a szöveg és a videó közös végéig (max 15 mp) */
export function trackSegmentEnd(
  clip: { start: number; duration: number },
  video: { start: number; duration: number },
  playhead: number
): number {
  return Math.min(clip.start + clip.duration, video.start + video.duration, playhead + 15);
}

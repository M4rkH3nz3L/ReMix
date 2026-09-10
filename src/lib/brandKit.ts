import type {
  Clip,
  Project,
  ShapeClip,
  TextAnimation,
  TextClip,
  TextStylePreset,
} from '@/types/project';

/**
 * 🎨 Brand Kit / Project Intelligence (P1) — pure rész: stílusprofil
 * levezetése egy kész projektből („Use my style”), és a profil alkalmazása
 * másik projektre („Apply Brand”). A profil app-szintű (projekteken átívelő),
 * a tárolás a brandStore.ts-ben.
 */

export interface BrandCaptionStyle {
  stylePreset: TextStylePreset;
  color: string;
  backgroundColor: string | null;
  fontWeight: 'normal' | 'bold';
  fontSize: number;
  animation: TextAnimation;
}

export interface BrandWatermark {
  imageUri: string;
  position: { x: number; y: number };
  w: number;
  h: number;
  opacity?: number;
  cornerRadius?: number;
}

export interface BrandKit {
  savedAt: string;
  caption: BrandCaptionStyle | null;
  watermark: BrandWatermark | null;
  /** a leggyakoribb forma-szín (badge-ekhez, jövőbeli sablonokhoz) */
  accentColor: string | null;
}

/** a lista leggyakoribb eleme (JSON-kulcs szerint) */
function mode<T>(items: T[]): T | null {
  if (items.length === 0) {
    return null;
  }
  const counts = new Map<string, { value: T; n: number }>();
  for (const item of items) {
    const key = JSON.stringify(item);
    const entry = counts.get(key);
    if (entry) {
      entry.n += 1;
    } else {
      counts.set(key, { value: item, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0].value;
}

/** vízjel-jelölt: kép-kitöltésű, kicsi overlay-forma */
function isWatermarkShape(c: Clip): c is ShapeClip {
  return (
    c.kind === 'shape' &&
    Boolean(c.imageUri) &&
    c.w * c.h <= 0.08 // a vászon ~8%-ánál kisebb — logó, nem tartalom
  );
}

/** stílusprofil a projektből: felirat-stílus módusza + vízjel + accent-szín */
export function deriveBrandKit(project: Project, savedAt: string): BrandKit | null {
  const captions = project.tracks
    .filter((t) => t.type === 'captions' || t.type === 'text')
    .flatMap((t) => t.clips)
    .filter((c): c is TextClip => c.kind === 'text' && !c.text3d);
  const caption =
    captions.length > 0
      ? mode(
          captions.map((c) => ({
            stylePreset: c.stylePreset ?? ('plain' as TextStylePreset),
            color: c.color,
            backgroundColor: c.backgroundColor,
            fontWeight: c.fontWeight,
            fontSize: c.fontSize,
            animation: c.animation,
          }))
        )
      : null;

  const wmShape = project.tracks
    .flatMap((t) => t.clips)
    .find(isWatermarkShape);
  const watermark: BrandWatermark | null = wmShape
    ? {
        imageUri: wmShape.imageUri!,
        position: wmShape.position,
        w: wmShape.w,
        h: wmShape.h,
        opacity: wmShape.opacity,
        cornerRadius: wmShape.cornerRadius,
      }
    : null;

  const fills = project.tracks
    .flatMap((t) => t.clips)
    .filter((c): c is ShapeClip => c.kind === 'shape' && !c.imageUri)
    .map((c) => c.fill)
    .filter((f) => f && f !== 'transparent');
  const accentColor = mode(fills);

  if (!caption && !watermark && !accentColor) {
    return null;
  }
  return { savedAt, caption, watermark, accentColor };
}

/**
 * A márka felirat-stílusának alkalmazása: a szöveg, az időzítés, a pozíció és
 * a kiemelések maradnak — a megjelenés (preset/szín/súly/méret/animáció) vált.
 * 3D címeket nem bánt.
 */
export function applyBrandCaptions(
  clips: Clip[],
  kit: BrandKit
): { clips: Clip[]; changed: number } {
  if (!kit.caption) {
    return { clips, changed: 0 };
  }
  const c = kit.caption;
  let changed = 0;
  const out = clips.map((clip) => {
    if (clip.kind !== 'text' || clip.text3d) {
      return clip;
    }
    const same =
      (clip.stylePreset ?? 'plain') === c.stylePreset &&
      clip.color === c.color &&
      clip.backgroundColor === c.backgroundColor &&
      clip.fontWeight === c.fontWeight &&
      clip.fontSize === c.fontSize &&
      clip.animation === c.animation;
    if (same) {
      return clip;
    }
    changed += 1;
    return { ...clip, ...c, stylePreset: c.stylePreset } as TextClip;
  });
  return { clips: out, changed };
}

/** vízjel-klip a teljes projekt-hosszra */
export function buildWatermarkClip(
  watermark: BrandWatermark,
  projectDuration: number,
  id: string
): ShapeClip {
  return {
    kind: 'shape',
    id,
    start: 0,
    duration: Math.max(1, projectDuration),
    shape: 'rectangle',
    position: watermark.position,
    w: watermark.w,
    h: watermark.h,
    fill: 'transparent',
    imageUri: watermark.imageUri,
    opacity: watermark.opacity,
    cornerRadius: watermark.cornerRadius,
  };
}

/** rövid összefoglaló a panel státusz-sorába */
export function describeBrandKit(kit: BrandKit): string {
  const parts: string[] = [];
  if (kit.caption) {
    parts.push(`felirat: ${kit.caption.stylePreset}/${kit.caption.animation}`);
  }
  if (kit.watermark) {
    parts.push('vízjel ✓');
  }
  if (kit.accentColor) {
    parts.push(`szín: ${kit.accentColor}`);
  }
  return parts.join(' · ');
}

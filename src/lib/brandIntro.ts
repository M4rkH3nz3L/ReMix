import type { BrandKit } from '@/lib/brandKit';
import type { Clip, ShapeClip, TextClip, TrackType } from '@/types/project';

/**
 * 🎬 Brand Kit intro/outro sablonok — pure réteg.
 *
 * Az intro/outro NEM új render-motort kap: a videósávon ÜRES SZAKASZ marad
 * (a render fekete alapot ad rá), fölé pedig a márkaszínű háttér-forma, a logó
 * és a szöveg kerül overlay/felirat-klipként. Így az előnézet, a render és az
 * export egy sorral sem változik.
 *
 * Az intro beszúrása RIPPLE: minden sáv minden klipje csúszik a hosszával —
 * ezért a terv az ÖSSZES érintett sávot visszaadja, és egy undo-lépésben megy
 * be (REPLACE_TRACKS).
 */

export type IntroTemplate = 'logoPop' | 'titleCard' | 'flashCut';
export type OutroTemplate = 'subscribe' | 'logoEnd' | 'nextUp';

export const INTRO_TEMPLATES: {
  id: IntroTemplate;
  label: string;
  hint: string;
  duration: number;
}[] = [
  { id: 'logoPop', label: '⚡ Logó-pop', hint: 'rövid, logó középen', duration: 1.2 },
  { id: 'titleCard', label: '🎬 Címkártya', hint: 'cím + alcím', duration: 2 },
  { id: 'flashCut', label: '💥 Villanás', hint: 'nagyon rövid felvillanás', duration: 0.7 },
];

export const OUTRO_TEMPLATES: {
  id: OutroTemplate;
  label: string;
  hint: string;
  duration: number;
}[] = [
  { id: 'subscribe', label: '🔔 Kövess be', hint: 'CTA + logó', duration: 2.4 },
  { id: 'logoEnd', label: '🏁 Logó-zárás', hint: 'csak a márka', duration: 1.6 },
  { id: 'nextUp', label: '➡️ Következő', hint: 'átvezetés a következő videóra', duration: 2.4 },
];

const DEFAULT_ACCENT = '#ff2d55';

export interface BrandSegmentPlan {
  tracks: { trackType: TrackType; clips: Clip[] }[];
  duration: number;
  /** amit a felhasználónak mutatunk (mi került bele) */
  summary: string;
}

interface BuildContext {
  kit: BrandKit | null;
  makeId: () => string;
  /** a projekt neve — a címkártya alapszövege */
  title: string;
  /** a kezdőidő az idővonalon */
  at: number;
}

function background(ctx: BuildContext, duration: number, accent: string): ShapeClip {
  return {
    kind: 'shape',
    id: ctx.makeId(),
    start: ctx.at,
    duration,
    shape: 'rectangle',
    position: { x: 0.5, y: 0.5 },
    // kicsivel túllóg a vásznon, hogy a szélén ne villanjon ki a fekete
    w: 1.04,
    h: 1.04,
    fill: accent,
    fillGradient: { from: accent, to: shade(accent, -0.45) },
    opacity: 1,
  };
}

/** hex-szín világosítása/sötétítése (-1..1) — a gradienshez */
function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return hex;
  }
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const next = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.max(0, Math.min(255, Math.round(next)));
  });
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function logoClip(
  ctx: BuildContext,
  duration: number,
  position: { x: number; y: number },
  scale: number
): ShapeClip | null {
  const wm = ctx.kit?.watermark;
  if (!wm) {
    return null;
  }
  return {
    kind: 'shape',
    id: ctx.makeId(),
    start: ctx.at,
    duration,
    shape: 'rectangle',
    position,
    // az intróban a logó jóval nagyobb, mint vízjelként
    w: Math.min(0.7, wm.w * scale),
    h: Math.min(0.7, wm.h * scale),
    fill: 'transparent',
    imageUri: wm.imageUri,
    cornerRadius: wm.cornerRadius,
  };
}

function textClip(
  ctx: BuildContext,
  duration: number,
  text: string,
  opts: {
    y: number;
    fontSize: number;
    color?: string;
    animation?: TextClip['animation'];
    delay?: number;
  }
): TextClip {
  const style = ctx.kit?.caption;
  return {
    kind: 'text',
    id: ctx.makeId(),
    start: ctx.at + (opts.delay ?? 0),
    duration: duration - (opts.delay ?? 0),
    text,
    color: opts.color ?? '#ffffff',
    backgroundColor: null,
    fontSize: opts.fontSize,
    fontWeight: 'bold',
    position: { x: 0.5, y: opts.y },
    animation: opts.animation ?? 'pop',
    stylePreset: style?.stylePreset ?? 'plain',
  };
}

/** intro-klipek a 0. időpontra (a hívó ripple-özi utána a projektet) */
export function buildIntroClips(
  template: IntroTemplate,
  ctx: Omit<BuildContext, 'at'>
): { overlay: Clip[]; captions: Clip[]; duration: number } {
  const spec = INTRO_TEMPLATES.find((t) => t.id === template)!;
  const c: BuildContext = { ...ctx, at: 0 };
  const accent = ctx.kit?.accentColor ?? DEFAULT_ACCENT;
  const d = spec.duration;
  const overlay: Clip[] = [background(c, d, accent)];
  const captions: Clip[] = [];

  if (template === 'logoPop') {
    const logo = logoClip(c, d, { x: 0.5, y: 0.46 }, 3.2);
    if (logo) {
      overlay.push(logo);
    } else {
      captions.push(textClip(c, d, ctx.title, { y: 0.46, fontSize: 11 }));
    }
    captions.push(
      textClip(c, d, ctx.title, {
        y: logo ? 0.68 : 0.6,
        fontSize: logo ? 6 : 5,
        delay: 0.25,
      })
    );
  } else if (template === 'titleCard') {
    const logo = logoClip(c, d, { x: 0.5, y: 0.28 }, 2.2);
    if (logo) {
      overlay.push(logo);
    }
    captions.push(
      textClip(c, d, ctx.title, { y: logo ? 0.5 : 0.44, fontSize: 10 }),
      textClip(c, d, 'Nézd végig 👇', {
        y: logo ? 0.66 : 0.6,
        fontSize: 5.5,
        delay: 0.5,
        animation: 'fade',
      })
    );
  } else {
    // flashCut: nagyon rövid, csak a márkaszín + a cím felvillan
    captions.push(textClip(c, d, ctx.title, { y: 0.5, fontSize: 12 }));
  }

  return { overlay, captions, duration: d };
}

/** outro-klipek a megadott végponttól */
export function buildOutroClips(
  template: OutroTemplate,
  ctx: BuildContext
): { overlay: Clip[]; captions: Clip[]; duration: number } {
  const spec = OUTRO_TEMPLATES.find((t) => t.id === template)!;
  const accent = ctx.kit?.accentColor ?? DEFAULT_ACCENT;
  const d = spec.duration;
  const overlay: Clip[] = [background(ctx, d, accent)];
  const captions: Clip[] = [];

  if (template === 'subscribe') {
    const logo = logoClip(ctx, d, { x: 0.5, y: 0.3 }, 2.4);
    if (logo) {
      overlay.push(logo);
    }
    captions.push(
      textClip(ctx, d, 'Kövess be 🔔', { y: logo ? 0.54 : 0.44, fontSize: 10 }),
      textClip(ctx, d, 'Több ilyen videóért', {
        y: logo ? 0.68 : 0.58,
        fontSize: 5,
        delay: 0.4,
        animation: 'fade',
      })
    );
  } else if (template === 'logoEnd') {
    const logo = logoClip(ctx, d, { x: 0.5, y: 0.48 }, 3);
    if (logo) {
      overlay.push(logo);
    } else {
      captions.push(textClip(ctx, d, ctx.title, { y: 0.48, fontSize: 11 }));
    }
  } else {
    captions.push(
      textClip(ctx, d, 'Következő videó ➡️', { y: 0.42, fontSize: 8.5 }),
      textClip(ctx, d, 'Koppints a profilra', {
        y: 0.56,
        fontSize: 5,
        delay: 0.4,
        animation: 'fade',
      })
    );
    const logo = logoClip(ctx, d, { x: 0.5, y: 0.75 }, 1.8);
    if (logo) {
      overlay.push(logo);
    }
  }

  return { overlay, captions, duration: d };
}

/** minden klip eltolása (ripple) — a klip-azonosítók megmaradnak */
export function shiftClips(clips: Clip[], by: number): Clip[] {
  return clips.map((c) => ({ ...c, start: Math.round((c.start + by) * 1000) / 1000 }));
}

/**
 * A teljes terv: intro beszúrása az elejére (mindent eltol) és/vagy outro a
 * végére. Csak azok a sávok kerülnek a tervbe, amiken tényleg változik valami.
 */
export function buildBrandSegmentPlan(
  tracks: { type: TrackType; clips: Clip[] }[],
  opts: {
    intro?: IntroTemplate;
    outro?: OutroTemplate;
    kit: BrandKit | null;
    title: string;
    makeId: () => string;
  }
): BrandSegmentPlan | null {
  if (!opts.intro && !opts.outro) {
    return null;
  }
  const ctxBase = { kit: opts.kit, makeId: opts.makeId, title: opts.title };
  const parts: string[] = [];

  // 1) intro → ripple
  let shift = 0;
  let introOverlay: Clip[] = [];
  let introCaptions: Clip[] = [];
  if (opts.intro) {
    const built = buildIntroClips(opts.intro, ctxBase);
    shift = built.duration;
    introOverlay = built.overlay;
    introCaptions = built.captions;
    parts.push(`${built.duration.toFixed(1)} mp intro`);
  }

  const shifted = new Map<TrackType, Clip[]>();
  for (const t of tracks) {
    shifted.set(t.type, shift > 0 ? shiftClips(t.clips, shift) : [...t.clips]);
  }

  // 2) outro → az ELTOLT idővonal végére
  let outroOverlay: Clip[] = [];
  let outroCaptions: Clip[] = [];
  if (opts.outro) {
    const end = Math.max(
      0,
      ...[...shifted.values()].flatMap((cs) => cs.map((c) => c.start + c.duration))
    );
    const built = buildOutroClips(opts.outro, { ...ctxBase, at: end });
    outroOverlay = built.overlay;
    outroCaptions = built.captions;
    parts.push(`${built.duration.toFixed(1)} mp outro`);
  }

  const out: { trackType: TrackType; clips: Clip[] }[] = [];
  const byStart = (a: Clip, b: Clip) => a.start - b.start;

  for (const [type, clips] of shifted) {
    const extra =
      type === 'overlay'
        ? [...introOverlay, ...outroOverlay]
        : type === 'captions'
          ? [...introCaptions, ...outroCaptions]
          : [];
    if (extra.length === 0 && shift === 0) {
      continue; // ezen a sávon nincs változás
    }
    out.push({ trackType: type, clips: [...clips, ...extra].sort(byStart) });
  }

  if (out.length === 0) {
    return null;
  }
  return {
    tracks: out,
    duration: shift,
    summary: parts.join(' + '),
  };
}

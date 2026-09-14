/**
 * ASS (Advanced SubStation Alpha) felirat-szerializálás — az SRT/VTT-nél gazdagabb
 * formátum: stílus (betű, méret, szín, körvonal, árnyék) és PONTOS pozíció is
 * belefér. A karaoke-lejátszók (és az FFmpeg `subtitles`/`ass` szűrője) ezt
 * tudják a legszebben égetni. Szándékosan expo-mentes → önmagában tesztelhető.
 *
 * A koordináták a szerkesztő 0–1 normalizált vászna szerintiek; a PlayRes-t a
 * hívó adja (a képarányból), és a `\pos` a normalizált középpontból pixelre vált.
 */

export interface AssCue {
  /** mp */
  start: number;
  /** mp */
  end: number;
  text: string;
  /** #rrggbb szöveg-szín (alap: fehér) */
  color?: string;
  /** félkövér */
  bold?: boolean;
  /** 0–1 normalizált középpont; ha van, `\pos`-szal pontosan ide kerül */
  position?: { x: number; y: number };
  /** betűméret a vászon MAGASSÁGÁNAK %-ában (egyezik a TextClip.fontSize-zal) */
  fontSizePct?: number;
}

export interface AssOptions {
  /** PlayResX (px) — a képarányból, pl. 9:16 → 1080 */
  width: number;
  /** PlayResY (px) */
  height: number;
  fontName?: string;
}

/** mp → "H:MM:SS.cs" (ASS: centiszekundum, egy számjegy óra) */
function toAssTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${h}:${pad(m)}:${pad(sec)}.${pad(cs)}`;
}

/** #rrggbb → ASS "&HAABBGGRR" (BGR sorrend, AA=00 = teljesen átlátszatlan) */
export function hexToAssColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    return '&H00FFFFFF';
  }
  const rr = m[1].slice(0, 2);
  const gg = m[1].slice(2, 4);
  const bb = m[1].slice(4, 6);
  return `&H00${bb}${gg}${rr}`.toUpperCase();
}

/** ASS-ben a sortörés `\N`; a `\` és a `{}` a felülíró-tagoké → a szövegből kivesszük */
function escapeAssText(text: string): string {
  return text.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\r?\n/g, '\\N');
}

/**
 * Teljes .ass fájl a cue-kból. Egy alap stílus (alsó-közép igazítás, fekete
 * körvonal a TikTok-olvashatósághoz), és cue-nként felülírás: szín (`\c`),
 * félkövér (`\b1`), méret (`\fs`) és pontos pozíció (`\pos` + `\an5` közép-anchor).
 */
export function serializeAss(cues: AssCue[], opts: AssOptions): string {
  const { width, height } = opts;
  const font = opts.fontName || 'Arial';
  const baseFs = Math.round(height * 0.05); // ~5% magasság az alap felirat-méret

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 2 = alsó-közép; körvonal 3, árnyék 1; fehér szöveg, fekete körvonal
    `Style: Default,${font},${baseFs},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,${Math.round(width * 0.05)},${Math.round(width * 0.05)},${Math.round(height * 0.06)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const events = cues.map((cue) => {
    const tags: string[] = [];
    if (cue.position) {
      const px = Math.round(cue.position.x * width);
      const py = Math.round(cue.position.y * height);
      tags.push(`\\an5\\pos(${px},${py})`); // közép-anchor a pontos középpontra
    }
    if (cue.color) {
      tags.push(`\\c${hexToAssColor(cue.color)}`);
    }
    if (cue.bold) {
      tags.push('\\b1');
    }
    if (cue.fontSizePct) {
      tags.push(`\\fs${Math.round((cue.fontSizePct / 100) * height)}`);
    }
    const override = tags.length > 0 ? `{${tags.join('')}}` : '';
    return `Dialogue: 0,${toAssTime(cue.start)},${toAssTime(cue.end)},Default,,0,0,0,,${override}${escapeAssText(cue.text)}`;
  });

  return `${header}\n${events.join('\n')}\n`;
}

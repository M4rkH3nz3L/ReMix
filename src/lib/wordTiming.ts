import type { SrtCue } from '@/lib/srt';
import type { TextClip, VideoClip } from '@/types/project';

/**
 * 🎤 Szó-szintű karaoke-időzítés — pure réteg.
 *
 * A karaoke eddig a klip hosszát osztotta el egyenletesen a szavak közt
 * (`duration / words.length`). Ez lassú, egyenletes beszédnél elmegy, de a
 * valóságban a szavak hossza nagyon eltér — a kiemelés így szisztematikusan
 * elcsúszik a kimondástól.
 *
 * Itt a Whisper SZÓ-SZINTŰ átiratához igazítjuk a felirat szavait, és a
 * klip-relatív időket a klipre írjuk. Ha az illesztés nem elég megbízható,
 * `null`-t adunk vissza — olyankor marad az egyenletes elosztás (jobb egy
 * kiszámítható közelítés, mint egy rossz igazítás).
 */

/** egy szó időzítése a klip elejéhez képest (mp) */
export interface WordTiming {
  /** kezdet a klip elejétől */
  t: number;
  /** hossz */
  d: number;
}

/** ennyi szót nézünk előre az illesztésnél (felirat-átfogalmazás tűrése) */
const LOOKAHEAD = 4;
/** ennyi találat alatt nem bízunk az illesztésben */
const MIN_MATCH_RATIO = 0.5;

/** összehasonlításhoz: kisbetű, írásjel és emoji nélkül */
export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * A forrás-idejű szó-cue-k átszámítása KLIP-RELATÍV időre.
 *
 * A cue-k a videófájl saját idejében vannak; a klip ebből a `trimIn`-től vág,
 * `speed`-szeres tempóval. A felirat-klip pedig a saját kezdetéhez képest
 * időzít — ezért kell a videó-idővonal-idő UTÁN a felirat kezdetét levonni.
 */
export function cuesToCaptionTime(
  cues: SrtCue[],
  video: VideoClip,
  caption: TextClip,
  tolerance = 0.35
): { text: string; start: number; end: number }[] {
  const out: { text: string; start: number; end: number }[] = [];
  for (const cue of cues) {
    // forrás-idő → idővonal-idő
    const tlStart = video.start + (cue.start - video.trimIn) / video.speed;
    const tlEnd = video.start + (cue.end - video.trimIn) / video.speed;
    // a klip látható ablakán kívüli cue nem érdekes
    if (tlEnd <= video.start || tlStart >= video.start + video.duration) {
      continue;
    }
    const start = tlStart - caption.start;
    const end = tlEnd - caption.start;
    // FONTOS: a FELIRAT ablakára is szűrni kell, nem csak a videóéra. Az
    // illesztő mohó és sorrendtartó, kis előrenézéssel — ha a teljes fájl
    // cue-listáját kapná, a második felirattól kezdve sosem érné el a saját
    // szavait, és minden felirat (az elsőt kivéve) igazítatlan maradna.
    if (end < -tolerance || start > caption.duration + tolerance) {
      continue;
    }
    out.push({ text: cue.text, start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A felirat szavainak illesztése a szó-cue-khoz.
 *
 * Mohó, sorrendtartó illesztés kis előrenézéssel: a felirat szövege és az
 * átirat nem mindig azonos (a Caption Studio emojit tesz a végére, a
 * felhasználó átírhatja a szöveget), ezért az illesztésnek tűrnie kell a
 * beszúrt/kihagyott szavakat. A nem illeszkedő szavak a szomszédjaik közt
 * lineárisan oszlanak el.
 *
 * @returns `null`, ha a szavak felénél kevesebb illeszkedett
 */
export function alignWordTimings(
  words: string[],
  cues: { text: string; start: number; end: number }[],
  duration: number
): WordTiming[] | null {
  if (words.length === 0 || cues.length === 0) {
    return null;
  }
  const normWords = words.map(normalizeWord);
  const normCues = cues.map((c) => ({ ...c, norm: normalizeWord(c.text) }));

  // 1) mohó illesztés
  const matched: (WordTiming | null)[] = new Array(words.length).fill(null);
  let cursor = 0;
  let hits = 0;
  for (let i = 0; i < normWords.length; i++) {
    const target = normWords[i];
    if (!target) {
      continue; // csak írásjel/emoji volt — nincs mit illeszteni
    }
    for (let k = cursor; k < Math.min(normCues.length, cursor + LOOKAHEAD); k++) {
      if (normCues[k].norm === target) {
        matched[i] = {
          t: normCues[k].start,
          d: Math.max(0.05, normCues[k].end - normCues[k].start),
        };
        cursor = k + 1;
        hits += 1;
        break;
      }
    }
  }
  const usable = normWords.filter(Boolean).length;
  if (usable === 0 || hits / usable < MIN_MATCH_RATIO) {
    return null;
  }

  // 2) a lyukak kitöltése: az ismert szomszédok közt egyenletesen
  const out: WordTiming[] = new Array(words.length);
  let prevEnd = 0;
  for (let i = 0; i < words.length; i++) {
    if (matched[i]) {
      out[i] = matched[i]!;
      prevEnd = out[i].t + out[i].d;
      continue;
    }
    // a következő ismert időpontig hány szót kell elosztani
    let next = i + 1;
    while (next < words.length && !matched[next]) {
      next += 1;
    }
    const gapEnd = next < words.length ? matched[next]!.t : duration;
    const count = next - i;
    const span = Math.max(0.05, gapEnd - prevEnd);
    const per = span / count;
    for (let k = 0; k < count; k++) {
      out[i + k] = { t: prevEnd + k * per, d: per };
    }
    prevEnd = gapEnd;
    i = next - 1;
  }

  // 3) a klip-ablakba szorítás + monoton sorrend (a render enable-ablakokat
  //    épít belőlük, ott a visszafelé lépés hibás filtergráfot adna)
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const t = Math.min(Math.max(out[i].t, last), Math.max(0, duration - 0.05));
    const d = Math.max(0.05, Math.min(out[i].d, duration - t));
    out[i] = { t: Math.round(t * 1000) / 1000, d: Math.round(d * 1000) / 1000 };
    last = out[i].t;
  }
  return out;
}

/**
 * Melyik szó aktív `t` klip-időben. Időzítés nélkül az egyenletes elosztásra
 * esik vissza — ugyanaz a szabály, mint a régi viselkedés.
 */
export function activeWordIndex(
  t: number,
  wordCount: number,
  duration: number,
  timings?: WordTiming[]
): number {
  if (wordCount <= 0) {
    return -1;
  }
  if (timings && timings.length === wordCount) {
    let idx = 0;
    for (let i = 0; i < timings.length; i++) {
      if (t >= timings[i].t) {
        idx = i;
      }
    }
    return idx;
  }
  const per = duration / wordCount;
  return Math.min(wordCount - 1, Math.max(0, Math.floor(t / per)));
}

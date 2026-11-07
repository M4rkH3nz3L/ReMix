import type { TimeRange } from '@/lib/audioSilence';
import type { WordItem } from '@/lib/textedit';
import type { AudioClip } from '@/types/project';

/**
 * ✂️💬 Beszédvágás szöveggel (Hang Stúdió) — tiszta mag. Az átirat szavai FORRÁS-időben
 * tárolódnak (fájlonként), és mindig a sáv aktuális klipjein át vetülnek az idővonalra: egy
 * vágás után a kivágott szavak maguktól eltűnnek, a többi a helyére csúszik — az átiratot nem
 * kell újra elkészíteni. A kijelölt szavak kivágása a csend-vágás útján megy (ripple, egy undo).
 */

/** egy szó (vagy token) forrás-időben */
export interface SrcWord {
  text: string;
  start: number;
  end: number;
}

/** az idővonalon látható szó; a `key` a forrás-azonosság (vágás után is ugyanaz) */
export interface TimelineWord extends WordItem {
  key: string;
}

/** a whisper nem-beszéd jelölései ([BLANK_AUDIO], [Music], (laughs) …) */
const NON_SPEECH = /^\s*[[(].*[\])]\s*$/;
/** csak írásjel: az előző szóhoz tartozik */
const PUNCT = /^[^\p{L}\p{N}]+$/u;

/**
 * A whisper token-szintű szegmensei (`maxLen: 1` + `tokenTimestamps`) → szavak: a szóközzel
 * kezdődő token új szót nyit, a többi (szórész, írásjel) az előzőhöz fűződik.
 */
export function tokensToWords(tokens: SrcWord[]): SrcWord[] {
  const out: SrcWord[] = [];
  // a szóközzel kezdődő írásjel-token (nyitó idézőjel: ` "` → `Um`) után új szó jön
  let forceNew = false;
  for (const tok of tokens) {
    if (!tok.text || NON_SPEECH.test(tok.text) || !(tok.end >= tok.start)) continue;
    const body = tok.text.trim();
    if (!body) continue;
    const last = out[out.length - 1];
    const spaced = /^\s/.test(tok.text);
    if (PUNCT.test(body)) {
      if (spaced) forceNew = true;
      else if (last) {
        last.text += body;
        last.end = Math.max(last.end, tok.end);
      }
      continue;
    }
    // a small modell az írásjel utáni szót néha szóköz nélkül adja („show” „,” „um”)
    if (spaced || forceNew || !last || (ENDS_PHRASE.test(last.text) && /^[\p{L}\p{N}]/u.test(body))) {
      out.push({ text: body, start: tok.start, end: tok.end });
    } else {
      last.text += body;
      last.end = Math.max(last.end, tok.end);
    }
    forceNew = false;
  }
  // az idézőjel nem a szó része (a small a töltelékeket idézőjelbe teszi)
  return out.map((w) => ({ ...w, text: w.text.replace(/["“”„]/g, '') })).filter((w) => w.text.length > 0);
}

/**
 * A sáv klipjein látható szavak idővonal-sorrendben. Egy szó akkor látszik, ha a közepe a klip
 * forrás-ablakába esik (a vágás szélén félig levágott szó a nagyobbik felénél marad).
 */
export function trackWords(clips: AudioClip[], wordsByUri: Map<string, SrcWord[]>): TimelineWord[] {
  const out: TimelineWord[] = [];
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    const words = wordsByUri.get(clip.uri);
    if (!words || (clip.loopLength && clip.loopLength > 0)) continue;
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    const from = clip.trimIn ?? 0;
    const to = from + clip.duration * speed;
    const toTimeline = (s: number) => (clip.reversed ? clip.start + (to - s) / speed : clip.start + (s - from) / speed);
    for (const w of words) {
      const mid = (w.start + w.end) / 2;
      if (mid < from || mid >= to) continue;
      const a = toTimeline(Math.max(from, w.start));
      const b = toTimeline(Math.min(to, w.end));
      out.push({
        key: `${clip.uri}@${w.start.toFixed(3)}`,
        text: w.text,
        uri: clip.uri,
        clipId: clip.id,
        srcStart: w.start,
        srcEnd: w.end,
        start: Math.min(a, b),
        end: Math.max(a, b),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A kijelölt szavak kivágandó idővonal-tartományai: az egymást követő kijelöltek egy
 * tartománnyá olvadnak; a széleken a szomszéd szóig tartó rés FELE is megy (így a vágás után a
 * szavak közti szünet természetes marad, és a szó lecsengése sem marad benn). Frame-rácson.
 */
export function wordCutRanges(words: TimelineWord[], selected: Set<string>, fps: number): TimeRange[] {
  const out: TimeRange[] = [];
  let i = 0;
  while (i < words.length) {
    if (!selected.has(words[i].key)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < words.length && selected.has(words[j + 1].key)) j++;
    // a szomszéd csak ugyanabban a klipben számít (a klipek közti rést nem vágjuk)
    const prev = words[i - 1]?.clipId === words[i].clipId ? words[i - 1] : undefined;
    const next = words[j + 1]?.clipId === words[j].clipId ? words[j + 1] : undefined;
    const start = prev ? Math.max(prev.end, (prev.end + words[i].start) / 2) : Math.max(0, words[i].start - 0.05);
    const end = next ? Math.min(next.start, (words[j].end + next.start) / 2) : words[j].end + 0.05;
    // a rácsra a kivágott szó FELÉ kerekít: a szomszéd szóba soha nem vág bele
    const a = Math.ceil(start * fps - 1e-6) / fps;
    const b = Math.floor(end * fps + 1e-6) / fps;
    if (b - a > 1e-6) out.push({ start: a, end: b });
    i = j + 1;
  }
  return out;
}

/** beszéd-sziget: két szünet közti hangos szakasz (forrás-idő) */
export interface SpeechIsland {
  start: number;
  end: number;
}

/**
 * A beszéd-szigetek a szintsorból (10 ms-os ablakok, `from` forrás-időtől): a küszöb fölötti
 * szakaszok, amelyeket legalább `minPause` hosszú csend választ el (a szón belüli zárhang-szünet
 * ennél rövidebb).
 */
export function speechIslands(levels: Float32Array, from: number, thresholdDb: number, win = 0.01, minPause = 0.08): SpeechIsland[] {
  const out: SpeechIsland[] = [];
  const gapN = Math.max(1, Math.round(minPause / win));
  let start = -1;
  let last = -1;
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] >= thresholdDb) {
      if (start >= 0 && i - last - 1 >= gapN) {
        out.push({ start: from + start * win, end: from + (last + 1) * win });
        start = i;
      } else if (start < 0) start = i;
      last = i;
    }
  }
  if (start >= 0) out.push({ start: from + start * win, end: from + (last + 1) * win });
  return out;
}

const ENDS_PHRASE = /[,.;:!?…"'”“)]$/;

/**
 * A whisper szó-időbélyegei a valódi hanghoz igazítva. A token-idők ismerten pontatlanok (a
 * szünetek körül akár egy szónyit csúsznak — mérve: a „show” az utána mondott „um” helyére
 * került), ezért a szavakat sorrendtartó DP rendeli a beszéd-szigetekhez: a költség a whisper-idő
 * távolsága a szigettől, büntetés jár a szünet nélküli írásjelért, az írásjel nélküli szünetért és
 * a kihagyott (szó nélküli) szigetért. Egy szigeten belül a szavak a whisper-hosszuk arányában
 * osztoznak, a sziget széleit pontosan követve: a belső határ a whisper saját határa, ha a
 * szigetbe esik (különben a whisper-hosszak aránya), majd ±60 ms-on belül a hang mélypontjára
 * igazítva (`levels`) — két szó közt a hang ott a leghalkabb.
 */
export function alignWordsToIslands(
  words: SrcWord[],
  islands: SpeechIsland[],
  levels?: { data: Float32Array; from: number; win: number }
): SrcWord[] {
  const N = words.length;
  const M = islands.length;
  if (N === 0 || M === 0) return words;
  const PUNCT_NO_PAUSE = 0.5;
  const PAUSE_NO_PUNCT = 0.15;
  const SKIP = 0.25;
  const MAX_SKIP = 3;
  const dist = (w: SrcWord, k: number) => {
    const c = (w.start + w.end) / 2;
    const isl = islands[k];
    return c < isl.start ? isl.start - c : c > isl.end ? c - isl.end : 0;
  };
  const cost = Array.from({ length: N }, () => new Float64Array(M).fill(Infinity));
  const from = Array.from({ length: N }, () => new Int32Array(M).fill(-1));
  for (let k = 0; k < M; k++) cost[0][k] = SKIP * k + dist(words[0], k);
  for (let i = 1; i < N; i++) {
    const punct = ENDS_PHRASE.test(words[i - 1].text);
    for (let k = 0; k < M; k++) {
      const d = dist(words[i], k);
      if (d > 5) continue;
      let best = Infinity;
      let arg = -1;
      for (let p = Math.max(0, k - MAX_SKIP - 1); p <= k; p++) {
        const prev = cost[i - 1][p];
        if (!Number.isFinite(prev)) continue;
        const step = p === k ? (punct ? PUNCT_NO_PAUSE : 0) : (punct ? 0 : PAUSE_NO_PUNCT) + SKIP * (k - p - 1);
        if (prev + step < best) {
          best = prev + step;
          arg = p;
        }
      }
      cost[i][k] = best + d;
      from[i][k] = arg;
    }
  }
  let k = -1;
  let best = Infinity;
  for (let q = 0; q < M; q++) {
    const c = cost[N - 1][q] + SKIP * (M - 1 - q);
    if (c < best) {
      best = c;
      k = q;
    }
  }
  if (k < 0) return words;
  const assign = new Int32Array(N);
  for (let i = N - 1; i >= 0; i--) {
    assign[i] = k;
    k = from[i][k];
  }
  /** a legcsendesebb pont `t` ±60 ms-os környezetében (a határok közt maradva) */
  const dip = (t: number, lo: number, hi: number) => {
    if (!levels) return t;
    let best = t;
    let bestDb = Infinity;
    for (let x = Math.max(lo, t - 0.06); x <= Math.min(hi, t + 0.06) + 1e-9; x += levels.win) {
      const k = Math.round((x - levels.from) / levels.win);
      const v = levels.data[k];
      if (v !== undefined && (v < bestDb - 1e-9 || (Math.abs(v - bestDb) < 1e-9 && Math.abs(x - t) < Math.abs(best - t)))) {
        bestDb = v;
        best = x;
      }
    }
    return best;
  };
  const out: SrcWord[] = words.map((w) => ({ ...w }));
  for (let i = 0; i < N; ) {
    let j = i;
    while (j + 1 < N && assign[j + 1] === assign[i]) j++;
    const isl = islands[assign[i]];
    const lens = words.slice(i, j + 1).map((w) => Math.max(0.02, w.end - w.start));
    const total = lens.reduce((a, b) => a + b, 0);
    let prop = isl.start;
    let prev = isl.start;
    out[i].start = isl.start;
    for (let q = i; q < j; q++) {
      prop += ((isl.end - isl.start) * lens[q - i]) / total;
      const raw = (words[q].end + words[q + 1].start) / 2;
      const lo = prev + 0.02;
      const hi = isl.end - 0.02 * (j - q);
      const b = dip(raw > lo && raw < hi ? raw : Math.min(hi, Math.max(lo, prop)), lo, hi);
      out[q].end = b;
      out[q + 1].start = b;
      prev = b;
    }
    out[j].end = isl.end;
    for (let q = i; q <= j; q++) {
      out[q].start = Math.round(out[q].start * 1000) / 1000;
      out[q].end = Math.round(out[q].end * 1000) / 1000;
    }
    i = j + 1;
  }
  return out;
}


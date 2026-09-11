import type { SilenceRange } from '@/lib/cutplan';
import type { SrtCue } from '@/lib/srt';
import type { Project, VideoClip } from '@/types/project';

/**
 * Text-based editing (P0‑3) — pure, expo-mentes modul: a szó-szintű Whisper
 * cue-k idővonalra képezése és a kijelölt szavak forrás-tartományokká
 * alakítása. A tényleges vágást a cutplan buildRangeCutPlan-je végzi
 * (ripple, egy undo-lépés).
 */

export interface WordItem {
  text: string;
  uri: string;
  /** forrás-idő (mp) */
  srcStart: number;
  srcEnd: number;
  /** idővonal-idő (mp) */
  start: number;
  end: number;
  clipId: string;
}

/** két szomszédos kijelölt szó közti rés eddig még összeolvad egy vágássá (mp) */
const MERGE_GAP = 0.12;

/**
 * A videósáv klipjein átszűrt szó-lista idővonal-sorrendben: minden szó a
 * trim/sebesség-helyes idővonal-idejével ÉS a forrás-idejével (a vágáshoz).
 */
export function timelineWords(
  project: Project,
  cuesByUri: Map<string, SrtCue[]>
): WordItem[] {
  const clips = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video')
    .sort((a, b) => a.start - b.start);

  const out: WordItem[] = [];
  for (const clip of clips) {
    const cues = cuesByUri.get(clip.uri) ?? [];
    const winStart = clip.trimIn;
    const winEnd = clip.trimIn + clip.duration * clip.speed;
    for (const cue of cues) {
      if (cue.end <= winStart || cue.start >= winEnd) {
        continue;
      }
      const srcStart = Math.max(cue.start, winStart);
      const srcEnd = Math.min(cue.end, winEnd);
      const text = cue.text.trim();
      if (!text) {
        continue;
      }
      out.push({
        text,
        uri: clip.uri,
        srcStart,
        srcEnd,
        start: clip.start + (srcStart - winStart) / clip.speed,
        end: clip.start + (srcEnd - winStart) / clip.speed,
        clipId: clip.id,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * A kijelölt szavak forrás-tartományai fájlonként, a szomszédosak/átfedők
 * összeolvasztva — a buildRangeCutPlan bemenete.
 */
export function selectedWordRanges(
  words: WordItem[],
  selected: Set<number>
): Map<string, SilenceRange[]> {
  const byUri = new Map<string, SilenceRange[]>();
  const picked = [...selected]
    .filter((i) => i >= 0 && i < words.length)
    .sort((a, b) => a - b)
    .map((i) => words[i]);

  for (const w of picked) {
    const list = byUri.get(w.uri) ?? [];
    const last = list[list.length - 1];
    if (last && w.srcStart - last.end <= MERGE_GAP && w.srcStart >= last.start) {
      last.end = Math.max(last.end, w.srcEnd);
    } else {
      list.push({ start: w.srcStart, end: w.srcEnd });
    }
    byUri.set(w.uri, list);
  }
  return byUri;
}

/** A kijelölés összes ideje (mp) — a megerősítő szöveghez. */
export function selectedSeconds(words: WordItem[], selected: Set<number>): number {
  let sum = 0;
  for (const i of selected) {
    const w = words[i];
    if (w) {
      sum += w.end - w.start;
    }
  }
  return sum;
}

/**
 * Töltelékszó-lexikon (P0‑4) — szándékosan konzervatív: csak az egyértelmű
 * hezitálás-hangok és töltelékek (a „hát”-féle kétértelműeket nem bántjuk).
 */
const FILLER_WORDS = new Set([
  // magyar hezitálás
  'ö', 'öö', 'ööö', 'őő', 'őőő', 'izé', 'izébe', 'hm', 'hmm', 'mm', 'mhm',
  'ee', 'eee', 'áá', 'ááá',
  // angol
  'um', 'umm', 'uh', 'uhh', 'er', 'err', 'erm', 'ah', 'ahh', 'like',
  'y’know', 'yknow',
]);

/** kisbetűsítés + írásjelek levágása a szó széleiről (a cue-k pontozottak) */
function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

/** A töltelékszavak indexei — a TranscriptPanel kijelölés-alapú review-jához. */
export function findFillerWords(words: WordItem[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < words.length; i++) {
    const norm = normalizeWord(words[i].text);
    if (norm && FILLER_WORDS.has(norm)) {
      out.push(i);
    }
  }
  return out;
}

/** szoros időköz, ameddig két azonos szó valódi dadogásnak/hamis kezdésnek számít (mp) */
const REPEAT_MAX_GAP = 0.6;

/**
 * Azonnali szó-ismétlések (dadogás / hamis kezdés): „a a a", „és és", „the the".
 * A KORÁBBI előfordulás(oka)t jelöli, az utolsót meghagyja. Csak UGYANABBAN a
 * klipben, SZOROS időközön belül — így a mondathatáron átnyúló, szándékos
 * ismétlést (pl. „nagyon nagyon jó" külön mondatban) nem bántja. On-device,
 * konzervatív; a felhasználó a törlés előtt átnézi (mint a töltelékeknél).
 */
export function findRepeatedWords(words: WordItem[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < words.length; i++) {
    const prev = normalizeWord(words[i - 1].text);
    const cur = normalizeWord(words[i].text);
    if (!cur || prev !== cur) {
      continue;
    }
    if (words[i].clipId !== words[i - 1].clipId) {
      continue;
    }
    if (words[i].start - words[i - 1].end > REPEAT_MAX_GAP) {
      continue;
    }
    out.push(i - 1); // a korábbit dobjuk, az utolsó (tisztább) kimondás marad
  }
  return out;
}

/**
 * Töltelék- ÉS ismételt szavak egyesített, rendezett indexei — a „töltelékek
 * kijelölése" művelet ezt használja (egy kattintás, review után törlés).
 */
export function findFillerAndRepeats(words: WordItem[]): number[] {
  const set = new Set<number>([...findFillerWords(words), ...findRepeatedWords(words)]);
  return [...set].sort((a, b) => a - b);
}

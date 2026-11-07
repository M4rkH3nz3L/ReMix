import { findFillerAndRepeats } from '@/lib/textedit';
import { alignWordsToIslands, speechIslands, tokensToWords, trackWords, wordCutRanges, type SrcWord } from '@/lib/speechEdit';
import { pcm16ForWhisper } from '@/lib/wav';
import type { AudioClip } from '@/types/project';

const tok = (text: string, start: number, end: number): SrcWord => ({ text, start, end });

describe('💬 tokensToWords', () => {
  it('a szóközös token új szót nyit, a szórész és az írásjel az előzőhöz fűződik', () => {
    const w = tokensToWords([tok(' Hel', 0, 0.2), tok('lo', 0.2, 0.4), tok(',', 0.4, 0.42), tok(' um', 0.5, 0.7), tok(' [BLANK_AUDIO]', 0.7, 2), tok(' world', 2, 2.5), tok('.', 2.5, 2.5)]);
    expect(w).toEqual([tok('Hello,', 0, 0.42), tok('um', 0.5, 0.7), tok('world.', 2, 2.5)]);
  });
});

describe('💬 trackWords', () => {
  const words = new Map([['f', [tok('a', 1, 1.4), tok('b', 2, 2.4), tok('c', 3, 3.4), tok('d', 4, 4.4)]]]);
  const clip = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', id: 'x', uri: 'f', label: 'x', start: 0, duration: 5, trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported', ...over }) as AudioClip;
  it('a vágás után a kivágott szó eltűnik, a többi a helyére csúszik (újra-átírás nélkül)', () => {
    // a 2–3 s közötti rész kivágva: két darab
    const w = trackWords([clip({ id: 'p', duration: 1.9 }), clip({ id: 'q', start: 1.9, duration: 2.6, trimIn: 2.6 })], words);
    expect(w.map((x) => `${x.text}@${x.start.toFixed(1)}`)).toEqual(['a@1.0', 'c@2.3', 'd@3.3']);
    expect(w[1].key).toBe('f@3.000');
  });
  it('sebesség: az idővonal-idő a forrás / sebesség', () => {
    const w = trackWords([clip({ start: 10, speed: 2, duration: 2.5 })], words);
    expect(w.map((x) => +x.start.toFixed(2))).toEqual([10.5, 11, 11.5, 12]);
  });
});

describe('💬 wordCutRanges', () => {
  const words = trackWords(
    [{ kind: 'audio', id: 'x', uri: 'f', label: 'x', start: 0, duration: 6, trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' } as AudioClip],
    new Map([['f', [tok('so', 0.5, 0.9), tok('um', 1.1, 1.3), tok('uh', 1.4, 1.6), tok('we', 2.0, 2.3), tok('go', 2.5, 2.9)]]])
  );
  it('a szomszédos kijelöltek egy tartomány; a széleken a rés fele is megy; frame-rácson', () => {
    const r = wordCutRanges(words, new Set([words[1].key, words[2].key]), 100);
    expect(r).toEqual([{ start: 1, end: 1.8 }]);
  });
  it('a töltelékek felismerése a közös lexikonnal', () => {
    expect(findFillerAndRepeats(words)).toEqual([1, 2]);
  });
});

describe('🎙️ pcm16ForWhisper', () => {
  it('előjeles 16 bites PCM, levágva ±1-re', () => {
    expect(Array.from(new Int16Array(pcm16ForWhisper(Float32Array.from([0, 0.5, -1, 2]))))).toEqual([0, 16384, -32767, 32767]);
  });
});

describe('🎯 szavak a valódi hanghoz igazítva (iPaden mért whisper-tokenek + a hang szigetei)', () => {
  // a whisper base nyers tokenjei a felolvasott próbamondatra (2026-11-07, iPad)
  const raw = '[ Hello]0.05-0.41 [ and]0.41-0.66 [ welcome]0.66-1.24 [ to]1.24-1.40 [ the]1.40-1.76 [ show]1.76-2.00 [,]2.00-2.14 [ um]2.14-2.22 [,]2.22-2.30 [ today]2.30-2.60 [ we]2.60-2.82 [ talk]2.82-3.05 [ about]3.05-3.60 [,]3.60-3.67 [ uh]3.67-3.88 [,]3.88-4.19 [ editing]4.19-4.71 [ audio]4.71-5.19 [ with]5.19-5.43 [ text]5.43-5.92 [,]5.92-5.92 [ delete]5.92-6.34 [ a]6.34-6.41 [ word]6.41-6.69 [,]6.69-6.83 [ and]6.83-7.04 [ the]7.04-7.25 [ sound]7.25-7.68 [ is]7.68-7.74 [ cut]7.74-8.00 [.]8.00-8.00';
  const tokens = [...raw.matchAll(/\[([^\]]*)\]([\d.]+)-([\d.]+)/g)].map((m) => tok(m[1], +m[2], +m[3]));
  // a hang valódi beszéd-szigetei (10 ms-os szint, −45 dB, ffmpeg-gel mérve)
  const islands = [[0.02, 1.53], [1.76, 2.06], [2.29, 3.41], [3.67, 4.0], [4.19, 5.12], [5.18, 5.73], [5.99, 6.72], [6.93, 7.96]].map(([start, end]) => ({ start, end }));
  const aligned = alignWordsToIslands(tokensToWords(tokens), islands);
  const at = (w: string) => aligned.find((x) => x.text.replace(/[,.]/g, '') === w)!;
  it('a whisper a „show”-t az „um” helyére tette — az igazítás után mindkettő a saját szigetén', () => {
    expect(tokensToWords(tokens).find((x) => x.text === 'um,')!.start).toBe(2.14); // a nyers idő a szünetben
    expect(at('show').end).toBe(1.53);
    expect([at('um').start, at('um').end]).toEqual([1.76, 2.06]);
    expect([at('uh').start, at('uh').end]).toEqual([3.67, 4]);
    expect(at('today').start).toBe(2.29);
    expect(aligned.map((w) => w.text).join(' ')).toBe(tokensToWords(tokens).map((w) => w.text).join(' '));
  });
  it('az „um” kivágása a szünetek közepén vág — a „show” és a „today” érintetlen', () => {
    const clip = { kind: 'audio', id: 'c', uri: 'f', label: 'c', start: 0, duration: 8.2, trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' } as AudioClip;
    const words = trackWords([clip], new Map([['f', aligned]]));
    const [r] = wordCutRanges(words, new Set([words.find((w) => w.text === 'um,')!.key]), 100);
    expect(r.start).toBeGreaterThan(1.53);
    expect(r.start).toBeLessThan(1.76);
    expect(r.end).toBeGreaterThan(2.06);
    expect(r.end).toBeLessThan(2.29);
  });
  it('szigeten belül: a whisper-határ a hang mélypontjára igazodik („editing|audio” → 4,69 s)', () => {
    // az „editing audio” mért 10 ms-os szintjei 4,19-től (dB)
    const db = [-30, -15, -15, -13, -13, -13, -13, -13, -14, -14, -17, -21, -21, -17, -14, -13, -13, -13, -14, -15, -20, -22, -20, -15, -13, -13, -13, -12, -13, -12, -12, -12, -12, -12, -13, -13, -13, -13, -13, -13, -14, -13, -13, -14, -14, -15, -13, -14, -15, -20, -22, -19, -14, -12, -12, -12, -12, -12, -12, -12, -13, -13, -14, -13, -13, -13, -14, -14, -13, -13, -15, -13, -13, -14, -15, -16, -17, -16, -15, -15, -13, -13, -14, -13, -14, -16, -20, -26, -30, -35, -40, -38, -39];
    const lv = { data: Float32Array.from(db), from: 4.19, win: 0.01 };
    const out = alignWordsToIslands([tok('editing', 4.19, 4.71), tok('audio', 4.71, 5.19)], [{ start: 4.19, end: 5.12 }], lv);
    expect(out[0].end).toBe(4.69);
    expect(out[1].start).toBe(4.69);
  });
  it('a vágás széle a kivágott szó felé kerekít a rácsra (a szomszédba nem vág)', () => {
    const ws = trackWords(
      [{ kind: 'audio', id: 'x', uri: 'g', label: 'x', start: 0, duration: 6, trimIn: 0, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' } as AudioClip],
      new Map([['g', [tok('editing', 4.19, 4.69), tok('audio', 4.69, 5.12), tok('with', 5.18, 5.43)]]])
    );
    const [r] = wordCutRanges(ws, new Set([ws[1].key]), 30);
    expect(r.start).toBeGreaterThanOrEqual(4.69);
    expect(r.end).toBeLessThanOrEqual(5.15);
  });
  it('szigetek a szintsorból: a rövid (zárhang) szünet nem bont', () => {
    const lv = Float32Array.from([-80, -20, -20, -60, -20, -20, -80, -80, -80, -80, -80, -80, -80, -80, -80, -20, -80]);
    expect(speechIslands(lv, 1, -45)).toEqual([{ start: 1.01, end: 1.06 }, { start: 1.15, end: 1.16 }]);
  });
});

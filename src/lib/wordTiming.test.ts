import { activeWordIndex, alignWordTimings, cuesToCaptionTime, normalizeWord } from '@/lib/wordTiming';
import type { TextClip, VideoClip } from '@/types/project';

// 🎤 Szó-szintű karaoke-időzítés (Whisper-illesztés) regressziós pajzsa. Pure.

describe('normalizeWord', () => {
  it('kisbetű + írásjel/emoji levágás', () => {
    expect(normalizeWord('Hello,')).toBe('hello');
    expect(normalizeWord('wörld!')).toBe('wörld');
    expect(normalizeWord('🎉')).toBe('');
  });
});

describe('activeWordIndex', () => {
  it('időzítéssel: a legutolsó, t-nél nem későbbi szó', () => {
    const timings = [{ t: 0, d: 0.5 }, { t: 0.5, d: 0.5 }, { t: 1, d: 0.5 }];
    expect(activeWordIndex(0, 3, 1.5, timings)).toBe(0);
    expect(activeWordIndex(0.6, 3, 1.5, timings)).toBe(1);
    expect(activeWordIndex(2, 3, 1.5, timings)).toBe(2);
  });
  it('időzítés nélkül: egyenletes elosztás', () => {
    expect(activeWordIndex(2.5, 4, 4)).toBe(2); // per=1 → floor(2.5)
    expect(activeWordIndex(0, 4, 4)).toBe(0);
  });
  it('nincs szó → -1', () => {
    expect(activeWordIndex(1, 0, 4)).toBe(-1);
  });
});

describe('alignWordTimings', () => {
  it('üres szó/cue → null', () => {
    expect(alignWordTimings([], [{ text: 'a', start: 0, end: 1 }], 1)).toBeNull();
    expect(alignWordTimings(['a'], [], 1)).toBeNull();
  });

  it('teljes egyezés → a cue-időket adja vissza', () => {
    const out = alignWordTimings(
      ['hello', 'world'],
      [{ text: 'hello', start: 0, end: 0.5 }, { text: 'world', start: 0.5, end: 1 }],
      1
    )!;
    expect(out).toHaveLength(2);
    expect(out[0].t).toBeCloseTo(0, 2);
    expect(out[1].t).toBeCloseTo(0.5, 2);
  });

  it('az illesztési arány MIN_MATCH_RATIO (0.5) alatt → null', () => {
    const out = alignWordTimings(
      ['a', 'b', 'c', 'd'],
      [{ text: 'a', start: 0, end: 0.2 }], // 1/4 = 0.25
      1
    );
    expect(out).toBeNull();
  });

  it('a nem illeszkedő szó a szomszédok közt oszlik el', () => {
    const out = alignWordTimings(
      ['hello', 'xxx', 'world'],
      [{ text: 'hello', start: 0, end: 0.4 }, { text: 'world', start: 0.8, end: 1 }],
      1
    )!;
    expect(out).toHaveLength(3);
    expect(out[1].t).toBeCloseTo(0.4, 2); // a rés elejére került
    // monoton
    expect(out[2].t).toBeGreaterThanOrEqual(out[1].t);
  });
});

describe('cuesToCaptionTime — forrás-idő → felirat-relatív', () => {
  const video = { id: 'v', kind: 'video', start: 0, trimIn: 0, speed: 1, duration: 10 } as VideoClip;
  const caption = { id: 'c', kind: 'text', start: 2, duration: 5 } as TextClip;

  it('az ablakon belüli cue felirat-relatív idővel, a kívüli kiesik', () => {
    const out = cuesToCaptionTime(
      [
        { text: 'in', start: 3, end: 4 }, // tl 3..4 → caption 1..2 (bent)
        { text: 'out', start: 0, end: 0.5 }, // caption -2..-1.5 (kint)
      ],
      video,
      caption
    );
    expect(out.map((c) => c.text)).toEqual(['in']);
    expect(out[0].start).toBeCloseTo(1, 2);
    expect(out[0].end).toBeCloseTo(2, 2);
  });
});

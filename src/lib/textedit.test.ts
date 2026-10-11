import {
  findFillerAndRepeats,
  findFillerWords,
  findRepeatedWords,
  selectedSeconds,
  selectedWordRanges,
  timelineWords,
  type WordItem,
} from '@/lib/textedit';
import type { SrtCue } from '@/lib/srt';
import type { Project } from '@/types/project';

// ✂️ Text-based editing (szó-szintű vágás: töltelék/ismétlés + kijelölés →
// forrás-tartomány) regressziós pajzsa. Pure → tesztelhető.

const word = (over: Partial<WordItem>): WordItem => ({
  text: 'x', uri: 'v', srcStart: 0, srcEnd: 0.3, start: 0, end: 0.3, clipId: 'c', ...over,
});

describe('timelineWords — a videósáv szavai idővonal + forrás-idővel', () => {
  it('a trim/sebesség-helyes időket adja; üres szöveg kiesik', () => {
    const project = {
      id: 'p', name: 'T', aspectRatio: '9:16', fps: 30,
      tracks: [{ id: 't', type: 'video', name: 'v', clips: [
        { id: 'c', kind: 'video', start: 0, duration: 10, uri: 'v', trimIn: 0, speed: 1, sourceDuration: 10, volume: 1, filterId: 'none' },
      ] }],
      assets: [], createdAt: '', updatedAt: '', schemaVersion: 6,
    } as unknown as Project;
    const cues = new Map<string, SrtCue[]>([['v', [
      { text: 'hi', start: 1, end: 2 },
      { text: '   ', start: 2, end: 3 }, // üres → kiesik
    ]]]);
    const out = timelineWords(project, cues);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: 'hi', uri: 'v', srcStart: 1, srcEnd: 2, start: 1, end: 2, clipId: 'c' });
  });
});

describe('selectedWordRanges — a kijelölt szavak forrás-tartományai', () => {
  it('a szomszédos (MERGE_GAP-en belüli) kijelölt szavak egy tartománnyá olvadnak', () => {
    const words = [
      word({ srcStart: 0, srcEnd: 0.5 }),
      word({ srcStart: 0.55, srcEnd: 1.0 }), // rés 0.05 ≤ 0.12 → összeolvad
    ];
    const ranges = selectedWordRanges(words, new Set([0, 1]));
    expect(ranges.get('v')).toEqual([{ start: 0, end: 1.0 }]);
  });

  it('a távoli szavak külön tartományok maradnak', () => {
    const words = [
      word({ srcStart: 0, srcEnd: 0.5 }),
      word({ srcStart: 2, srcEnd: 2.5 }), // rés 1.5 > 0.12
    ];
    expect(selectedWordRanges(words, new Set([0, 1])).get('v')).toHaveLength(2);
  });
});

describe('selectedSeconds', () => {
  it('a kijelölt szavak idővonal-hosszának összege', () => {
    const words = [word({ start: 0, end: 0.5 }), word({ start: 1, end: 2 }), word({ start: 3, end: 3.2 })];
    expect(selectedSeconds(words, new Set([0, 1]))).toBeCloseTo(1.5, 3);
  });
});

describe('findFillerWords', () => {
  it('a hezitálás/töltelék szavakat jelöli (magyar + angol), mást nem', () => {
    const words = [word({ text: 'öö' }), word({ text: 'hello' }), word({ text: 'Um,' }), word({ text: 'világ' })];
    expect(findFillerWords(words)).toEqual([0, 2]);
  });
});

describe('findRepeatedWords — azonnali ismétlés (dadogás)', () => {
  it('ugyanaz a szó, ugyanaz a klip, szoros időköz → a KORÁBBIT jelöli', () => {
    const words = [
      word({ text: 'the', start: 0, end: 0.2, clipId: 'a' }),
      word({ text: 'the', start: 0.3, end: 0.5, clipId: 'a' }), // gap 0.1 ≤ 0.6
      word({ text: 'world', start: 0.6, end: 1, clipId: 'a' }),
    ];
    expect(findRepeatedWords(words)).toEqual([0]);
  });
  it('nagy időköz VAGY más klip → nem ismétlés', () => {
    const farGap = [
      word({ text: 'na', start: 0, end: 0.2, clipId: 'a' }),
      word({ text: 'na', start: 2, end: 2.2, clipId: 'a' }), // gap 1.8 > 0.6
    ];
    expect(findRepeatedWords(farGap)).toEqual([]);
    const otherClip = [
      word({ text: 'na', start: 0, end: 0.2, clipId: 'a' }),
      word({ text: 'na', start: 0.3, end: 0.5, clipId: 'b' }),
    ];
    expect(findRepeatedWords(otherClip)).toEqual([]);
  });
});

describe('findFillerAndRepeats', () => {
  it('a töltelék + ismétlés indexek egyesített, rendezett halmaza', () => {
    const words = [
      word({ text: 'the', start: 0, end: 0.2, clipId: 'a' }),
      word({ text: 'the', start: 0.3, end: 0.5, clipId: 'a' }), // ismétlés → 0
      word({ text: 'öö', start: 0.6, end: 0.8, clipId: 'a' }), // töltelék → 2
    ];
    expect(findFillerAndRepeats(words)).toEqual([0, 2]);
  });
});

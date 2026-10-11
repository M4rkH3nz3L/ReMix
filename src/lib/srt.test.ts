import { mapCuesToTimeline, parseSrt, serializeSrt, type CueMapClip, type SrtCue } from '@/lib/srt';

// 📝 SRT felirat (import/export + idővonal-leképezés) pure pajzsa.

describe('parseSrt', () => {
  it('sorszámos blokkokat parse-ol (CRLF + BOM tűrve)', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld';
    expect(parseSrt(srt)).toEqual([
      { start: 1, end: 2.5, text: 'Hello' },
      { start: 3, end: 4, text: 'World' },
    ]);
  });
  it('sorszám nélküli blokk + pontos (.) ezredmásodperc is megy', () => {
    expect(parseSrt('00:00:00.250 --> 00:00:01.000\nHi')).toEqual([{ start: 0.25, end: 1, text: 'Hi' }]);
  });
  it('érvénytelen idő / end<=start / üres szöveg → kihagyva', () => {
    expect(parseSrt('bad\nnincs idő\n')).toEqual([]);
    expect(parseSrt('1\n00:00:02,000 --> 00:00:01,000\nvissza')).toEqual([]);
  });
});

describe('serializeSrt — round-trip', () => {
  it('parse(serialize(x)) == x', () => {
    const cues: SrtCue[] = [{ start: 1, end: 2.5, text: 'Hello' }, { start: 3, end: 4, text: 'Multi\nline' }];
    expect(parseSrt(serializeSrt(cues))).toEqual(cues);
  });
});

describe('mapCuesToTimeline — forrás-cue → idővonal a klip-ablakon át', () => {
  const clip = (over: Partial<CueMapClip>): CueMapClip => ({ uri: 'v', start: 0, duration: 10, trimIn: 0, speed: 1, ...over });

  it('a levágott részhez tartozó cue kiesik, az átlógó levágódik', () => {
    const cues = new Map<string, SrtCue[]>([['v', [
      { start: 1, end: 2, text: 'in' },
      { start: 50, end: 51, text: 'out' }, // a forrás-ablakon kívül
    ]]]);
    const out = mapCuesToTimeline([clip({ trimIn: 0, duration: 10 })], cues);
    expect(out).toEqual([{ start: 1, end: 2, text: 'in' }]);
  });

  it('a trimIn-t és a sebességet beszámítja', () => {
    // trimIn 5, speed 2 → a forrás 6..8 cue → idővonal (6-5)/2=0.5 .. (8-5)/2=1.5
    const cues = new Map<string, SrtCue[]>([['v', [{ start: 6, end: 8, text: 'x' }]]]);
    const out = mapCuesToTimeline([clip({ trimIn: 5, duration: 5, speed: 2 })], cues);
    expect(out[0].start).toBeCloseTo(0.5, 3);
    expect(out[0].end).toBeCloseTo(1.5, 3);
  });
});

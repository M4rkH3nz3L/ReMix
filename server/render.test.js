// ⏪ Reverse render-matek (audit §6.3) — a szegmens forrás-ablaka normál vs reversed.
// Konzisztens a kliens projectUtils.sourceTimeAt-tal (preview==render parity).
const { segSourceWindow } = require('./render');

// klip: trimIn=1, duration=4 (idővonal), speed=1 → forrás-szakasz [1, 5]
const clip = (over = {}) => ({ trimIn: 1, duration: 4, speed: 1, ...over });

describe('segSourceWindow — normál', () => {
  test('az egész klip egy szegmensként: [trimIn, trimIn+dur*speed]', () => {
    expect(segSourceWindow(clip(), { skip: 0, duration: 4 })).toEqual({ srcStart: 1, srcEnd: 5 });
  });
  test('részszegmens eltolással', () => {
    expect(segSourceWindow(clip(), { skip: 1, duration: 2 })).toEqual({ srcStart: 2, srcEnd: 4 });
  });
  test('speed=2 → kétszeres forrás-szakasz', () => {
    expect(segSourceWindow(clip({ speed: 2 }), { skip: 0, duration: 2 })).toEqual({ srcStart: 1, srcEnd: 5 });
  });
});

describe('segSourceWindow — reversed (tükrözött ablak)', () => {
  test('az egész klip: ugyanaz a [trimIn, trimIn+dur*speed] ablak (a reverse filter fordít)', () => {
    expect(segSourceWindow(clip({ reversed: true }), { skip: 0, duration: 4 })).toEqual({
      srcStart: 1,
      srcEnd: 5,
    });
  });
  test('az ELSŐ idővonal-szegmens a forrás VÉGÉT mutatja', () => {
    // skip=0, dur=2 → reversed: [trimIn+(4-0-2)*1, …] = [3, 5] (a forrás hátsó fele)
    expect(segSourceWindow(clip({ reversed: true }), { skip: 0, duration: 2 })).toEqual({
      srcStart: 3,
      srcEnd: 5,
    });
  });
  test('az UTOLSÓ idővonal-szegmens a forrás ELEJÉT mutatja', () => {
    // skip=2, dur=2 → reversed: [1, 3] (a forrás eleje)
    expect(segSourceWindow(clip({ reversed: true }), { skip: 2, duration: 2 })).toEqual({
      srcStart: 1,
      srcEnd: 3,
    });
  });
  test('az ablak-hossz mindig seg.duration*speed (ugyanannyi forrás, mint előre)', () => {
    for (const skip of [0, 1, 2]) {
      const w = segSourceWindow(clip({ reversed: true }), { skip, duration: 1 });
      expect(w.srcEnd - w.srcStart).toBeCloseTo(1);
    }
  });
});

import { clipInWindow, windowFor, type PxWindow } from '@/lib/virtualize';

describe('clipInWindow', () => {
  const pps = 60;
  const win: PxWindow = { start: 600, end: 1200 }; // 10s … 20s @ 60pps

  it('null ablaknál minden látszik (virtualizáció ki)', () => {
    expect(clipInWindow({ start: 0, duration: 1 }, null, pps)).toBe(true);
    expect(clipInWindow({ start: 9999, duration: 1 }, null, pps)).toBe(true);
  });

  it('ablakon belüli klip látszik', () => {
    expect(clipInWindow({ start: 12, duration: 2 }, win, pps)).toBe(true); // 720..840
  });

  it('ablakot átfedő (bal/jobb túllógó) klip látszik', () => {
    expect(clipInWindow({ start: 8, duration: 5 }, win, pps)).toBe(true); // 480..780
    expect(clipInWindow({ start: 19, duration: 5 }, win, pps)).toBe(true); // 1140..1440
  });

  it('ablak előtti / utáni klip nem látszik', () => {
    expect(clipInWindow({ start: 0, duration: 5 }, win, pps)).toBe(false); // 0..300
    expect(clipInWindow({ start: 30, duration: 2 }, win, pps)).toBe(false); // 1800..1920
  });

  it('csak érintő (bele nem érő) klip nem látszik', () => {
    // jobb él pontosan az ablak bal élén (right === win.start) → nem látszik
    expect(clipInWindow({ start: 5, duration: 5 }, win, pps)).toBe(false); // 300..600
  });
});

describe('windowFor', () => {
  it('scrollX köré centrált, overscannel', () => {
    // viewportW=400, overscan=1.5*400=600 → fél viewport 200
    // start = 1000 - 200 - 600 = 200 ; end = 1000 + 200 + 600 = 1800
    expect(windowFor(1000, 400, 1.5)).toEqual({ start: 200, end: 1800 });
  });

  it('nulla overscannél csak a fél-viewport puffer marad', () => {
    expect(windowFor(1000, 400, 0)).toEqual({ start: 800, end: 1200 });
  });
});

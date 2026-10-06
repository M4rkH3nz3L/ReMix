import { frameIndexAt, gifDuration, loopCountAt, type GifFrame } from '@/lib/gifTiming';

const frames: GifFrame[] = [{ delayMs: 100 }, { delayMs: 200 }, { delayMs: 100 }]; // össz 400 ms

describe('gifDuration', () => {
  it('a kocka-késleltetések összege', () => {
    expect(gifDuration(frames)).toBe(400);
    expect(gifDuration([])).toBe(0);
  });
  it('a 0/negatív/NaN késleltetés 100 ms-ra pótlódik', () => {
    expect(gifDuration([{ delayMs: 0 }, { delayMs: -5 }, { delayMs: NaN }])).toBe(300);
  });
});

describe('frameIndexAt', () => {
  it('az intervallumokba sorol (0–100 → 0, 100–300 → 1, 300–400 → 2)', () => {
    expect(frameIndexAt(frames, 0)).toBe(0);
    expect(frameIndexAt(frames, 50)).toBe(0);
    expect(frameIndexAt(frames, 100)).toBe(1);
    expect(frameIndexAt(frames, 250)).toBe(1);
    expect(frameIndexAt(frames, 300)).toBe(2);
    expect(frameIndexAt(frames, 399)).toBe(2);
  });

  it('loop=true: a cikluson túl újrakezd', () => {
    expect(frameIndexAt(frames, 400)).toBe(0); // 400 % 400 = 0
    expect(frameIndexAt(frames, 450)).toBe(0);
    expect(frameIndexAt(frames, 550)).toBe(1); // 150 → 2. kocka
  });

  it('loop=false: a végén az utolsó kockán marad', () => {
    expect(frameIndexAt(frames, 400, false)).toBe(2);
    expect(frameIndexAt(frames, 99999, false)).toBe(2);
  });

  it('negatív idő → 0. kocka; üres lista → -1', () => {
    expect(frameIndexAt(frames, -100)).toBe(0);
    expect(frameIndexAt([], 10)).toBe(-1);
  });
});

describe('loopCountAt', () => {
  it('hányadik teljes ciklus', () => {
    expect(loopCountAt(frames, 0)).toBe(0);
    expect(loopCountAt(frames, 399)).toBe(0);
    expect(loopCountAt(frames, 400)).toBe(1);
    expect(loopCountAt(frames, 850)).toBe(2);
  });
});

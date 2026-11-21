import {
  MAX_SEC,
  SPEEDS,
  clipTimelineDuration,
  countdownLeft,
  formatRecordTime,
  recordedSourceDuration,
} from '@/lib/cameraRecorderOps';

describe('cameraRecorderOps — a kamera-felvevő tiszta magja', () => {
  it('a korlátok: 60 mp auto-stop, 4 sebesség-preset sorrendben', () => {
    expect(MAX_SEC).toBe(60);
    expect(SPEEDS).toEqual([0.5, 1, 2, 3]);
  });

  it('a felvételi idő m:ss, lefelé kerekítve', () => {
    expect(formatRecordTime(0)).toBe('0:00');
    expect(formatRecordTime(9.99)).toBe('0:09');
    expect(formatRecordTime(59.9)).toBe('0:59');
    expect(formatRecordTime(60)).toBe('1:00');
    expect(formatRecordTime(125.4)).toBe('2:05');
  });

  it('a forrás-hossz tizedre kerekít, legalább 0,5 mp', () => {
    expect(recordedSourceDuration(0)).toBe(0.5);
    expect(recordedSourceDuration(0.44)).toBe(0.5);
    expect(recordedSourceDuration(0.55)).toBe(0.6);
    expect(recordedSourceDuration(3.44)).toBe(3.4);
    expect(recordedSourceDuration(60.2)).toBe(60.2);
  });

  it('a klip idővonal-hossza a sebességgel osztva, legalább 0,3 mp', () => {
    expect(clipTimelineDuration(4.6, 2)).toBe(2.3);
    expect(clipTimelineDuration(0.5, 0.5)).toBe(1);
    expect(clipTimelineDuration(0.5, 3)).toBe(0.3);
    expect(clipTimelineDuration(3, 1)).toBe(3);
  });

  it('a visszaszámláló: 3 → 2 → 1 → 0 egész másodpercenként', () => {
    expect(countdownLeft(1000, 1000)).toBe(3);
    expect(countdownLeft(1000, 1999)).toBe(3);
    expect(countdownLeft(1000, 2000)).toBe(2);
    expect(countdownLeft(1000, 3999)).toBe(1);
    expect(countdownLeft(1000, 4000)).toBe(0);
    expect(countdownLeft(1000, 9000)).toBe(-5);
  });
});

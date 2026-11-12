import { DEFAULT_METER } from '@/lib/audioTransport';
import { addMetronome, CLICK_SEC, clickSample, metronomeClicks } from '@/lib/metronome';
import { metronomeWindow, openTakePlacement, PUNCH_LEAD } from '@/lib/punchRecord';

/** ⏱️ AP4: a metronóm a rácson, mintapontosan, szelet-határon is folytonosan. */
const SR = 44100;
describe('⏱️ metronóm', () => {
  it('a klikkek a beateken, az ütem-egy hangsúlyos (4/4 és 6/8)', () => {
    const c = metronomeClicks(0, 2.01, 120, DEFAULT_METER);
    expect(c.map((x) => x.t)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(c.map((x) => x.accent)).toEqual([true, false, false, false, true]);
    const six = metronomeClicks(0, 1.6, 120, { beatsPerBar: 6, beatUnit: 8 });
    expect(six.map((x) => x.t)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
    expect(six[6].accent).toBe(true);
    // a tartomány közepétől: csak az ott induló klikkek
    expect(metronomeClicks(0.7, 1.2, 120, DEFAULT_METER).map((x) => x.beat)).toEqual([2]);
  });

  it('a szeletekre bontott hozzáadás = az egyben hozzáadás (a határon átnyúló klikk is), mintapontos kezdet', () => {
    const cfg = { bpm: 93, meter: DEFAULT_METER, gain: 0.7 };
    const n = 3 * SR;
    const whole = [new Float32Array(n), new Float32Array(n)];
    addMetronome(whole, 0, n, SR, cfg);
    const parts = [new Float32Array(n), new Float32Array(n)];
    const CH = Math.round(0.125 * SR);
    for (let a = 0; a < n; a += CH) {
      const b = Math.min(n, a + CH);
      const o = [new Float32Array(b - a), new Float32Array(b - a)];
      addMetronome(o, a, b, SR, cfg);
      parts[0].set(o[0], a);
      parts[1].set(o[1], a);
    }
    expect(Array.from(parts[0])).toEqual(Array.from(whole[0]));
    // a 2. beat pontosan round(60/93 · SR)-nél kezdődik
    const at = Math.round((60 / 93) * SR);
    expect(whole[0][at - 1]).toBe(0);
    expect(whole[0][at + 1]).toBeCloseTo(0.7 * clickSample(false, 1, SR), 6);
    expect(whole[0][at + Math.round(CLICK_SEC * SR)]).toBe(0);
  });

  it('nulla hangerőnél semmi nem változik', () => {
    const o = [new Float32Array(SR)];
    addMetronome(o, 0, SR, SR, { bpm: 120, meter: DEFAULT_METER, gain: 0 });
    expect(o[0].every((v) => v === 0)).toBe(true);
  });
});

describe('⏱️🎙️ metronómos felvétel', () => {
  it('az ablak: az előszámlálásnyi előgörgetés, a felvevő kicsit a lejátszófej előtt, nyitott vég', () => {
    const w = metronomeWindow(4, 1, 120, DEFAULT_METER);
    expect(w).toMatchObject({ playFrom: 2, recordAt: 4 - PUNCH_LEAD, in: 4 });
    expect(w.stopAt).toBe(Number.POSITIVE_INFINITY);
    // az elején: nincs negatív idő
    expect(metronomeWindow(0.5, 2, 120, DEFAULT_METER)).toMatchObject({ playFrom: 0, recordAt: 0.2, in: 0.5 });
    expect(metronomeWindow(3, 0, 120, DEFAULT_METER).playFrom).toBe(3);
  });
  it('a take a lejátszófejtől szól, az előtte felvett rész levágva; túl rövid → null', () => {
    expect(openTakePlacement({ seconds: 5, startAt: 3.7 }, 4)).toEqual({ start: 4, trimIn: expect.closeTo(0.3, 9), duration: expect.closeTo(4.7, 9) });
    // a felvevő késett: a tényleges kezdettől
    expect(openTakePlacement({ seconds: 5, startAt: 4.05 }, 4)).toEqual({ start: 4.05, trimIn: 0, duration: 5 });
    expect(openTakePlacement({ seconds: 0.35, startAt: 3.7 }, 4)).toBeNull();
  });
});

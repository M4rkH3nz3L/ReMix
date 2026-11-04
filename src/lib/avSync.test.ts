import { PERSIST_SAMPLES, VIDEO_SYNC_TOLERANCE_SEC, clipsForPlayback, DRIFT_THRESHOLD_SEC, learnStartLatency, MIN_SEEK_GAP_MS, planDriftCorrection, PREROLL_SEC, shouldResync, sourceTimeOf, SYNC_TOLERANCE_SEC, type DriftState } from '@/lib/avSync';

/**
 * 🧱 CORE §2.6 — az A/V-szinkron MATEK headless tesztje (RN-render nélkül): a
 * forrás-idő (egységes seek-pont) és a drift-korrekciós küszöb.
 */

describe('sourceTimeOf — forrás-idő a klipen', () => {
  it('trimIn + (playhead - start)', () => {
    expect(sourceTimeOf({ start: 5, trimIn: 2 }, 8)).toBeCloseTo(5); // 2 + (8-5)
    expect(sourceTimeOf({ start: 0, trimIn: 0 }, 3)).toBeCloseTo(3);
    expect(sourceTimeOf({ start: 10 }, 12)).toBeCloseTo(2); // trimIn hiányzik = 0
  });
  it('a klip ELŐTTI playhead nem ad negatív forrás-időt (0-ra vágva)', () => {
    expect(sourceTimeOf({ start: 5, trimIn: 1 }, 2)).toBe(0);
  });
});

describe('shouldResync — drift-korrekció küszöbe', () => {
  it('a küszöb ALATT nincs resync', () => {
    expect(shouldResync(10, 10.1)).toBe(false); // 0.1 < 0.25
    expect(shouldResync(10, 10)).toBe(false);
  });
  it('a küszöb FÖLÖTT resync kell (mindkét irányban)', () => {
    expect(shouldResync(10, 10.4)).toBe(true); // +0.4
    expect(shouldResync(10, 9.5)).toBe(true); // -0.5
  });
  it('egyedi küszöb', () => {
    expect(shouldResync(10, 10.05, 0.01)).toBe(true);
    expect(shouldResync(10, 10.05, 0.1)).toBe(false);
  });
  it('az alap-küszöb ~¼ mp', () => {
    expect(DRIFT_THRESHOLD_SEC).toBeCloseTo(0.25);
  });
});

describe('planDriftCorrection — tanuló szinkron (PRO-AUDIO 17/5)', () => {
  const fresh: DriftState = { comp: 0, lastSeekMs: -Infinity, seeks: 0, over: PERSIST_SAMPLES - 1 };

  it('a tűrésen belül nem nyúl a lejátszóhoz', () => {
    expect(planDriftCorrection(fresh, 10, 10 - SYNC_TOLERANCE_SEC / 2, 0).seekTo).toBeNull();
  });

  it('a 0,2 mp-es állandó késést (amit a régi 0,25-ös küszöb sosem javított) javítja', () => {
    expect(planDriftCorrection(fresh, 10, 9.8, 0).seekTo).toBeCloseTo(10, 5);
  });

  it('a seek utáni maradék felét megtanulja, és a következő igazításnál előrébb céloz', () => {
    const first = planDriftCorrection(fresh, 10, 9.8, 0);
    const second = planDriftCorrection({ ...first.next, over: PERSIST_SAMPLES - 1 }, 11, 10.92, MIN_SEEK_GAP_MS + 1);
    expect(second.seekTo).toBeCloseTo(11.04, 5);
    expect(second.next.comp).toBeCloseTo(0.04, 5);
  });

  it('két igazítás között kivár (nincs ugrálás)', () => {
    const first = planDriftCorrection(fresh, 10, 9.8, 1000);
    expect(planDriftCorrection(first.next, 10.1, 9.9, 1000 + MIN_SEEK_GAP_MS - 1).seekTo).toBeNull();
  });

  it('a tanult eltolás korlátos', () => {
    let st = fresh;
    for (let i = 0; i < 20; i++) {
      st = planDriftCorrection({ ...st, over: PERSIST_SAMPLES - 1 }, 10, 8, i * 10000).next;
    }
    expect(Math.abs(st.comp)).toBeLessThanOrEqual(0.5);
  });

  it('negatív célt nem ad', () => {
    expect(planDriftCorrection({ comp: -0.3, lastSeekMs: -Infinity, seeks: 1, over: PERSIST_SAMPLES - 1 }, 0.1, 0.5, 0).seekTo).toBeGreaterThanOrEqual(0);
  });
});

describe('clipsForPlayback — preroll', () => {
  const clips = [{ id: 'a', start: 0, duration: 2 }, { id: 'b', start: 3, duration: 2 }, { id: 'c', start: 10, duration: 1 }];
  it('a hamarosan kezdődő klip lejátszója előre elkészül', () => {
    expect(clipsForPlayback(clips, 1.6).map((c) => c.id)).toEqual(['a', 'b']);
    expect(clipsForPlayback(clips, 3 - PREROLL_SEC - 0.01).map((c) => c.id)).toEqual(['a']);
  });
  it('a véget ért klip lejátszója megszűnik', () => {
    expect(clipsForPlayback(clips, 2.5).map((c) => c.id)).toEqual(['b']);
  });
});

describe('learnStartLatency', () => {
  it('az első mérést átveszi, utána csúszó átlag, 0–0,5 mp közt', () => {
    expect(learnStartLatency(0, 0.18)).toBeCloseTo(0.18, 5);
    expect(learnStartLatency(0.18, 0.22)).toBeCloseTo(0.2, 5);
    expect(learnStartLatency(0.2, 2)).toBe(0.5);
    expect(learnStartLatency(0.1, -1)).toBe(0);
  });
});

describe('planDriftCorrection — kép-tűrés', () => {
  it('a kép 60 ms-os eltérésére nem seekel (a seek leállást okozna), 100 ms-ra igen', () => {
    const fresh = { comp: 0, lastSeekMs: -Infinity, seeks: 0, over: PERSIST_SAMPLES - 1 };
    expect(planDriftCorrection(fresh, 10, 9.95, 0, VIDEO_SYNC_TOLERANCE_SEC).seekTo).toBeNull();
    expect(planDriftCorrection(fresh, 10, 9.9, 0, VIDEO_SYNC_TOLERANCE_SEC).seekTo).not.toBeNull();
  });
});

describe('planDriftCorrection — szűrés', () => {
  it('egyetlen kilengő mérés nem indít seeket, a tartós eltérés igen', () => {
    let st: DriftState = { comp: 0, lastSeekMs: -Infinity, seeks: 2, over: 0 };
    const r1 = planDriftCorrection(st, 10, 9.9, 0);
    expect(r1.seekTo).toBeNull();
    // visszatér a tűrésen belülre: a számláló nullázódik
    st = planDriftCorrection(r1.next, 10, 9.99, 16).next;
    expect(st.over).toBe(0);
    for (let k = 0; k < PERSIST_SAMPLES - 1; k++) {
      const r = planDriftCorrection(st, 10, 9.9, 32 + k * 16);
      expect(r.seekTo).toBeNull();
      st = r.next;
    }
    expect(planDriftCorrection(st, 10, 9.9, 200).seekTo).not.toBeNull();
  });
});


import { detectSystemPause, INITIAL_STALL, recordingPhase, SYSTEM_PAUSE_MS, type PlayerSample, type StallState } from './interruption';

describe('recordingPhase', () => {
  it('felvétel közben recording', () => {
    expect(recordingPhase({ canRecord: true, isRecording: true, durationMillis: 1200 })).toBe('recording');
  });
  it('a rendszer szüneteltette (van felvett rész) → interrupted', () => {
    expect(recordingPhase({ canRecord: true, isRecording: false, durationMillis: 1200 })).toBe('interrupted');
  });
  it('előkészítve, de nem indult / leállítva → idle', () => {
    expect(recordingPhase({ canRecord: true, isRecording: false, durationMillis: 0 })).toBe('idle');
    expect(recordingPhase({ canRecord: false, isRecording: false, durationMillis: 0 })).toBe('idle');
  });
});

describe('detectSystemPause', () => {
  const sample = (over: Partial<PlayerSample>): PlayerSample => ({ playing: false, buffering: false, time: 5, nowMs: 0, nearEnd: false, ...over });
  const run = (samples: PlayerSample[], st: StallState = INITIAL_STALL) => {
    let stopped = false;
    for (const s of samples) {
      const r = detectSystemPause(st, s);
      st = r.next;
      stopped = r.stopped;
    }
    return { st, stopped };
  };

  it('betöltés közbeni állás (még nem szólt) nem szünet', () => {
    expect(run([sample({ nowMs: 0 }), sample({ nowMs: 2000 })]).stopped).toBe(false);
  });

  it('szólt, majd az ideje áll → a küszöb után rendszer-szünet', () => {
    const playing = sample({ playing: true, nowMs: 0 });
    expect(run([playing, sample({ nowMs: 100 }), sample({ nowMs: 100 + SYSTEM_PAUSE_MS - 1 })]).stopped).toBe(false);
    expect(run([playing, sample({ nowMs: 100 }), sample({ nowMs: 100 + SYSTEM_PAUSE_MS })]).stopped).toBe(true);
  });

  it('seek utáni rövid várakozás (az idő ugrik) nem szünet', () => {
    const r = run([
      sample({ playing: true, time: 4, nowMs: 0 }),
      sample({ time: 6, nowMs: 100 }),
      sample({ time: 6, nowMs: 400 }),
      sample({ playing: true, time: 6.05, nowMs: 450 }),
      sample({ time: 6.05, nowMs: 2000 }),
    ]);
    expect(r.stopped).toBe(false);
  });

  it('pufferelés és a forrás vége nem szünet', () => {
    const playing = sample({ playing: true, nowMs: 0 });
    expect(run([playing, sample({ buffering: true, nowMs: 100 }), sample({ buffering: true, nowMs: 3000 })]).stopped).toBe(false);
    expect(run([playing, sample({ nearEnd: true, nowMs: 100 }), sample({ nearEnd: true, nowMs: 3000 })]).stopped).toBe(false);
  });

  it('újra szól → a számláló nullázódik', () => {
    const r = run([sample({ playing: true, nowMs: 0 }), sample({ nowMs: 100 }), sample({ playing: true, time: 5.4, nowMs: 600 }), sample({ time: 5.4, nowMs: 900 })]);
    expect(r.stopped).toBe(false);
    expect(r.st.frozenSince).toBe(900);
  });
});

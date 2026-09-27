import {
  addMarker,
  defaultCapturePlan,
  enabledSources,
  setReplayBuffer,
  setSourceTrack,
  toggleSource,
  validateCapturePlan,
} from '@/lib/captureCenter';

describe('captureCenter — alap-terv', () => {
  it('képernyő + mikrofon felvéve, 30 mp replay-buffer', () => {
    const plan = defaultCapturePlan();
    expect(enabledSources(plan).map((s) => s.kind).sort()).toEqual(['mic', 'screen']);
    expect(plan.replayBufferSec).toBe(30);
    expect(validateCapturePlan(plan).ok).toBe(true);
  });
});

describe('captureCenter — reducerek', () => {
  it('toggleSource kapcsol', () => {
    let plan = defaultCapturePlan();
    plan = toggleSource(plan, 'webcam');
    expect(enabledSources(plan).some((s) => s.kind === 'webcam')).toBe(true);
  });

  it('setReplayBuffer nem enged negatívat, kerekít', () => {
    let plan = defaultCapturePlan();
    plan = setReplayBuffer(plan, -5);
    expect(plan.replayBufferSec).toBe(0);
    plan = setReplayBuffer(plan, 44.6);
    expect(plan.replayBufferSec).toBe(45);
  });

  it('addMarker idő szerint rendezve tartja', () => {
    let plan = defaultCapturePlan();
    plan = addMarker(plan, 12, 'clutch');
    plan = addMarker(plan, 3);
    expect(plan.markers.map((m) => m.time)).toEqual([3, 12]);
    expect(plan.markers[1].label).toBe('clutch');
  });
});

describe('captureCenter — validáció', () => {
  it('nincs engedélyezett forrás → no_source', () => {
    let plan = defaultCapturePlan();
    plan = toggleSource(plan, 'screen');
    plan = toggleSource(plan, 'mic');
    const res = validateCapturePlan(plan);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'no_source')).toBe(true);
  });

  it('csak audio-forrás → no_video', () => {
    let plan = defaultCapturePlan();
    plan = toggleSource(plan, 'screen'); // marad csak a mic
    const res = validateCapturePlan(plan);
    expect(res.errors.some((e) => e.code === 'no_video')).toBe(true);
  });

  it('ütköző sáv-címke az engedélyezett forrásokon → duplicate_track', () => {
    let plan = defaultCapturePlan();
    plan = toggleSource(plan, 'game'); // most screen + game + mic
    plan = setSourceTrack(plan, 'game', 'screen'); // ütközik a screen sávval
    const res = validateCapturePlan(plan);
    expect(res.errors.some((e) => e.code === 'duplicate_track')).toBe(true);
  });
});

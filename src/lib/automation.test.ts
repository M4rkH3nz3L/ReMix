import {
  addPoint,
  clearLane,
  createLane,
  findLane,
  isAutomated,
  removePoint,
  valueAt,
} from '@/lib/automation';

describe('automation — lane létrehozás', () => {
  it('mute → step mód, más → linear', () => {
    expect(createLane('ch1', 'mute').mode).toBe('step');
    expect(createLane('ch1', 'volume').mode).toBe('linear');
  });
  it('send/plugin param-mal', () => {
    const l = createLane('ch1', 'send', 'bus-fx');
    expect(l.param).toBe('bus-fx');
  });
});

describe('automation — pont-kezelés', () => {
  it('addPoint rendezve tart + azonos időt felülír', () => {
    let l = createLane('ch1', 'volume');
    l = addPoint(l, { time: 5, value: -6 });
    l = addPoint(l, { time: 0, value: 0 });
    l = addPoint(l, { time: 5, value: -3 }); // felülír
    expect(l.points).toEqual([
      { time: 0, value: 0 },
      { time: 5, value: -3 },
    ]);
    expect(isAutomated(l)).toBe(true);
  });
  it('removePoint + clearLane', () => {
    let l = addPoint(createLane('ch1', 'volume'), { time: 0, value: 0 });
    l = removePoint(l, 0);
    expect(l.points).toHaveLength(0);
    expect(isAutomated(l)).toBe(false);
    expect(clearLane(l)).toBe(l); // már üres → ugyanaz a ref
  });
});

describe('automation — valueAt', () => {
  it('üres lane → undefined', () => {
    expect(valueAt(createLane('ch1', 'volume'), 3)).toBeUndefined();
  });

  it('linear interpoláció a pontok közt + szél-kitartás', () => {
    let l = createLane('ch1', 'volume');
    l = addPoint(l, { time: 0, value: 0 });
    l = addPoint(l, { time: 10, value: -12 });
    expect(valueAt(l, -5)).toBe(0); // szél
    expect(valueAt(l, 5)).toBe(-6); // félúton
    expect(valueAt(l, 15)).toBe(-12); // szél
  });

  it('step mód (mute) az előző pontot tartja', () => {
    let l = createLane('ch1', 'mute');
    l = addPoint(l, { time: 0, value: 0 });
    l = addPoint(l, { time: 5, value: 1 });
    expect(valueAt(l, 3)).toBe(0); // step: még az előző
    expect(valueAt(l, 5)).toBe(1);
  });
});

describe('automation — findLane', () => {
  it('csatorna + cél + param szerint keres', () => {
    const lanes = [createLane('ch1', 'volume'), createLane('ch1', 'send', 'bus-fx'), createLane('ch2', 'pan')];
    expect(findLane(lanes, 'ch1', 'send', 'bus-fx')?.channelId).toBe('ch1');
    expect(findLane(lanes, 'ch2', 'pan')?.target).toBe('pan');
    expect(findLane(lanes, 'ch1', 'filter')).toBeUndefined();
  });
});

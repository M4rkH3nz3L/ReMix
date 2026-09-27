import {
  MASTER_ID,
  addBus,
  addChannel,
  createMixer,
  dbToGain,
  effectiveMutes,
  gainToDb,
  isAudible,
  mixerFromProject,
  orderBuses,
  removeBus,
  removeChannel,
  resolveOutputChain,
  setSend,
  setSidechain,
  signalPath,
  toRenderPlan,
  updateBus,
  updateChannel,
  validateMixer,
  type MixerGraph,
} from '@/lib/mixer';
import type { Project } from '@/types/project';

/** determinisztikus id-generátor */
const mkIder = () => {
  let n = 0;
  return () => `n${++n}`;
};

describe('mixer — dB ↔ lineáris', () => {
  it('gainToDb: 1→0, 0.5→~-6, 0→padló(-60)', () => {
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0.5)).toBeCloseTo(-6, 0);
    expect(gainToDb(0)).toBe(-60);
  });
  it('dbToGain: 0→1, -6→~0.5', () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-6)).toBeCloseTo(0.5, 1);
  });
});

describe('mixer — reducerek', () => {
  it('addChannel a masterre routol alapból', () => {
    const id = mkIder();
    const m = addChannel(createMixer(), { name: 'Vokál', source: 'voiceover' }, id);
    expect(m.channels).toHaveLength(1);
    expect(m.channels[0]).toMatchObject({ name: 'Vokál', source: 'voiceover', output: MASTER_ID, gainDb: 0, pan: 0 });
  });

  it('updateChannel patch-el; ismeretlen id → ugyanaz a ref', () => {
    const id = mkIder();
    let m = addChannel(createMixer(), { name: 'A' }, id);
    const cid = m.channels[0].id;
    m = updateChannel(m, cid, { gainDb: -3, pan: -0.5 });
    expect(m.channels[0]).toMatchObject({ gainDb: -3, pan: -0.5 });
    expect(updateChannel(m, 'nope', { gainDb: 1 })).toBe(m);
  });

  it('immutábilis — az eredeti mixer nem változik', () => {
    const base = createMixer();
    addChannel(base, { name: 'A' }, mkIder());
    expect(base.channels).toHaveLength(0);
  });
});

describe('mixer — busz + routing', () => {
  const build = (): { m: MixerGraph; ch: string; bus: string } => {
    const id = mkIder();
    let m = addBus(createMixer(), { name: 'Vocal Bus', kind: 'vocal' }, id);
    const bus = m.buses[0].id;
    m = addChannel(m, { name: 'Lead', source: 'voiceover', output: bus }, id);
    const ch = m.channels[0].id;
    return { m, ch, bus };
  };

  it('signalPath a csatornától a masterig megy a buszon át', () => {
    const { m, ch, bus } = build();
    expect(signalPath(m, ch)).toEqual([ch, bus, MASTER_ID]);
  });

  it('removeBus a rá routolt csatornát a masterre irányítja + a sendeket takarítja', () => {
    let { m, ch, bus } = build();
    m = setSend(m, ch, { toBusId: bus, gainDb: -6 });
    m = removeBus(m, bus);
    expect(m.buses).toHaveLength(0);
    expect(m.channels[0].output).toBe(MASTER_ID);
    expect(m.channels[0].sends).toHaveLength(0);
  });

  it('setChannelOutput + resolveOutputChain többlépcsős buszon', () => {
    const id = mkIder();
    let m = addBus(createMixer(), { name: 'FX', kind: 'fx' }, id);
    const fx = m.buses[0].id;
    m = addBus(m, { name: 'Group', kind: 'group', output: fx }, id);
    const group = m.buses[1].id;
    m = addChannel(m, { name: 'A', output: group }, id);
    const ch = m.channels[0].id;
    const chain = resolveOutputChain(m, ch);
    expect(chain.terminatesAtMaster).toBe(true);
    expect(chain.path).toEqual([group, fx, MASTER_ID]);
  });
});

describe('mixer — validáció', () => {
  it('tiszta gráf → ok', () => {
    const { m } = (() => {
      const id = mkIder();
      let mm = addBus(createMixer(), { name: 'B', kind: 'music' }, id);
      mm = addChannel(mm, { name: 'C', output: mm.buses[0].id }, id);
      return { m: mm };
    })();
    expect(validateMixer(m).ok).toBe(true);
  });

  it('dangling output: nem létező buszra routolt csatorna', () => {
    const id = mkIder();
    const m = addChannel(createMixer(), { name: 'C', output: 'nincs-ilyen-busz' }, id);
    const res = validateMixer(m);
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatchObject({ code: 'dangling_output', detail: 'nincs-ilyen-busz' });
  });

  it('routing-ciklus: két busz egymásba fut', () => {
    const id = mkIder();
    let m = addBus(createMixer(), { name: 'A', kind: 'group' }, id);
    m = addBus(m, { name: 'B', kind: 'group' }, id);
    const [a, b] = m.buses.map((x) => x.id);
    m = updateBus(m, a, { output: b });
    m = updateBus(m, b, { output: a });
    const res = validateMixer(m);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === 'routing_cycle')).toBe(true);
  });

  it('send hiányzó buszra + sidechain hiányzó kulcsra', () => {
    const id = mkIder();
    let m = addChannel(createMixer(), { name: 'A' }, id);
    const a = m.channels[0].id;
    m = setSend(m, a, { toBusId: 'nincs', gainDb: -6 });
    m = setSidechain(m, a, { keyChannelId: 'nincs-kulcs', thresholdDb: -20, ratio: 4, attackMs: 5, releaseMs: 200 });
    const codes = validateMixer(m).errors.map((e) => e.code);
    expect(codes).toContain('send_missing_bus');
    expect(codes).toContain('sidechain_missing_key');
  });
});

describe('mixer — sidechain', () => {
  it('setSidechain beállít; removeChannel a kulcs-hivatkozást takarítja', () => {
    const id = mkIder();
    let m = addChannel(createMixer(), { name: 'Music', source: 'music' }, id);
    m = addChannel(m, { name: 'Voice', source: 'voiceover' }, id);
    const [music, voice] = m.channels.map((c) => c.id);
    m = setSidechain(m, music, { keyChannelId: voice, thresholdDb: -24, ratio: 8, attackMs: 5, releaseMs: 250 });
    expect(m.channels[0].sidechain?.keyChannelId).toBe(voice);
    m = removeChannel(m, voice);
    expect(m.channels[0].sidechain).toBeUndefined();
  });
});

describe('mixer — solo / mute feloldás', () => {
  it('ha van solo, a nem-solo csatornák effektíve némák', () => {
    const id = mkIder();
    let m = addChannel(createMixer(), { name: 'A' }, id);
    m = addChannel(m, { name: 'B' }, id);
    m = addChannel(m, { name: 'C' }, id);
    const [a, b] = m.channels.map((c) => c.id);
    m = updateChannel(m, a, { solo: true });
    const muted = effectiveMutes(m);
    expect(muted.has(a)).toBe(false);
    expect(muted.has(b)).toBe(true);
    expect(isAudible(m, a)).toBe(true);
    expect(isAudible(m, b)).toBe(false);
  });

  it('solo nélkül csak az explicit mute néma', () => {
    const id = mkIder();
    let m = addChannel(createMixer(), { name: 'A' }, id);
    const a = m.channels[0].id;
    expect(effectiveMutes(m).size).toBe(0);
    m = updateChannel(m, a, { mute: true });
    expect(effectiveMutes(m).has(a)).toBe(true);
  });
});

describe('mixer — render-terv', () => {
  it('orderBuses a jelfolyam szerint rendez (upstream elöl)', () => {
    const id = mkIder();
    let m = addBus(createMixer(), { name: 'Master-közeli', kind: 'group' }, id);
    const near = m.buses[0].id;
    m = addBus(m, { name: 'Upstream', kind: 'drum', output: near }, id);
    const up = m.buses[1].id;
    const ordered = orderBuses(m.buses).map((b) => b.id);
    expect(ordered.indexOf(up)).toBeLessThan(ordered.indexOf(near));
  });

  it('toRenderPlan a csatornákat effektív némítással annotálja', () => {
    const id = mkIder();
    let m = addChannel(createMixer(), { name: 'A' }, id);
    m = addChannel(m, { name: 'B' }, id);
    const [a, b] = m.channels.map((c) => c.id);
    m = updateChannel(m, a, { solo: true });
    const plan = toRenderPlan(m);
    expect(plan.channels.find((c) => c.id === a)!.muted).toBe(false);
    expect(plan.channels.find((c) => c.id === b)!.muted).toBe(true);
    expect(plan.master.stereoWidth).toBe(1);
  });
});

describe('mixer — projekt-bridge', () => {
  const mkProject = (): Project =>
    ({
      id: 'p',
      name: 't',
      aspectRatio: '9:16',
      tracks: [
        { id: 't1', type: 'music', name: 'zene', clips: [{ id: 'c1', kind: 'audio', start: 0, duration: 5 }] },
        { id: 't2', type: 'voiceover', name: 'vo', clips: [{ id: 'c2', kind: 'audio', start: 0, duration: 5 }] },
        { id: 't3', type: 'sfx', name: 'sfx', clips: [] }, // üres → nincs csatorna
      ],
      trackMix: { music: { gain: 0.5 } },
      assets: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      schemaVersion: 6,
    }) as unknown as Project;

  it('a nem-üres audio-sávokból csatornát épít, a trackMix gaint dB-re váltva', () => {
    const m = mixerFromProject(mkProject(), mkIder());
    expect(m.channels.map((c) => c.source)).toEqual(['music', 'voiceover']);
    expect(m.channels[0].gainDb).toBeCloseTo(-6, 0); // 0.5 lineáris ≈ -6 dB
    expect(m.channels[1].gainDb).toBe(0); // nincs trackMix → 1.0 → 0 dB
  });
});

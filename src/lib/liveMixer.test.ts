import {
  DUCK_DB,
  MAX_DB,
  MIN_DB,
  channelGains,
  createLiveMixer,
  effectiveLinear,
  isAudible,
  setChannelGainDb,
  setMasterGainDb,
  toggleAutoDuck,
  toggleMute,
  toggleSolo,
} from '@/lib/liveMixer';
import { dbToGain } from '@/lib/mixer';

describe('liveMixer — createLiveMixer', () => {
  it('mic/music/media/system csatornák + master 0 + auto-duck be', () => {
    const m = createLiveMixer();
    expect(m.channels.map((c) => c.id)).toEqual(['mic', 'music', 'media', 'system']);
    expect(m.channels.every((c) => !c.mute && !c.solo)).toBe(true);
    expect(m.masterGainDb).toBe(0);
    expect(m.autoDuck).toBe(true);
  });
});

describe('liveMixer — gain/mute/solo', () => {
  it('setChannelGainDb klampol MIN/MAX-ra', () => {
    let m = createLiveMixer();
    m = setChannelGainDb(m, 'mic', 999);
    expect(m.channels.find((c) => c.id === 'mic')!.gainDb).toBe(MAX_DB);
    m = setChannelGainDb(m, 'mic', -999);
    expect(m.channels.find((c) => c.id === 'mic')!.gainDb).toBe(MIN_DB);
  });

  it('mute → a csatorna néma (effectiveLinear 0)', () => {
    let m = createLiveMixer();
    m = toggleMute(m, 'mic');
    expect(isAudible(m, 'mic')).toBe(false);
    expect(effectiveLinear(m, 'mic')).toBe(0);
  });

  it('solo → csak a soloban lévő szól, a többi néma', () => {
    let m = createLiveMixer();
    m = toggleSolo(m, 'music');
    expect(isAudible(m, 'music')).toBe(true);
    expect(isAudible(m, 'mic')).toBe(false);
    expect(effectiveLinear(m, 'mic')).toBe(0);
    expect(effectiveLinear(m, 'music')).toBeGreaterThan(0);
  });
});

describe('liveMixer — effectiveLinear + master + auto-duck', () => {
  it('0 dB → 1.0 lineáris; master is beleszámít', () => {
    let m = createLiveMixer();
    m = setChannelGainDb(m, 'mic', 0);
    expect(effectiveLinear(m, 'mic')).toBeCloseTo(1, 5);
    m = setMasterGainDb(m, -6);
    expect(effectiveLinear(m, 'mic')).toBeCloseTo(dbToGain(-6), 5);
  });

  it('auto-duck: a zene halkul, ha a mikrofon aktív (és az auto-duck be van)', () => {
    const m = createLiveMixer(); // music -6 dB, autoDuck true
    const normal = effectiveLinear(m, 'music', { micActive: false });
    const ducked = effectiveLinear(m, 'music', { micActive: true });
    expect(ducked).toBeLessThan(normal);
    expect(ducked).toBeCloseTo(dbToGain(-6 + DUCK_DB), 5);
  });

  it('auto-duck KI → nincs duckolás', () => {
    const m = toggleAutoDuck(createLiveMixer());
    expect(effectiveLinear(m, 'music', { micActive: true })).toBeCloseTo(
      effectiveLinear(m, 'music', { micActive: false }),
      5,
    );
  });

  it('a mikrofont az auto-duck nem érinti', () => {
    const m = createLiveMixer();
    expect(effectiveLinear(m, 'mic', { micActive: true })).toBeCloseTo(
      effectiveLinear(m, 'mic', { micActive: false }),
      5,
    );
  });
});

describe('liveMixer — channelGains', () => {
  it('minden csatorna lineáris gainjét egyszerre adja', () => {
    const m = createLiveMixer();
    const g = channelGains(m, { micActive: false });
    expect(Object.keys(g).sort()).toEqual(['media', 'mic', 'music', 'system']);
    expect(g.mic).toBeCloseTo(1, 5);
    expect(g.music).toBeCloseTo(dbToGain(-6), 5);
  });
});

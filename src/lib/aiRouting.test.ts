import {
  routeAiTask,
  deviceCanRun,
  usesServer,
  type DeviceCaps,
  type RouteInput,
} from '@/lib/aiRouting';

const dev = (...m: Parameters<typeof deviceCanRun>[1][]): DeviceCaps => ({ modalities: m });

describe('deviceCanRun / usesServer', () => {
  it('a modalitás jelenléte dönt', () => {
    expect(deviceCanRun(dev('transcribe', 'embed'), 'transcribe')).toBe(true);
    expect(deviceCanRun(dev('transcribe'), 'vision')).toBe(false);
    expect(deviceCanRun(undefined, 'text')).toBe(false);
  });
  it('usesServer: minden nem-device cél szerver-utat igényel', () => {
    expect(usesServer('device')).toBe(false);
    expect(usesServer('server')).toBe(true);
    expect(usesServer('hybrid')).toBe(true);
  });
});

describe('routeAiTask — offline', () => {
  it('offline + van lokál modell → device', () => {
    expect(
      routeAiTask({ modality: 'transcribe', network: 'offline', device: dev('transcribe') }),
    ).toEqual({ target: 'device', reason: 'offline_device' });
  });
  it('offline + nincs lokál modell → server (sorban áll, nem crash)', () => {
    expect(routeAiTask({ modality: 'text', network: 'offline', device: dev('transcribe') })).toEqual({
      target: 'server',
      reason: 'offline_queued',
    });
  });
});

describe('routeAiTask — online, nincs eszköz-modell → mindig server', () => {
  it('a méret/tier nem számít, ha nincs lokál modell', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(routeAiTask({ modality: 'text', size, tier: 'pro', device: dev('embed') }).target).toBe('server');
    }
  });
});

describe('routeAiTask — online, van eszköz-modell: méret × tier', () => {
  const base = (over: Partial<RouteInput>): RouteInput => ({
    modality: 'transcribe',
    network: 'online',
    device: dev('transcribe'),
    ...over,
  });

  it('small → mindig device (olcsó/gyors)', () => {
    expect(routeAiTask(base({ size: 'small', tier: 'free' })).target).toBe('device');
    expect(routeAiTask(base({ size: 'small', tier: 'business' })).target).toBe('device');
  });

  it('large → fizetős server (minőség), ingyenes hybrid (token-spórolás)', () => {
    expect(routeAiTask(base({ size: 'large', tier: 'pro' }))).toEqual({
      target: 'server',
      reason: 'large_server_quality',
    });
    expect(routeAiTask(base({ size: 'large', tier: 'free' }))).toEqual({
      target: 'hybrid',
      reason: 'large_free_hybrid',
    });
  });

  it('medium → fizetős hybrid, ingyenes device (kvóta-spórolás)', () => {
    expect(routeAiTask(base({ size: 'medium', tier: 'ultra' })).target).toBe('hybrid');
    expect(routeAiTask(base({ size: 'medium', tier: 'free' })).target).toBe('device');
    expect(routeAiTask(base({ size: 'medium', tier: 'basic' })).target).toBe('device'); // basic = nem fizetős itt
  });
});

describe('routeAiTask — determinizmus + alapértékek', () => {
  it('azonos input → azonos cél', () => {
    const inp: RouteInput = { modality: 'vision', size: 'large', tier: 'pro', device: dev('vision') };
    expect(routeAiTask(inp)).toEqual(routeAiTask(inp));
  });
  it('alap: medium/online/free', () => {
    // nincs size/network/tier → medium + online + free + van modell → device
    expect(routeAiTask({ modality: 'embed', device: dev('embed') }).target).toBe('device');
    // nincs device → server
    expect(routeAiTask({ modality: 'embed' }).target).toBe('server');
  });
});

describe('transcriptionRoute (06.1 + BP-9)', () => {
  const { transcriptionRoute, sizeForDuration } = jest.requireActual('@/lib/aiRouting');

  it('nincs eszköz-modell → worker-első; offline + modell → eszköz-első', () => {
    expect(transcriptionRoute({ durationSec: 30, deviceModel: false })).toBe('server-first');
    expect(transcriptionRoute({ durationSec: 3600, deviceModel: true, network: 'offline', tier: 'pro' })).toBe('device-first');
  });

  it('ingyenes user: rövid és hosszú anyagnál is eszköz-első (kvóta-spórolás)', () => {
    expect(transcriptionRoute({ durationSec: 30, deviceModel: true, tier: 'free' })).toBe('device-first');
    expect(transcriptionRoute({ durationSec: 1800, deviceModel: true, tier: 'free' })).toBe('device-first');
  });

  it('fizetős user + hosszú anyag → worker-első (minőség); rövid → eszköz', () => {
    expect(transcriptionRoute({ durationSec: 1800, deviceModel: true, tier: 'pro' })).toBe('server-first');
    expect(transcriptionRoute({ durationSec: 30, deviceModel: true, tier: 'pro' })).toBe('device-first');
  });

  it('BP-9: ha a mért sebességgel túl sokáig tartana az eszközön → worker-első', () => {
    // 5 perc anyag, 3× lassabb a valós időnél → 15 perc > 10 perc plafon
    expect(transcriptionRoute({ durationSec: 300, deviceModel: true, tier: 'free', rtf: 3 })).toBe('server-first');
    // gyors eszköz (0,3×) → marad az eszköz
    expect(transcriptionRoute({ durationSec: 300, deviceModel: true, tier: 'free', rtf: 0.3 })).toBe('device-first');
  });

  it('méret-osztályok', () => {
    expect(sizeForDuration(60)).toBe('small');
    expect(sizeForDuration(600)).toBe('medium');
    expect(sizeForDuration(601)).toBe('large');
  });
});

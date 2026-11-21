// 🎥 A server/egress/ modulcsalád regressziós tesztjei (REFACTOR): a liveEgress.js bontása után a
// VOD-, méret-, RTMP-cél- és indítás/leállítás-logika JELENLEGI viselkedését rögzítik.
jest.mock('livekit-server-sdk', () => {
  const rec = (name) =>
    class {
      constructor(args) {
        this.kind = name;
        this.args = args;
      }
    };
  const egress = {
    stopEgress: jest.fn(async () => ({})),
    listEgress: jest.fn(async () => []),
    startRoomCompositeEgress: jest.fn(async () => ({ egressId: 'EG_1' })),
  };
  const room = { createRoom: jest.fn(async () => ({})) };
  return {
    __egress: egress,
    __room: room,
    EgressClient: jest.fn(() => egress),
    RoomServiceClient: jest.fn(() => room),
    StreamOutput: rec('stream'),
    EncodedFileOutput: rec('file'),
    EncodingOptions: rec('enc'),
    S3Upload: rec('s3'),
    StreamProtocol: { RTMP: 1 },
    EncodedFileType: { MP4: 0 },
  };
});
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => global.__egressSb) }));
jest.mock('../security/rtmpUrl', () => ({
  resolveSafe: jest.fn(async (u) => (/^rtmps?:\/\/(?!10\.)/.test(u) ? { ok: true } : { ok: false, error: 'tiltott' })),
}));
jest.mock('../liveCrypto', () => ({
  decryptStreamKey: jest.fn((k) => {
    if (k === 'BAD') throw new Error('rossz kulcs');
    return `dec-${k}`;
  }),
}));
jest.mock('../usage', () => ({ trackUsage: jest.fn(async () => {}) }));

const ENV = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'EGRESS_VOD', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_PUBLIC_BASE', 'S3_ENDPOINT', 'S3_REGION', 'EGRESS_LAYOUT_URL', 'MAX_CONCURRENT_EGRESS'];
const FULL = { LIVEKIT_URL: 'wss://lk.example', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's', SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'srk' };
const VOD = { EGRESS_VOD: '1', S3_ACCESS_KEY: 'ak', S3_SECRET_KEY: 'sk', S3_BUCKET: 'b', S3_PUBLIC_BASE: 'https://cdn.example/' };

/** Táblánkénti válaszú, láncolható + thenable Supabase-mock; a hívásláncokat gyűjti. */
function mockSb(answer) {
  const calls = [];
  return {
    calls,
    from(table) {
      const chain = [['from', table]];
      calls.push(chain);
      const b = {};
      for (const m of ['select', 'eq', 'lt', 'update', 'insert', 'maybeSingle']) {
        b[m] = (...a) => {
          chain.push([m, ...a]);
          return b;
        };
      }
      b.then = (ok) => ok(answer(table, chain));
      return b;
    },
  };
}

/** Friss modul-betöltés az adott env-vel (a kliens-singletonok és az env-konstansok betöltéskor élnek). */
function load(env, answer) {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, env);
  global.__egressSb = mockSb(answer || (() => ({ data: null, error: null })));
  let mods;
  jest.isolateModules(() => {
    mods = {
      vod: require('./vod'),
      control: require('./control'),
      root: require('../liveEgress'),
      sdk: require('livekit-server-sdk'),
    };
  });
  return { ...mods, sb: global.__egressSb };
}

afterEach(() => {
  for (const k of ENV) delete process.env[k];
});

describe('vod — VOD-felvétel', () => {
  test('a kulcs a live-vod/ alatti mp4, a név a szoba + 24 hex karakter', () => {
    const { vod } = load({});
    expect(vod.vodKey('abc')).toBe('live-vod/abc.mp4');
    expect(vod.vodName('room1')).toMatch(/^room1-[0-9a-f]{24}$/);
    expect(vod.vodName('room1')).not.toBe(vod.vodName('room1'));
  });
  test('kikapcsolva (EGRESS_VOD≠1 vagy hiányzó S3) → null URL és null output', () => {
    expect(load({}).vod.vodEnabled()).toBe(false);
    const { vod } = load({ ...VOD, S3_BUCKET: '  ' });
    expect(vod.vodEnabled()).toBe(false);
    expect(vod.vodUrl('x')).toBeNull();
    expect(vod.buildVodOutput('x')).toBeNull();
  });
  test('bekapcsolva: publikus URL a záró perjel nélküli bázissal; bázis nélkül null', () => {
    expect(load(VOD).vod.vodUrl('n')).toBe('https://cdn.example/live-vod/n.mp4');
    expect(load({ ...VOD, S3_PUBLIC_BASE: '' }).vod.vodUrl('n')).toBeNull();
  });
  test('az S3-feltöltés: alap régió us-east-1, endpoint esetén path-style', () => {
    let out = load(VOD).vod.buildVodOutput('n');
    expect(out.args.filepath).toBe('live-vod/n.mp4');
    expect(out.args.fileType).toBe(0);
    expect(out.args.output.value.args).toEqual({ accessKey: 'ak', secret: 'sk', bucket: 'b', region: 'us-east-1', endpoint: undefined, forcePathStyle: false });
    out = load({ ...VOD, S3_ENDPOINT: 'https://r2', S3_REGION: ' auto ' }).vod.buildVodOutput('n');
    expect(out.args.output.value.args).toMatchObject({ region: 'auto', endpoint: 'https://r2', forcePathStyle: true });
  });
});

describe('control — tiszta segédek', () => {
  test('rtmpTarget: a záró perjelek levágva, kulcs nélkül a bázis', () => {
    const { control } = load({});
    expect(control.rtmpTarget('rtmp://h/app//', 'kulcs')).toBe('rtmp://h/app/kulcs');
    expect(control.rtmpTarget('rtmp://h/app/', '')).toBe('rtmp://h/app');
  });
  test('egressDimensions: minden ismert arány, ismeretlen → 16:9', () => {
    const { control } = load({});
    expect(control.egressDimensions('9:16')).toEqual({ width: 720, height: 1280 });
    expect(control.egressDimensions('1:1')).toEqual({ width: 720, height: 720 });
    expect(control.egressDimensions('4:5')).toEqual({ width: 864, height: 1080 });
    expect(control.egressDimensions('4:3')).toEqual({ width: 960, height: 720 });
    expect(control.egressDimensions('16:9')).toEqual({ width: 1280, height: 720 });
    expect(control.egressDimensions(undefined)).toEqual({ width: 1280, height: 720 });
  });
});

describe('startEgress / stopEgress — a bontás után is a liveEgress.js-en át', () => {
  const answer = (dests, count = 0, host = 'u1') => (table, chain) => {
    if (table === 'live_sessions') return { data: { host_id: host, status: 'live' }, error: null };
    if (table === 'live_destinations') return { data: dests, error: null };
    if (chain.some((c) => c[0] === 'lt')) return { data: [], error: null };
    if (chain.some((c) => c[0] === 'select' && c[2])) return { count, error: null };
    return { data: null, error: null };
  };

  test('a liveEgress.js ugyanazokat a függvényeket exportálja, mint a modulcsalád', () => {
    const { root, control } = load({});
    expect(root.startEgress).toBe(control.startEgress);
    expect(Object.keys(root)).toEqual(['startEgress', 'stopEgress', 'egressConfigured', 'sweepStaleEgress', 'reconcileLive', 'egressMinutes', 'countActiveEgress', 'sweepUserStale', 'stopStale', 'intEnv']);
  });
  test('nem a host → 403; nem élő → 400', async () => {
    let m = load(FULL, () => ({ data: { host_id: 'u2', status: 'live' }, error: null }));
    expect(await m.root.startEgress({ room: 'r', userId: 'u1' })).toEqual({ ok: false, status: 403, error: 'Csak a host indíthat egresst a saját szobájára.' });
    m = load(FULL, () => ({ data: { host_id: 'u1', status: 'ended' }, error: null }));
    expect(await m.root.startEgress({ room: 'r', userId: 'u1' })).toEqual({ ok: false, status: 400, error: 'A live session nem aktív.' });
  });
  test('párhuzamos limit → 429', async () => {
    const m = load(FULL, answer([{ id: 'a', rtmp_url: 'rtmp://ok/app', stream_key: 'k' }], 1));
    const r = await m.root.startEgress({ room: 'r', userId: 'u1' });
    expect(r.status).toBe(429);
  });
  test('siker: a belső cél kihagyva, a kulcs visszafejtve, a host a sablon-URL-ben', async () => {
    const m = load({ ...FULL, EGRESS_LAYOUT_URL: 'https://w/l?x=1' }, answer([
      { id: 'a', platform: 'yt', label: 'A', rtmp_url: 'rtmp://ok/app/', stream_key: 'k' },
      { id: 'b', platform: 'tw', label: 'B', rtmp_url: 'rtmp://10.0.0.1/app', stream_key: 'k' },
    ], 0, 'u 1'));
    const r = await m.root.startEgress({ room: 'r', userId: 'u 1', aspect: '9:16' });
    expect(r).toEqual({ ok: true, egressId: 'EG_1', destinations: [{ id: 'a', platform: 'yt', label: 'A' }], skipped: [{ id: 'b', label: 'B', error: 'tiltott' }], vodUrl: null });
    const [room, output, composite] = m.sdk.__egress.startRoomCompositeEgress.mock.calls.at(-1);
    expect(room).toBe('r');
    expect(output.args).toEqual({ protocol: 1, urls: ['rtmp://ok/app/dec-k'] });
    expect(composite.customBaseUrl).toBe('https://w/l?x=1&host=u%201');
    expect(composite.encodingOptions.args).toEqual({ width: 720, height: 1280, framerate: 30 });
  });
  test('csak-felvétel: { file } output és VOD-URL', async () => {
    const m = load({ ...FULL, ...VOD }, answer([]));
    const r = await m.root.startEgress({ room: 'r', userId: 'u1', record: true });
    expect(r.vodUrl).toMatch(/^https:\/\/cdn\.example\/live-vod\/r-[0-9a-f]{24}\.mp4$/);
    expect(Object.keys(m.sdk.__egress.startRoomCompositeEgress.mock.calls.at(-1)[1])).toEqual(['file']);
  });
  test('dekódolási hiba → 500', async () => {
    const m = load(FULL, answer([{ id: 'a', rtmp_url: 'rtmp://ok/app', stream_key: 'BAD' }]));
    expect(await m.root.startEgress({ room: 'r', userId: 'u1' })).toEqual({ ok: false, status: 500, error: 'Stream-kulcs dekódolási hiba: rossz kulcs' });
  });
  test('stop: a LiveKit-hiba ellenére lezárja a sort, és 502-t ad', async () => {
    const m = load(FULL);
    m.sdk.__egress.stopEgress.mockRejectedValueOnce(new Error('412'));
    expect(await m.root.stopEgress('E1')).toEqual({ ok: false, status: 502, error: 'Egress-leállítás hiba: 412' });
    expect(m.sb.calls.at(-1)).toEqual([['from', 'live_egress'], ['update', { status: 'stopped', stopped_at: expect.any(String) }], ['eq', 'egress_id', 'E1'], ['eq', 'status', 'active'], ['select', 'user_id, started_at'], ['maybeSingle']]);
  });
  test('egressConfigured: LiveKit ÉS service_role kell', () => {
    expect(load(FULL).root.egressConfigured()).toBe(true);
    expect(load({ ...FULL, SUPABASE_URL: '' }).root.egressConfigured()).toBe(false);
  });
});

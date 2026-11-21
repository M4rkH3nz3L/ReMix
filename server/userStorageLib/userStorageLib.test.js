// 🔌 A server/userStorageLib/ modulcsalád regressziós tesztjei (REFACTOR): a userStorage.js bontása után az
// OAuth-konfiguráció, a HMAC-aláírás (state + capability-token), az OAuth-folyamat, a DB-lánc és a
// gateway JELENLEGI viselkedését rögzítik (a Supabase-kliens, a hálózat és a storage-connectorok mockolva).
const crypto = require('crypto');

const mockState = { sb: null, fetchQueue: [], calls: [], caught: [] };

jest.mock('../lib/caught', () => ({
  logCaught: (tag, err) => mockState.caught.push([tag, String(err && err.message)]),
}));
jest.mock('../notify', () => ({ adminClient: () => mockState.sb }));
jest.mock('../netFetch', () => {
  const reply = async (kind, url, init, rest) => {
    mockState.calls.push([kind, url, init, rest]);
    const s = mockState.fetchQueue.shift() || { ok: true, status: 200, json: {} };
    return { ok: s.ok, status: s.status, json: async () => s.json };
  };
  return {
    fetchWithTimeout: (url, init, ...rest) => reply('fetchWithTimeout', url, init, rest),
    fetchRetry: (url, init, ...rest) => reply('fetchRetry', url, init, rest),
  };
});
jest.mock('../storage', () => ({
  mediaKind: (name) => (/\.mp4$/i.test(String(name)) ? 'video' : null),
  davListMedia: async (src) => [{ id: 'd', name: 'a.mp4', kind: 'video', url: `/storage/${src.id}/file?path=a.mp4`, path: 'a.mp4' }],
  davStream: async () => {},
  davUpload: async (...a) => mockState.calls.push(['davUpload', ...a]),
  s3ListMedia: async () => [{ id: 's', name: 'b.mp4', kind: 'video', url: '/x?path=b.mp4' }],
  s3Stream: async () => {},
  s3Upload: async (...a) => mockState.calls.push(['s3Upload', ...a]),
}));

/** Supabase lánc-rögzítő: minden from(tábla) lánc a hívásaival; a válasz a `respond`-ból jön. */
function chainSb(respond) {
  const chains = [];
  return {
    chains,
    from(table) {
      const chain = [table];
      chains.push(chain);
      const b = new Proxy(
        {},
        {
          get(_, prop) {
            if (prop === 'then') return (res) => res(respond(chain));
            return (...args) => (chain.push([prop, ...args]), b);
          },
        }
      );
      return b;
    },
  };
}

const ENV_KEYS = ['OAUTH_STATE_SECRET', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'DROPBOX_APP_KEY', 'DROPBOX_APP_SECRET', 'MS_OAUTH_CLIENT_ID', 'MS_OAUTH_CLIENT_SECRET'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

/** a modulcsalád friss betöltése adott env-vel (a STATE_SECRET betöltéskor rögzül) */
function load(env) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let mods;
  jest.isolateModules(() => {
    mods = {
      facade: require('../userStorage'),
      oauthConfig: require('./oauthConfig'),
      signing: require('./signing'),
      sourcesDb: require('./sourcesDb'),
      oauthFlow: require('./oauthFlow'),
      mimeKind: require('./mimeKind'),
      gateway: require('./gateway'),
    };
  });
  return mods;
}
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(s).digest('hex').slice(0, 32);
const b64u = (s) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

beforeEach(() => {
  mockState.sb = null;
  mockState.fetchQueue = [];
  mockState.calls = [];
  mockState.caught = [];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const FULL = { OAUTH_STATE_SECRET: 'sec', GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsec', DROPBOX_APP_KEY: 'dk', DROPBOX_APP_SECRET: 'ds' };

describe('homlokzat', () => {
  test('a module.exports kulcsai és sorrendje változatlan, a függvények a lib-modulokból jönnek', () => {
    const m = load(FULL);
    expect(Object.keys(m.facade)).toEqual([
      'OAUTH', 'oauthConfigured', 'oauthStartUrl', 'oauthCallback', 'fileToken', 'verifyFileToken',
      'describeUserSources', 'listConnected', 'listUserSource', 'streamUserSourceFile', 'findUserSource',
      'upsertProvider', 'disconnectSource', 'uploadToSource', 'getDefaultTarget', 'setDefaultTarget',
    ]);
    expect(m.facade.OAUTH).toBe(m.oauthConfig.OAUTH);
    expect(m.facade.fileToken).toBe(m.signing.fileToken);
    expect(m.facade.findUserSource).toBe(m.sourcesDb.findUserSource);
    expect(m.facade.oauthCallback).toBe(m.oauthFlow.oauthCallback);
    expect(m.facade.setDefaultTarget).toBe(m.gateway.setDefaultTarget);
  });
});

describe('OAuth-konfiguráció', () => {
  test('oauthConfigured: csak id ÉS secret mellett igaz; ismeretlen provider hamis', () => {
    const m = load({ GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: '', DROPBOX_APP_KEY: 'dk', DROPBOX_APP_SECRET: 'ds' });
    expect(m.oauthConfig.oauthConfigured('gdrive')).toBe(false);
    expect(m.oauthConfig.oauthConfigured('dropbox')).toBe(true);
    expect(m.oauthConfig.oauthConfigured('onedrive')).toBe(false);
    expect(m.oauthConfig.oauthConfigured('webdav')).toBe(false);
  });
  test('quirk: Object.prototype-nevekre (toString) TypeError-t dob', () => {
    const m = load(FULL);
    expect(() => m.oauthConfig.oauthConfigured('toString')).toThrow('p.clientId is not a function');
  });
});

describe('aláírás (state + capability-token)', () => {
  test('a secret: OAUTH_STATE_SECRET; dev/teszt-ben hiányában a dev-konstans (a service-role kulcs NEM HMAC-titok)', () => {
    expect(load({ OAUTH_STATE_SECRET: 'a', SUPABASE_SERVICE_ROLE_KEY: 'b' }).signing.STATE_SECRET).toBe('a');
    expect(load({ SUPABASE_SERVICE_ROLE_KEY: 'b' }).signing.STATE_SECRET).toBe('insecure-dev-secret');
    expect(load({}).signing.STATE_SECRET).toBe('insecure-dev-secret');
  });
  test('signState/verifyState: oda-vissza; módosított vagy aláírás nélküli state → null', () => {
    const { signing } = load(FULL);
    const st = signing.signState({ u: 'alice', p: 'gdrive' });
    expect(st).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{32}$/);
    expect(signing.verifyState(st)).toEqual({ u: 'alice', p: 'gdrive' });
    expect(signing.verifyState(st + 'x')).toBeNull();
    expect(signing.verifyState(st.split('.')[0])).toBeNull();
    expect(signing.verifyState(null)).toBeNull();
  });
  test('verifyState: érvényes aláírás, de nem JSON → null + logCaught a régi címkével', () => {
    const { signing } = load(FULL);
    const pl = b64u('{nem json');
    expect(signing.verifyState(`${pl}.${hmac('sec', pl)}`)).toBeNull();
    expect(mockState.caught[0][0]).toBe('userStorage.js:verifyState');
  });
  test('fileToken: b64url(uid).hmac(uid:forrás:út); a verify csak ugyanarra a hármasra adja vissza a uid-t', () => {
    const { signing } = load(FULL);
    const t = signing.fileToken('alice', 'g1', 'a/b.mp4');
    expect(t).toBe(`${b64u('alice')}.${hmac('sec', 'alice:g1:a/b.mp4')}`);
    expect(signing.verifyFileToken(t, 'g1', 'a/b.mp4')).toBe('alice');
    expect(signing.verifyFileToken(t, 'g2', 'a/b.mp4')).toBeNull();
    expect(signing.verifyFileToken(t, 'g1', '../a/b.mp4')).toBeNull();
    expect(signing.verifyFileToken(`${b64u('bob')}.${t.split('.')[1]}`, 'g1', 'a/b.mp4')).toBeNull();
    expect(signing.verifyFileToken('', 'g1', 'x')).toBeNull();
    expect(signing.verifyFileToken('abc', 'g1', 'x')).toBeNull();
  });
  test('quirk: a ":" elválasztó miatt (a:b, c) és (a, b:c) ugyanazt az aláírást kapja', () => {
    const { signing } = load(FULL);
    const t = signing.fileToken('a', 'b:c', 'd');
    expect(signing.verifyFileToken(`${b64u('a:b')}.${t.split('.')[1]}`, 'c', 'd')).toBe('a:b');
  });
});

describe('OAuth-folyamat', () => {
  test('oauthStartUrl: a redirect_uri záró perjelek nélkül, a state aláírva hordja a usert és a returnUrl-t', () => {
    const { oauthFlow, signing } = load(FULL);
    const { url, redirectUri } = oauthFlow.oauthStartUrl('alice', 'gdrive', 'https://api.x///', 'remix://done');
    expect(redirectUri).toBe('https://api.x/storage/oauth/gdrive/callback');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(u.searchParams.get('client_id')).toBe('gid');
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(signing.verifyState(u.searchParams.get('state'))).toEqual({ u: 'alice', r: redirectUri, t: 'remix://done', p: 'gdrive' });
  });
  test('oauthStartUrl: ismeretlen és konfigurálatlan provider beszédes hibát dob', () => {
    const { oauthFlow } = load(FULL);
    expect(() => oauthFlow.oauthStartUrl('a', 'webdav', 'h', null)).toThrow('Ismeretlen OAuth-provider: webdav');
    expect(() => oauthFlow.oauthStartUrl('a', 'onedrive', 'h', null)).toThrow('A OneDrive OAuth nincs konfigurálva a workeren (client id/secret).');
  });
  test('oauthCallback: más providerre szóló state → hiba, token-csere nélkül', async () => {
    const { oauthFlow, signing } = load(FULL);
    const st = signing.signState({ u: 'a', r: 'r', t: null, p: 'gdrive' });
    await expect(oauthFlow.oauthCallback('dropbox', 'C', st)).rejects.toThrow('Érvénytelen OAuth-state.');
    expect(mockState.calls).toEqual([]);
  });
  test('oauthCallback: kód → token (alap lejárat 3600 s) → insert a state userjére; a returnUrl-t adja vissza', async () => {
    const { oauthFlow, signing } = load(FULL);
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    mockState.sb = chainSb(() => ({ data: { id: 'new' }, error: null }));
    mockState.fetchQueue = [{ ok: true, status: 200, json: { access_token: 'A', refresh_token: 'R' } }];
    const st = signing.signState({ u: 'alice', r: 'https://r/cb', t: 'remix://x', p: 'gdrive' });
    await expect(oauthFlow.oauthCallback('gdrive', 'C1', st)).resolves.toBe('remix://x');
    expect(mockState.calls[0][0]).toBe('fetchWithTimeout');
    expect(String(mockState.calls[0][2].body)).toBe('code=C1&grant_type=authorization_code&client_id=gid&client_secret=gsec&redirect_uri=https%3A%2F%2Fr%2Fcb');
    expect(mockState.sb.chains[0]).toEqual([
      'user_storage_providers',
      ['insert', { user_id: 'alice', type: 'gdrive', label: 'Google Drive', config: { access_token: 'A', refresh_token: 'R', expires_at: 1000 + 3600 * 1000 }, status: 'connected' }],
      ['select', 'id'],
      ['single'],
    ]);
    jest.restoreAllMocks();
  });
  test('ensureAccessToken: 60 s-on belül lejáró token frissül, a régi refresh_token megmarad és visszaíródik', async () => {
    const { oauthFlow } = load(FULL);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mockState.sb = chainSb(() => ({ error: null }));
    const fresh = { id: 's', type: 'gdrive', config: { access_token: 'OK', expires_at: 1_060_001 } };
    await expect(oauthFlow.ensureAccessToken(fresh)).resolves.toBe('OK');
    const src = { id: 's', type: 'gdrive', config: { access_token: 'OLD', refresh_token: 'RT', expires_at: 1_060_000 } };
    mockState.fetchQueue = [{ ok: true, status: 200, json: { access_token: 'NEW', expires_in: 10 } }];
    await expect(oauthFlow.ensureAccessToken(src)).resolves.toBe('NEW');
    expect(src.config).toEqual({ access_token: 'NEW', refresh_token: 'RT', expires_at: 1_010_000 });
    expect(mockState.sb.chains[0]).toEqual(['user_storage_providers', ['update', { config: src.config }], ['eq', 'id', 's']]);
    jest.restoreAllMocks();
  });
  test('ensureAccessToken: refresh_token nélkül, vagy access_token nélküli válaszra hibát dob', async () => {
    const { oauthFlow } = load(FULL);
    await expect(oauthFlow.ensureAccessToken({ type: 'gdrive', config: null })).rejects.toThrow('Nincs frissíthető token (újra be kell kötni a forrást).');
    mockState.fetchQueue = [{ ok: true, status: 200, json: {} }];
    await expect(oauthFlow.ensureAccessToken({ type: 'gdrive', config: { refresh_token: 'R' } })).rejects.toThrow('Token-frissítés hiba (200)');
  });
});

describe('DB-lánc és gateway', () => {
  const rows = [
    { id: 'g1', type: 'gdrive', label: 'GD', status: 'connected', is_default: false, config: {} },
    { id: 'w1', type: 'webdav', label: 'DAV', status: 'connected', is_default: true, config: { endpoint: 'e' } },
    { id: 's1', type: 's3', label: 'S3', status: 'connected', is_default: null, config: { prefix: '//pre/' } },
    { id: 'x1', type: 'ftp', label: 'FTP', status: 'connected', is_default: false, config: {} },
  ];
  test('loadUserSources: a user_id és connected szűrővel, létrehozás szerint rendezve olvas', async () => {
    const { facade } = load(FULL);
    mockState.sb = chainSb(() => ({ data: rows, error: null }));
    await expect(facade.listConnected('alice')).resolves.toEqual([
      { id: 'g1', label: 'GD', type: 'gdrive', status: 'connected', isDefault: false },
      { id: 'w1', label: 'DAV', type: 'webdav', status: 'connected', isDefault: true },
      { id: 's1', label: 'S3', type: 's3', status: 'connected', isDefault: false },
      { id: 'x1', label: 'FTP', type: 'ftp', status: 'connected', isDefault: false },
    ]);
    expect(mockState.sb.chains[0]).toEqual([
      'user_storage_providers',
      ['select', 'id, type, label, config, status, is_default'],
      ['eq', 'user_id', 'alice'],
      ['eq', 'status', 'connected'],
      ['order', 'created_at', { ascending: true }],
    ]);
    await expect(facade.getDefaultTarget('alice')).resolves.toBe('w1');
  });
  test('service_role nélkül az olvasók üresek, az írók hibát dobnak; uid nélkül nincs lekérdezés', async () => {
    const { facade } = load(FULL);
    await expect(facade.describeUserSources('alice')).resolves.toEqual([]);
    await expect(facade.disconnectSource('alice', 'g1')).rejects.toThrow('service_role nincs beállítva a workeren.');
    mockState.sb = chainSb(() => ({ data: rows, error: null }));
    await expect(facade.findUserSource('', 'g1')).resolves.toBeNull();
    expect(mockState.sb.chains).toEqual([]);
  });
  test('disconnectSource és setDefaultTarget: mindig a user_id-re is szűr', async () => {
    const { facade } = load(FULL);
    mockState.sb = chainSb(() => ({ error: null }));
    await facade.disconnectSource('alice', 'g1');
    await facade.setDefaultTarget('alice', 'w1');
    expect(mockState.sb.chains).toEqual([
      ['user_storage_providers', ['delete'], ['eq', 'user_id', 'alice'], ['eq', 'id', 'g1']],
      ['user_storage_providers', ['update', { is_default: false }], ['eq', 'user_id', 'alice']],
      ['user_storage_providers', ['update', { is_default: true }], ['eq', 'user_id', 'alice'], ['eq', 'id', 'w1']],
    ]);
  });
  test('listUserSource: idegen forrás → null; minden entry-URL capability-tokent kap (út nélkül az üres útra)', async () => {
    const { facade, signing } = load(FULL);
    mockState.sb = chainSb(() => ({ data: rows, error: null }));
    await expect(facade.listUserSource('alice', 'nope')).resolves.toBeNull();
    const w = await facade.listUserSource('alice', 'w1');
    expect(w[0].url).toBe(`/storage/w1/file?path=a.mp4&it=${encodeURIComponent(signing.fileToken('alice', 'w1', 'a.mp4'))}`);
    const s = await facade.listUserSource('alice', 's1');
    expect(s[0].url).toBe(`/x?path=b.mp4&it=${encodeURIComponent(signing.fileToken('alice', 's1', ''))}`);
    await expect(facade.listUserSource('alice', 'x1')).rejects.toThrow('Ismeretlen forrás-típus: ftp');
  });
  test('uploadToSource: WebDAV ReMix/ alá, S3 a vezető perjelek nélküli prefixszel; a token az útra kötött', async () => {
    const { facade, signing } = load(FULL);
    mockState.sb = chainSb(() => ({ data: rows, error: null }));
    await expect(facade.uploadToSource('alice', 'w1', '/tmp/a', 'k.mp4', 'video/mp4')).resolves.toEqual({
      path: 'ReMix/k.mp4',
      token: signing.fileToken('alice', 'w1', 'ReMix/k.mp4'),
    });
    await expect(facade.uploadToSource('alice', 's1', '/tmp/a', 'k.mp4')).resolves.toEqual({
      path: 'pre/k.mp4',
      token: signing.fileToken('alice', 's1', 'pre/k.mp4'),
    });
    expect(mockState.calls.map((c) => c.slice(0, 3))).toEqual([
      ['davUpload', { endpoint: 'e', id: 'w1' }, 'ReMix/k.mp4'],
      ['s3Upload', { prefix: '//pre/', id: 's1' }, 'pre/k.mp4'],
    ]);
    await expect(facade.uploadToSource('alice', 'nope', '/tmp/a', 'k')).rejects.toThrow('Ismeretlen forrás.');
  });
  test('streamUserSourceFile: ismeretlen forrás → 404, ismeretlen típus → 400 a régi hibaszöveggel', async () => {
    const { facade } = load(FULL);
    mockState.sb = chainSb(() => ({ data: rows, error: null }));
    const out = [];
    const res = { status: (c) => (out.push(c), res), json: (b) => out.push(b) };
    await facade.streamUserSourceFile('alice', 'nope', 'r', res);
    await facade.streamUserSourceFile('alice', 'x1', 'r', res);
    expect(out).toEqual([404, { error: 'Ismeretlen forrás.' }, 400, { error: 'Ismeretlen forrás-típus: ftp' }]);
  });
  test('mimeKind: video/image/audio előtag (kis-nagybetű független), különben null', () => {
    const { mimeKind } = load(FULL).mimeKind;
    expect([mimeKind('VIDEO/mp4'), mimeKind('image/png'), mimeKind('audio/x'), mimeKind('application/pdf'), mimeKind('')]).toEqual(['video', 'image', 'audio', null, null]);
  });
});

/** production-módú betöltés (a secret betöltéskor rögzül), utána a NODE_ENV visszaáll */
function loadProd(env) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return load(env);
  } finally {
    process.env.NODE_ENV = prev;
  }
}

describe('🔒 OAuth-state / fájl-token secret production-ben', () => {
  const forgedFileToken = (secret, uid, src, path) => `${b64u(uid)}.${hmac(secret, `${uid}:${src}:${path}`)}`;
  const forgedState = (secret, obj) => {
    const pl = b64u(JSON.stringify(obj));
    return `${pl}.${hmac(secret, pl)}`;
  };
  test('támadás: prod-ban OAUTH_STATE_SECRET nélkül a beégetett konstanssal hamisított fájl-token / state ELUTASÍTVA', () => {
    const { signing } = loadProd({});
    expect(signing.verifyFileToken(forgedFileToken('insecure-dev-secret', 'victim', 'g1', 'a.mp4'), 'g1', 'a.mp4')).toBeNull();
    expect(signing.verifyState(forgedState('insecure-dev-secret', { u: 'victim', p: 'gdrive' }))).toBeNull();
  });
  test('támadás: prod-ban a service-role kulcs sem HMAC-titok (az azzal aláírt token elutasítva)', () => {
    const { signing } = loadProd({ SUPABASE_SERVICE_ROLE_KEY: 'srk' });
    expect(signing.STATE_SECRET).toBe('');
    expect(signing.verifyFileToken(forgedFileToken('srk', 'victim', 'g1', 'a.mp4'), 'g1', 'a.mp4')).toBeNull();
  });
  test('prod secret nélkül: az aláírás definiált 503-as hibát dob; az OAuth-start is', () => {
    const { signing, oauthFlow } = loadProd(FULL_NO_SECRET);
    expect(() => signing.signState({ u: 'a' })).toThrow('OAUTH_STATE_SECRET');
    expect(() => signing.fileToken('a', 'g1', 'x')).toThrow(expect.objectContaining({ status: 503 }));
    expect(() => oauthFlow.oauthStartUrl('a', 'gdrive', 'https://api.x', null)).toThrow(expect.objectContaining({ status: 503 }));
  });
  test('prod VALÓDI secrettel működik; a régi konstanssal hamisított token ott is elutasítva', () => {
    const { signing } = loadProd({ OAUTH_STATE_SECRET: 'prod-secret' });
    const t = signing.fileToken('alice', 'g1', 'a.mp4');
    expect(signing.verifyFileToken(t, 'g1', 'a.mp4')).toBe('alice');
    expect(signing.verifyFileToken(forgedFileToken('insecure-dev-secret', 'alice', 'g1', 'a.mp4'), 'g1', 'a.mp4')).toBeNull();
    expect(signing.verifyState(signing.signState({ u: 'alice' }))).toEqual({ u: 'alice' });
  });
});
const FULL_NO_SECRET = { GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsec' };

describe('🔒 returnUrl-allowlist (XSS a callback-oldalon)', () => {
  test('támadás: javascript: / idegen host / data: returnUrl NEM kerül a state-be', () => {
    const { oauthFlow, signing } = load(FULL);
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'https://evil.example/x', 'data:text/html,<script>alert(1)</script>', '//evil.example', 'remix\n://x']) {
      const { url } = oauthFlow.oauthStartUrl('alice', 'gdrive', 'https://api.x', bad);
      expect(signing.verifyState(new URL(url).searchParams.get('state')).t).toBeNull();
    }
  });
  test('támadás: régi (már aláírt) state-ben lévő javascript: returnUrl-t a callback NEM adja vissza', async () => {
    const { oauthFlow, signing } = load(FULL);
    mockState.sb = chainSb(() => ({ data: { id: 'new' }, error: null }));
    mockState.fetchQueue = [{ ok: true, status: 200, json: { access_token: 'A', refresh_token: 'R' } }];
    const st = signing.signState({ u: 'alice', r: 'https://r/cb', t: 'javascript:alert(document.cookie)', p: 'gdrive' });
    await expect(oauthFlow.oauthCallback('gdrive', 'C1', st)).resolves.toBeNull();
  });
  test('legitim: az app deep linkje (remix://) és a CORS_ORIGINS-ben engedett web-origin átmegy; az Expo Go exp:// csak dev-ben', () => {
    const prev = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = 'https://remix.app, https://www.remix.app';
    try {
      const { oauthFlow } = load(FULL);
      expect(oauthFlow.safeReturnUrl('remix://storage/connected')).toBe('remix://storage/connected');
      expect(oauthFlow.safeReturnUrl('https://remix.app/storage/connected')).toBe('https://remix.app/storage/connected');
      expect(oauthFlow.safeReturnUrl('https://remix.app.evil.example/x')).toBeNull();
      expect(oauthFlow.safeReturnUrl('exp://192.168.1.5:8081/--/storage/connected')).toBe('exp://192.168.1.5:8081/--/storage/connected');
      expect(loadProd(FULL).oauthFlow.safeReturnUrl('exp://192.168.1.5:8081/--/storage/connected')).toBeNull();
      expect(oauthFlow.safeReturnUrl(null)).toBeNull();
      expect(oauthFlow.safeReturnUrl(42)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prev;
    }
  });
});

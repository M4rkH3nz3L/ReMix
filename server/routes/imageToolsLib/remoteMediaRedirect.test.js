// 🛡️ Regresszió (refactor-roadmap 4. / SSRF átirányításon): a /imagedoc és a /psd/export távoli réteg-médiáját
// a remoteMediaOpts.fetchUrl tölti le. Eddig `safeFetch(u, { redirect: 'follow' })` volt: csak a KIINDULÓ URL-t
// ellenőrizte, a fetch a 302-t validálás nélkül követte → egy nyilvános URL a felhő-metaadatra / localhostra
// irányíthatta a workert. Itt egy hamis „internet” (global.fetch) a valódi fetch redirect-szemantikáját utánozza:
// `redirect: 'follow'`-nál belül követ, `manual`-nál a 3xx választ adja vissza.
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));

const { remoteMediaOpts } = require('./remoteMediaOpts');
const { resolveRemoteMedia } = require('../../imagedocLib/remoteMedia');

// publikus IP-literálok (a dns.lookup hálózat nélkül önmagát adja) + a belső célok
const WEB = {
  'https://8.8.8.8/to-metadata.png': { status: 302, location: 'http://169.254.169.254/latest/meta-data/iam' },
  'https://8.8.8.8/to-localhost.png': { status: 301, location: 'https://127.0.0.1:8787/admin' },
  'https://8.8.8.8/to-lan.png': { status: 307, location: 'https://192.168.1.10/secret.png' },
  'https://8.8.8.8/relative.png': { status: 302, location: '/final.png' },
  'https://8.8.8.8/to-public.png': { status: 302, location: 'https://1.1.1.1/real.png' },
  'https://8.8.8.8/final.png': { status: 200, body: 'PNG-rel' },
  'https://1.1.1.1/real.png': { status: 200, body: 'PNG-public' },
  'https://8.8.8.8/loop.png': { status: 302, location: 'https://8.8.8.8/loop.png' },
  'http://169.254.169.254/latest/meta-data/iam': { status: 200, body: 'AWS-CREDENTIALS' },
  'https://127.0.0.1:8787/admin': { status: 200, body: 'ADMIN' },
  'https://192.168.1.10/secret.png': { status: 200, body: 'LAN' },
};
const hits = [];
function respond(url) {
  const r = WEB[url];
  if (!r) {
    return new Response('nincs', { status: 404 });
  }
  return new Response(r.body ?? null, { status: r.status, headers: r.location ? { location: r.location } : {} });
}
const realFetch = global.fetch;
beforeEach(() => {
  hits.length = 0;
  global.fetch = jest.fn(async (input, init = {}) => {
    let url = String(input);
    for (let i = 0; i < 20; i += 1) {
      hits.push(url);
      const res = respond(url);
      const loc = res.headers.get('location');
      if (!loc || init.redirect === 'manual') {
        return res;
      }
      if (init.redirect === 'error') {
        throw new TypeError('fetch failed: redirect');
      }
      url = new URL(loc, url).toString(); // a valódi fetch így követ ('follow' az alapértelmezés)
    }
    throw new TypeError('redirect count exceeded');
  });
});
afterAll(() => {
  global.fetch = realFetch;
});

const req = { get: () => 'worker.test' };

describe('remoteMediaOpts.fetchUrl — SSRF átirányításon át', () => {
  test.each([
    ['felhő-metaadat (169.254.169.254)', 'https://8.8.8.8/to-metadata.png', 'http://169.254.169.254/latest/meta-data/iam'],
    ['localhost', 'https://8.8.8.8/to-localhost.png', 'https://127.0.0.1:8787/admin'],
    ['LAN (192.168.*)', 'https://8.8.8.8/to-lan.png', 'https://192.168.1.10/secret.png'],
  ])('támadás: nyilvános URL 3xx-szel %s felé → blokkolva, a belső cím NEM kap kérést', async (_n, start, internal) => {
    await expect(remoteMediaOpts(req).fetchUrl(start)).rejects.toMatchObject({ ssrfBlocked: true });
    expect(hits).not.toContain(internal);
  });

  test('nyilvános → nyilvános átirányítás továbbra is működik (abszolút és relatív Location)', async () => {
    const a = await remoteMediaOpts(req).fetchUrl('https://8.8.8.8/to-public.png');
    expect([a.status, await a.text()]).toEqual([200, 'PNG-public']);
    const b = await remoteMediaOpts(req).fetchUrl('https://8.8.8.8/relative.png');
    expect([b.status, await b.text()]).toEqual([200, 'PNG-rel']);
  });

  test('végtelen átirányítás-lánc → elutasítva a hop-plafonnál', async () => {
    await expect(remoteMediaOpts(req).fetchUrl('https://8.8.8.8/loop.png')).rejects.toThrow('átirányítás');
    expect(hits.length).toBeLessThanOrEqual(6);
  });
});

describe('resolveRemoteMedia (/imagedoc, /psd/export) — a metaadat-tartalom nem kerül a renderbe', () => {
  test('a metaadatra irányító réteg hiányzó marad; a legit átirányított réteg letöltődik', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-redirect-'));
    try {
      const doc = {
        layers: [{ uri: 'https://8.8.8.8/to-metadata.png' }, { uri: 'https://8.8.8.8/to-public.png' }],
      };
      await resolveRemoteMedia(doc, dir, remoteMediaOpts(req));
      expect(doc.layers[0].uri).toBe('https://8.8.8.8/to-metadata.png');
      expect(fs.readFileSync(doc.layers[1].uri, 'utf8')).toBe('PNG-public');
      expect(hits).not.toContain('http://169.254.169.254/latest/meta-data/iam');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

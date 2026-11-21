// 🛡️ Regresszió (refactor-roadmap 4. / SSRF beágyazott kompozíción át): a POST /render eddig csak a FELSŐ
// szintű klipek uri-jait írta át a feltöltött fájlokra; a `clip.comp.tracks[*].clips[*]` (és mélyebb) uri-ja
// ellenőrzés nélkül jutott a renderProject → resolveCompounds → ffmpeg `-i`-jére (http://169.254…, file://,
// /etc/passwd). Valódi HTTP-n át, multipart feltöltéssel; a renderProject mockolt (ffmpeg nélkül), így
// látjuk, PONTOSAN mit kapna a render.
process.env.ALLOW_INSECURE_DEV = '1';
process.env.RL_DISABLED = '1';
jest.mock('expo-server-sdk', () => ({ Expo: function Expo() {} }));
const mockRendered = [];
jest.mock('../../render', () => ({
  ...jest.requireActual('../../render'),
  renderProject: async (project) => {
    mockRendered.push(JSON.parse(JSON.stringify(project)));
    return '/nincs/out.mp4';
  },
}));

const express = require('express');
const render = require('../render');
const { errorHandler } = require('../../lib/httpError');

const app = express();
app.use(render);
app.use(errorHandler);

let server;
let base;
beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(() => resolve())));
beforeEach(() => {
  mockRendered.length = 0;
});

const DEVICE = 'file:///var/mobile/a.mp4'; // a telefon helyi uri-ja (ezt tölti fel a kliens f0 néven)
const vclip = (id, uri, extra = {}) => ({ kind: 'video', id, uri, start: 0, duration: 2, trimIn: 0, speed: 1, ...extra });
const comp = (clips) => ({ tracks: [{ id: 'ct', type: 'video', clips }] });
const project = (topClips) => ({ id: 'p', aspectRatio: '9:16', tracks: [{ id: 't', type: 'video', clips: topClips }] });

async function submit(proj) {
  const form = new FormData();
  form.append('project', JSON.stringify(proj));
  form.append('uriMap', JSON.stringify({ [DEVICE]: 'f0' }));
  form.append('f0', new Blob([Buffer.from('fake-mp4')], { type: 'video/mp4' }), 'a.mp4');
  const res = await fetch(`${base}/render`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

describe('POST /render — beágyazott kompozíció uri-jai', () => {
  test.each([
    ['felhő-metaadat (http://169.254.169.254)', 'http://169.254.169.254/latest/meta-data/'],
    ['file:// séma', 'file:///etc/passwd'],
    ['abszolút worker-útvonal', '/etc/passwd'],
  ])('támadás: comp-on belüli %s → 400 „Hiányzó médiafájlok”, a render NEM indul', async (_n, evil) => {
    const r = await submit(project([vclip('top', DEVICE, { comp: comp([vclip('inner', evil)]) })]));
    expect(r).toEqual({ status: 400, body: { error: 'Hiányzó médiafájlok: inner' } });
    expect(mockRendered).toEqual([]);
  });

  test('támadás: kétszintű beágyazás mélyén lévő belső cím is elutasítva', async () => {
    const deep = vclip('mid', DEVICE, { comp: comp([vclip('deep', 'http://127.0.0.1:6379/')]) });
    const r = await submit(project([vclip('top', DEVICE, { comp: comp([deep]) })]));
    expect(r).toEqual({ status: 400, body: { error: 'Hiányzó médiafájlok: deep' } });
  });

  test('támadás: a beágyazott klip matte-je és LUT-ja is átírandó → idegen érték elutasítva', async () => {
    const inner = vclip('inner', DEVICE, { matte: { uri: '/etc/shadow' }, adjust: { lut: { uri: 'http://10.0.0.1/l.cube' } } });
    const r = await submit(project([vclip('top', DEVICE, { comp: comp([inner]) })]));
    expect(r).toEqual({ status: 400, body: { error: 'Hiányzó médiafájlok: inner (matte), inner (LUT)' } });
  });

  test('legit: a feltöltött médiára mutató beágyazott klip a feltöltött fájlra íródik, a render elindul', async () => {
    const r = await submit(project([vclip('top', DEVICE, { comp: comp([vclip('inner', DEVICE)]) })]));
    expect(r.status).toBe(200);
    expect(typeof r.body.id).toBe('string');
    await new Promise((resolve) => setImmediate(resolve));
    const sent = mockRendered[0];
    const top = sent.tracks[0].clips[0];
    const inner = top.comp.tracks[0].clips[0];
    expect(top.uri).toMatch(/vided-render-[^/]+\/f0\.mp4$/);
    expect(inner.uri).toBe(top.uri);
  });

  test('a túl mély (> 8 szintű) beágyazás elutasítva (nem merül ki a verem, nem jut a renderig)', async () => {
    let clip = vclip('c0', DEVICE);
    for (let i = 1; i <= 10; i += 1) {
      clip = vclip(`c${i}`, DEVICE, { comp: comp([clip]) });
    }
    const r = await submit(project([clip]));
    expect(r).toEqual({ status: 400, body: { error: 'Hiányzó médiafájlok: c2 (comp)' } });
    expect(mockRendered).toEqual([]);
  });

  test('comp nélküli projekt változatlanul megy (a felső szintű átírás)', async () => {
    const r = await submit(project([vclip('top', DEVICE)]));
    expect(r.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockRendered[0].tracks[0].clips[0].uri).toMatch(/f0\.mp4$/);
  });
});

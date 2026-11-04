// ⬇️ Feed-letöltés (C2.6–C2.7): a változat-szabály, az aláírt link, és a VALÓDI ffmpeg-vízjel
// képkocka-összevetéssel (a logó helyén eltér a forrástól, a kép közepén nem; +2 mp zárókártya).
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('pngjs');
const pd = require('./postDownload');

describe('downloadVariant (D11)', () => {
  test('tisztát csak a fizetős tulajdonos kap', () => {
    expect(pd.downloadVariant({ tier: 'pro', isOwner: true, allowDownload: true })).toBe('clean');
    expect(pd.downloadVariant({ tier: 'free', isOwner: true, allowDownload: true })).toBe('watermarked');
    expect(pd.downloadVariant({ tier: 'ultra', isOwner: false, allowDownload: true })).toBe('watermarked');
  });
  test('letiltott letöltés: másnak tilos, a tulajdonosnak nem', () => {
    expect(pd.downloadVariant({ tier: 'business', isOwner: false, allowDownload: false })).toBe('forbidden');
    expect(pd.downloadVariant({ tier: 'free', isOwner: true, allowDownload: false })).toBe('watermarked');
  });
});

describe('média-kulcs és aláírt link', () => {
  const env = { MEDIA_SIGNING_SECRET: 'titok' };
  test('a tárolt URL-ből a kulcs (Supabase public / lokális /m/)', () => {
    expect(pd.mediaKeyFromUrl('https://x.supabase.co/storage/v1/object/public/renders/prj_1/video/a.mp4')).toBe('prj_1/video/a.mp4');
    expect(pd.mediaKeyFromUrl('http://192.168.1.2:8787/m/prj_1/video/b.mp4')).toBe('prj_1/video/b.mp4');
    expect(pd.mediaKeyFromUrl('https://idegen.example/v.mp4')).toBeNull();
    expect(pd.watermarkKeyFor('prj_1/video/a.mp4')).toBe('prj_1/video/download/a-wm.mp4');
  });
  test('az aláírás ellenőrzése: helyes elfogad, lejárt / módosított elutasít', () => {
    const now = 1800000000;
    const s = pd.signMediaKey('k/a.mp4', 600, now, env);
    const q = new URLSearchParams(s.path.split('?')[1]);
    expect(pd.verifyMediaSignature(q.get('key'), q.get('exp'), q.get('sig'), now, env)).toBe(true);
    expect(pd.verifyMediaSignature('k/b.mp4', q.get('exp'), q.get('sig'), now, env)).toBe(false);
    expect(pd.verifyMediaSignature(q.get('key'), q.get('exp'), q.get('sig'), now + 601, env)).toBe(false);
  });
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
(hasFfmpeg ? describe : describe.skip)('burnWatermark — valódi ffmpeg', () => {
  jest.setTimeout(60000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-test-'));
  const src = path.join(tmp, 'src.mp4');
  const frame = (file, t, out) => {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', out]);
    return PNG.sync.read(fs.readFileSync(out));
  };
  // egy régió átlagos eltérése két képkocka között (0–255)
  const diff = (a, b, x0, y0, w, h) => {
    let s = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * a.width + x) * 4;
      s += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    }
    return s / (w * h * 3);
  };

  beforeAll(() => {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src]);
  });

  test('a kimenet 2 mp-cel hosszabb (zárókártya), hanggal; a logó helyén eltér, a közepén nem', async () => {
    const { output } = await pd.burnWatermark(src, { username: 'teszt_alkoto', postUrl: 'https://remix.app/p/1' });
    const meta = await pd.probe(output);
    expect(meta.duration).toBeGreaterThan(4.8);
    expect(meta.duration).toBeLessThan(5.4);
    expect(meta.hasAudio).toBe(true);
    const a = frame(src, 1, path.join(tmp, 'a.png'));
    const b = frame(output, 1, path.join(tmp, 'b.png'));
    expect(diff(a, b, 640 - 24 - 60, 30, 50, 20)).toBeGreaterThan(20); // a logó (jobb felső sarok, az első 4 mp)
    expect(diff(a, b, 24 + 4, 360 - 24 - 20, 60, 14)).toBeGreaterThan(20); // @alkotó (bal alsó)
    expect(diff(a, b, 280, 150, 80, 60)).toBeLessThan(6); // a kép közepe érintetlen
    const end = frame(output, 4.2, path.join(tmp, 'c.png'));
    expect(end.data[(10 * end.width + 10) * 4]).toBeLessThan(20); // a zárókártya sötét háttere
  });

  test('hang nélküli forrásból is készül (néma sávval)', async () => {
    const mute = path.join(tmp, 'mute.mp4');
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=24:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mute]);
    const { output } = await pd.burnWatermark(mute, { username: 'x', postUrl: 'https://remix.app' });
    const meta = await pd.probe(output);
    expect(meta.hasAudio).toBe(true);
    expect(meta.duration).toBeGreaterThan(3.8);
  });
});

const { logCaught } = require('./lib/caught');
// ⬇️ Feed-videó letöltése és vízjelezése (PRO-CASH 4.5, C2.5–C2.7, D1, D11).
//
//   • melyik változat jár (`downloadVariant`): tisztát CSAK a fizetős tulajdonos kap a saját
//     posztjáról; Free-nek és mások posztjánál mindenkinek vízjeles (szerzői jog, növekedési csatorna);
//     ha az alkotó letiltotta, másnak nincs letöltés;
//   • a vízjel (`burnWatermark`): mozgó, félig átlátszó ReMix-logó (sarokváltó), `@alkotó`, és a végén
//     2 mp-es zárókártya („Készült a ReMixszel” + QR-kód a posztra). A szerver ffmpeg-gel égeti rá,
//     a kliens nem tudja kihagyni. A szöveget képként rajzoljuk (@napi-rs/canvas), így a drawtext
//     nélküli ffmpeg-buildeken is megy;
//   • aláírt, rövid életű média-link (`signMediaKey` / `verifyMediaSignature`): a tár privát lehet,
//     a worker HMAC-kal aláírt linken szolgál (letöltés most, lejátszás a privát bucket után).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

/** Melyik letöltési változat jár. */
function downloadVariant({ tier, isOwner, allowDownload }) {
  if (isOwner) {
    return tier && tier !== 'free' ? 'clean' : 'watermarked';
  }
  return allowDownload === false ? 'forbidden' : 'watermarked';
}

/** A tárolt videó-URL-ből a tár-kulcs (Supabase public / S3 public / lokális /m/). Null, ha idegen. */
function mediaKeyFromUrl(url, bucket = process.env.MEDIA_BUCKET || 'renders') {
  const u = String(url || '');
  const sb = u.indexOf(`/storage/v1/object/public/${bucket}/`);
  if (sb >= 0) {
    return decodeURIComponent(u.slice(sb + `/storage/v1/object/public/${bucket}/`.length).split('?')[0]);
  }
  const m = /\/m\/(.+?)(\?|$)/.exec(u);
  if (m) {
    return decodeURIComponent(m[1]);
  }
  const s3Base = (process.env.S3_PUBLIC_BASE || '').replace(/\/+$/, '');
  if (s3Base && u.startsWith(`${s3Base}/`)) {
    return decodeURIComponent(u.slice(s3Base.length + 1).split('?')[0]);
  }
  return null;
}

function signingSecret(env = process.env) {
  const s = env.MEDIA_SIGNING_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!s) {
    throw new Error('MEDIA_SIGNING_SECRET nincs beállítva.');
  }
  return s;
}

/** Aláírt média-út: `/media/signed?key=…&exp=…&sig=…` (alap: 10 perc). */
function signMediaKey(key, ttlSec = 600, nowSec = Math.floor(Date.now() / 1000), env = process.env) {
  const exp = nowSec + ttlSec;
  const sig = crypto.createHmac('sha256', signingSecret(env)).update(`${key}\n${exp}`).digest('hex');
  return { path: `/media/signed?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sig}`, expiresAt: new Date(exp * 1000).toISOString() };
}

function verifyMediaSignature(key, exp, sig, nowSec = Math.floor(Date.now() / 1000), env = process.env) {
  if (!key || !exp || !sig || Number(exp) < nowSec) {
    return false;
  }
  const want = Buffer.from(crypto.createHmac('sha256', signingSecret(env)).update(`${key}\n${exp}`).digest('hex'), 'hex');
  const got = Buffer.from(String(sig), 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** A vízjeles példány kulcsa (a mesterpéldány mellett, `download/` alatt). */
function watermarkKeyFor(sourceKey) {
  const dir = path.posix.dirname(sourceKey);
  const base = path.posix.basename(sourceKey).replace(/\.[^.]+$/, '');
  return `${dir === '.' ? '' : `${dir}/`}download/${base}-wm.mp4`;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${code}: ${err.slice(-400)}`))));
  });
}

/** A forrás méretei, képkocka-sebessége, hossza és van-e hangja (ffprobe). */
async function probe(file) {
  const json = JSON.parse(await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]));
  const v = (json.streams || []).find((s) => s.codec_type === 'video');
  if (!v) {
    throw new Error('A forrásban nincs videósáv.');
  }
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '30/1').split('/').map(Number);
  return {
    width: v.width,
    height: v.height,
    fps: d ? Math.max(1, Math.min(60, Math.round(n / d))) : 30,
    duration: Number(json.format && json.format.duration) || 0,
    hasAudio: (json.streams || []).some((s) => s.codec_type === 'audio'),
  };
}

/** A vízjel-rétegek PNG-ként (logó-jelvény, @alkotó, zárókártya QR-kóddal). */
// a vízjel betűkészlete: Poppins (teljes magyar ékezetkészlet — az alapértelmezett sans-serif
// a szerveren hiányos lehet, és az „é” üres dobozként jelenne meg)
let fontReady = false;
function ensureFont(GlobalFonts) {
  if (!fontReady) {
    GlobalFonts.registerFromPath(path.join(__dirname, 'assets', 'fonts', 'Poppins-Bold.ttf'), 'RemixMark');
    fontReady = true;
  }
}

function drawLayers({ width, height, username, postUrl }) {
  const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
  ensureFont(GlobalFonts);
  const { toQR } = require('toqr');
  const unit = Math.max(12, Math.round(Math.min(width, height) / 22));

  const logo = createCanvas(unit * 7, Math.round(unit * 2.2));
  const lc = logo.getContext('2d');
  lc.globalAlpha = 0.72;
  lc.fillStyle = '#000000';
  lc.beginPath();
  lc.roundRect(0, 0, logo.width, logo.height, unit * 0.6);
  lc.fill();
  lc.globalAlpha = 0.92;
  lc.fillStyle = '#ffffff';
  lc.font = `bold ${Math.round(unit * 1.2)}px RemixMark`;
  lc.textBaseline = 'middle';
  lc.fillText('ReMix', unit * 0.7, logo.height / 2);

  const handle = `@${String(username || 'remix').slice(0, 30)}`;
  const user = createCanvas(Math.min(width - unit, unit * (handle.length * 0.75 + 2)), Math.round(unit * 1.9));
  const uc = user.getContext('2d');
  uc.globalAlpha = 0.6;
  uc.fillStyle = '#000000';
  uc.beginPath();
  uc.roundRect(0, 0, user.width, user.height, unit * 0.5);
  uc.fill();
  uc.globalAlpha = 0.95;
  uc.fillStyle = '#ffffff';
  uc.font = `${Math.round(unit)}px RemixMark`;
  uc.textBaseline = 'middle';
  uc.fillText(handle, unit * 0.6, user.height / 2);

  const card = createCanvas(width, height);
  const cc = card.getContext('2d');
  cc.fillStyle = '#07080d';
  cc.fillRect(0, 0, width, height);
  cc.fillStyle = '#ffffff';
  cc.textAlign = 'center';
  cc.font = `bold ${Math.round(unit * 1.6)}px RemixMark`;
  cc.fillText('Készült a ReMixszel', width / 2, height * 0.22);
  cc.font = `${Math.round(unit * 1.1)}px RemixMark`;
  cc.fillText(handle, width / 2, height * 0.22 + unit * 2);
  const bits = toQR(String(postUrl || 'https://remix.app'));
  const n = Math.sqrt(bits.length);
  const qrSize = Math.round(Math.min(width, height) * 0.42);
  const cell = Math.floor(qrSize / (n + 8));
  const qx = Math.round(width / 2 - (cell * (n + 8)) / 2);
  const qy = Math.round(height * 0.58 - (cell * (n + 8)) / 2);
  cc.fillStyle = '#ffffff';
  cc.fillRect(qx, qy, cell * (n + 8), cell * (n + 8));
  cc.fillStyle = '#000000';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (bits[y * n + x]) {
        cc.fillRect(qx + (x + 4) * cell, qy + (y + 4) * cell, cell, cell);
      }
    }
  }
  return { logo: logo.toBuffer('image/png'), user: user.toBuffer('image/png'), card: card.toBuffer('image/png') };
}

/** Az ffmpeg-argumentumok (tiszta — tesztelhető): logó sarokváltással, @alkotó, 2 mp zárókártya. */
function watermarkArgs({ input, logo, user, card, output, meta }) {
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  const W = even(meta.width);
  const H = even(meta.height);
  const audioIn = meta.hasAudio ? ['-i', input] : ['-f', 'lavfi', '-t', String(Math.max(0.1, meta.duration)), '-i', 'anullsrc=r=48000:cl=stereo'];
  const filter = [
    `[0:v]scale=${W}:${H},setsar=1[src]`,
    // a logó 4 másodpercenként sarkot vált (jobb felső ↔ bal felső) — nem lehet egy fix kivágással eltüntetni
    `[src][1:v]overlay=x='if(lt(mod(t\\,8)\\,4)\\,W-w-24\\,24)':y=24:shortest=1[v1]`,
    `[v1][2:v]overlay=x=24:y=H-h-24:shortest=1,fps=${meta.fps},format=yuv420p[main]`,
    `[3:v]scale=${W}:${H},setsar=1,fps=${meta.fps},format=yuv420p[card]`,
    `[4:a]aresample=48000,aformat=channel_layouts=stereo[a0]`,
    `[5:a]aformat=channel_layouts=stereo[a1]`,
    `[main][a0][card][a1]concat=n=2:v=1:a=1[v][a]`,
  ].join(';');
  return [
    '-y', '-i', input,
    '-loop', '1', '-i', logo,
    '-loop', '1', '-i', user,
    '-loop', '1', '-t', '2', '-i', card,
    ...audioIn,
    '-f', 'lavfi', '-t', '2', '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', filter,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', output,
  ];
}

/** A vízjeles példány elkészítése egy helyi forrásfájlból. Visszaadja a kimenet útját. */
async function burnWatermark(inputPath, { username, postUrl }) {
  const meta = await probe(inputPath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remix-wm-'));
  const layers = drawLayers({ width: meta.width, height: meta.height, username, postUrl });
  const files = { logo: path.join(dir, 'logo.png'), user: path.join(dir, 'user.png'), card: path.join(dir, 'card.png') };
  for (const [k, p] of Object.entries(files)) {
    fs.writeFileSync(p, layers[k]);
  }
  const output = path.join(dir, 'wm.mp4');
  try {
    await run('ffmpeg', watermarkArgs({ input: inputPath, ...files, output, meta }));
  } catch (caught) {
    logCaught('postDownload.js:burnWatermark', caught);
    throw new Error('watermark_failed');
  }
  return { output, dir, meta };
}

module.exports = {
  downloadVariant,
  mediaKeyFromUrl,
  signMediaKey,
  verifyMediaSignature,
  watermarkKeyFor,
  watermarkArgs,
  drawLayers,
  probe,
  burnWatermark,
};

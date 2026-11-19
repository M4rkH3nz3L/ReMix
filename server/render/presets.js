// 🎚️ Export-presetek: videó-/hang-enkóder argumentumok, kimeneti szín-tér, hang-only és GIF
// export. (A server/render.js-ből kiemelve, változatlan tartalommal.)
const { ffmpegHasFilter } = require('./ffmpeg');

const V_ENCODER = { h264: 'libx264', hevc: 'libx265', av1: 'libsvtav1', prores: 'prores_ks' };

/**
 * 🎚️ Pro export videó-enkóder argumentumok: kodek (H.264/HEVC/AV1/ProRes),
 * bit-mélység (8/10), bitráta-mód (CRF/VBR/CBR + bitráta), GOP, és szín-tér/HDR
 * (Rec.709 / Rec.2020 / PQ). A ProRes intra-only + 10-bit 4:2:2 (.mov).
 */
function videoEncoderArgs(settings, fps, crf) {
  const codec = V_ENCODER[settings.codec] ? settings.codec : 'h264';
  const enc = V_ENCODER[codec];
  const depth10 = settings.bitDepth === 10 || settings.hdr === true;
  const gop = Math.max(2, Math.round(Number(settings.gop) || fps * 2));
  const mode = settings.bitrateMode || 'crf';
  const mbps = Math.max(0, Number(settings.bitrateMbps) || 0);
  const args = ['-c:v', enc];

  if (codec === 'prores') {
    // ProRes: 10-bit 4:2:2, HQ profil (3); a bitrátát a profil vezérli
    args.push('-profile:v', '3', '-pix_fmt', 'yuv422p10le');
  } else {
    args.push('-pix_fmt', depth10 ? 'yuv420p10le' : 'yuv420p');
    if (codec === 'av1') {
      args.push('-preset', '6');
    } else {
      args.push('-preset', 'veryfast');
      if (codec === 'hevc') {
        args.push('-tag:v', 'hvc1'); // Apple/QuickTime-kompatibilis HEVC az mp4-ben
      }
    }
    // rate control
    if (mode === 'cbr' && mbps > 0) {
      args.push('-b:v', `${mbps}M`, '-maxrate', `${mbps}M`, '-minrate', `${mbps}M`, '-bufsize', `${mbps * 2}M`);
    } else if (mode === 'vbr' && mbps > 0) {
      args.push('-b:v', `${mbps}M`, '-maxrate', `${(mbps * 1.5).toFixed(1)}M`, '-bufsize', `${mbps * 2}M`);
    } else {
      args.push('-crf', String(crf));
    }
    args.push('-g', String(gop));
  }

  // szín-tér / HDR (a tag-elés; a 10-bit HDR PQ-hoz kell)
  if (settings.hdr === true) {
    args.push('-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'smpte2084');
  } else if (settings.colorSpace === 'rec2020') {
    args.push('-colorspace', 'bt2020nc', '-color_primaries', 'bt2020', '-color_trc', 'bt709');
  } else {
    args.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  }
  return args;
}

/**
 * 🌈 B22: a kimenet VALÓDI szín-konverziója (nem csak címke). Eddig a HDR/Rec.2020
 * export csak a szín-tageket állította → HDR-nek / BT.2020-nak jelölt SDR-pixelek lettek
 * (kifakult / túlszaturált lejátszás). Most:
 *  • HDR (PQ): SDR → lineáris (203 nit referencia-fehér, ITU-R BT.2408) → BT.2020 → PQ,
 *    10 bit — zscale (zimg) kell hozzá; ha a szerver ffmpeg-je nem tudja, ÉRTHETŐ hiba;
 *  • Rec.2020 (SDR): BT.709 → BT.2020 primer-konverzió (az ffmpeg natív `colorspace`);
 *  • alap: Rec.709 (változatlan).
 */
function outputColorFilter(settings, hasFilter = ffmpegHasFilter) {
  if (settings.hdr === true) {
    if (!hasFilter('zscale')) {
      throw new Error(
        'A HDR (PQ) exporthoz a render-szerver ffmpeg-jében zscale (zimg) szükséges — kapcsold ki a HDR-t, vagy frissítsd a szervert.'
      );
    }
    return 'zscale=tin=bt709:pin=bt709:min=bt709:t=linear:npl=203,format=gbrpf32le,zscale=p=bt2020:t=smpte2084:m=bt2020nc:npl=203,format=yuv420p10le';
  }
  if (settings.colorSpace === 'rec2020') {
    return 'colorspace=all=bt2020:iall=bt709:fast=0:format=yuv420p10';
  }
  return 'format=yuv420p';
}

/** 🎚️ Pro export hang-enkóder args: AAC + bitráta/mintavétel/csatorna. */
function audioEncoderArgs(settings) {
  const args = ['-c:a', 'aac', '-b:a', `${Math.max(64, Math.round(Number(settings.audioBitrateKbps) || 192))}k`];
  if (settings.sampleRate) {
    args.push('-ar', String(settings.sampleRate));
  }
  if (settings.channels) {
    args.push('-ac', String(settings.channels));
  }
  return args;
}

// 🎧 HANG-ONLY export: a kész (kevert + masterelt) videóból kivont hang formátumai.
// A kivonás egy KÜLÖN, egyszerű ffmpeg-menet (`-vn`) → a videó-filtergraph
// érintetlen (biztonságos). Kulcs = `settings.audioFormat`.
const AUDIO_FORMATS = {
  wav: { ext: 'wav', lossy: false, codec: ['-c:a', 'pcm_s16le'], codec24: ['-c:a', 'pcm_s24le'] },
  mp3: { ext: 'mp3', lossy: true, codec: ['-c:a', 'libmp3lame'], defaultKbps: 192 },
  aac: { ext: 'm4a', lossy: true, codec: ['-c:a', 'aac'], defaultKbps: 256 },
  flac: { ext: 'flac', lossy: false, codec: ['-c:a', 'flac'], codec24: ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24'] },
  opus: { ext: 'opus', lossy: true, codec: ['-c:a', 'libopus'], defaultKbps: 192 },
};

/**
 * A hang-only export codec + MINŐSÉG-argumentumai a formátumból + a RenderSettings-ből.
 * A veszteséges formátumok (mp3/aac/opus) `-b:a` bitrátát kapnak (settings vagy per-formátum
 * alap), a veszteségmentesek (wav/flac) nem. A `sampleRate` (`-ar`) és `channels` (`-ac`)
 * mindkettőre érvényes. `null`, ha nincs/ismeretlen audioFormat. (pure → tesztelhető)
 */
/** csak ismert mintavétel jut az ffmpeg-ig (a kliens beállítása nem megbízható) */
function safeSampleRate(settings = {}) {
  const rate = Number(settings.sampleRate);
  return [22050, 32000, 44100, 48000, 88200, 96000].includes(rate) ? rate : null;
}

function audioExtractArgs(settings = {}) {
  const fmt = AUDIO_FORMATS[settings.audioFormat];
  if (!fmt) {
    return null;
  }
  // a veszteségmentes kimenet a lebegőpontos mixből: 16 biten dither (TPDF), 24 bit kérhető
  const deep = !fmt.lossy && Number(settings.audioBitDepth) === 24;
  const args = [...(deep ? fmt.codec24 : fmt.codec)];
  if (!fmt.lossy && !deep) {
    args.push('-af', 'aresample=dither_method=triangular,aformat=sample_fmts=s16');
  }
  if (fmt.lossy) {
    const kbps = Math.max(32, Math.min(512, Math.round(Number(settings.audioBitrateKbps) || fmt.defaultKbps)));
    args.push('-b:a', `${kbps}k`);
  }
  const rate = safeSampleRate(settings);
  if (rate) {
    args.push('-ar', String(rate));
  }
  if ([1, 2].includes(Number(settings.channels))) {
    args.push('-ac', String(settings.channels));
  }
  return { ext: fmt.ext, args };
}

/**
 * 🎞️ GIF-export argumentumai (VIDEO-STUDIO §5): a kész videóból palettegen/paletteuse
 * két-fázisú (egy filtergraph) GIF — lekicsinyítve + alacsonyabb fps (a GIF nagy). A
 * `gifFps` (5–30, alap 15) és `gifWidth` (120–1080, alap 480) a settings-ből. (pure → tesztelt)
 */
function gifArgs(settings = {}) {
  const fps = Math.max(5, Math.min(30, Math.round(Number(settings.gifFps) || 15)));
  const width = Math.max(120, Math.min(1080, Math.round(Number(settings.gifWidth) || 480)));
  const vf =
    `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=bayer`;
  return { ext: 'gif', fps, width, args: ['-vf', vf, '-loop', '0'] };
}

module.exports = {
  V_ENCODER,
  videoEncoderArgs,
  outputColorFilter,
  audioEncoderArgs,
  AUDIO_FORMATS,
  safeSampleRate,
  audioExtractArgs,
  gifArgs,
};

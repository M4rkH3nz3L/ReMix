// A projekt-JSON → FFmpeg parancs fordítása és futtatása.
//
// Vizuális sáv: a klipek start szerint rendezve, átfedésnél a későbbi győz
// (mint az app activeVisualClip-je), a lyukakat fekete tölti ki. Sebesség,
// szűrő-overlay és fade a szegmensen belül érvényesül. A feliratok előre
// rasterizált PNG-k, időzített overlay-ként. Hang: néma alap + minden
// hozzájárulás amix-szel (normalize=0), így az időzítés determinisztikus.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { bgRemoveDir } = require('./bgremove');
const { depthLayerDir } = require('./depth');
const { renderShapePngs, renderTextPngs } = require('./text-render');
const { VOICE_ENHANCE, dereverbChain, audioFxChain, panFilter } = require('./voicechain');

const FPS = 30;

const CANVAS = {
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '1:1': { w: 1080, h: 1080 },
};

// 🎨 blend-mód → ffmpeg `blend=all_mode` név (a többi 1:1; a preview CSS-neve külön)
const FFMPEG_BLEND = { colordodge: 'dodge', colorburn: 'burn' };
const blendName = (m) => FFMPEG_BLEND[m] || m;

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs ?? 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} hiba: ${stderr?.slice(-2000) || err.message}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function hasAudioStream(file) {
  try {
    const { stdout } = await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      file,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function trackOf(project, type) {
  return project.tracks.find((t) => t.type === type) ?? { clips: [] };
}

/** klipek több sávtípusból (v3 séma: music/voiceover/sfx; legacy: audio) */
function clipsOfTypes(project, types) {
  return project.tracks
    .filter((t) => types.includes(t.type))
    .flatMap((t) => t.clips);
}

function clipEnd(c) {
  return c.start + c.duration;
}

function projectDuration(project) {
  let max = 0;
  for (const track of project.tracks) {
    for (const c of track.clips) {
      max = Math.max(max, clipEnd(c));
    }
  }
  return max;
}

/** 0.5–2.0 közé bontott atempo-lánc tetszőleges sebességhez */
function atempoChain(speed) {
  const parts = [];
  let s = speed;
  while (s > 2.0) {
    parts.push('atempo=2.0');
    s /= 2.0;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s /= 0.5;
  }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

/** filterId → drawbox szín/átlátszóság (az app előnézetének megfelelően) */
const FILTERS = {
  warm: { color: 'ff9d4d', opacity: 0.18 },
  cool: { color: '4d9dff', opacity: 0.18 },
  mono: { color: '808080', opacity: 0.45 },
  vivid: { color: 'ff2ea6', opacity: 0.1 },
  fade: { color: 'd8d2c2', opacity: 0.25 },
  night: { color: '101040', opacity: 0.35 },
  retro: { color: 'c9a24b', opacity: 0.22 },
  sunset: { color: 'ff6b4a', opacity: 0.2 },
  forest: { color: '2e8b57', opacity: 0.18 },
};

/**
 * Képjavítás (Creative Canvas): eq + colorbalance + vignette a kész
 * (kompozitált) klip-képre — az app előnézete közelít, itt a végleges.
 */
function adjustChain(clip, enableExpr) {
  const a = clip.adjust;
  if (!a) {
    return '';
  }
  const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
  const brightness = clampNum(a.brightness, -0.3, 0.3);
  const contrast = 1 + clampNum(a.contrast, -0.4, 0.4);
  const saturation = 1 + clampNum(a.saturation, -1, 1);
  const temperature = clampNum(a.temperature, -0.3, 0.3);
  const vignette = clampNum(a.vignette, 0, 1);
  // grade-réteg (adjust-sáv) esetén minden szűrő időablakot kap (enable),
  // hogy csak a klip tartama alatt hasson a teljes kompozitra
  const en = enableExpr ? `:enable='${enableExpr}'` : '';
  const parts = [];
  if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
    parts.push(
      `eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}${en}`
    );
  }
  if (temperature !== 0) {
    // meleg: vörös fel / kék le a középtónusokon (és fordítva)
    parts.push(`colorbalance=rm=${temperature.toFixed(3)}:bm=${(-temperature).toFixed(3)}${en}`);
  }
  if (vignette > 0.01) {
    parts.push(`vignette=angle=${(vignette * (Math.PI / 4)).toFixed(4)}${en}`);
  }
  return parts.length ? ',' + parts.join(',') : '';
}

/**
 * 🎨 Filmes grade-presetek (LUT-szerű look-ok) a grade-rétegre. Minden preset
 * ffmpeg-szűrők LISTÁJA (split-tone: eq + colorbalance s/m/h + vignette) — a
 * `constants/grades.ts` UGYANEZEKKEL az id-kkal ad előnézeti tint-közelítést.
 * Minden szűrő külön `enable`-ablakot kaphat (a grade-réteg tartama).
 */
const GRADES = {
  'teal-orange': [
    'eq=contrast=1.10:saturation=1.08',
    'colorbalance=rs=-0.12:gs=0.02:bs=0.16:rh=0.16:gh=0.03:bh=-0.14',
  ],
  moody: [
    'eq=brightness=-0.04:contrast=1.12:saturation=0.82',
    'colorbalance=rs=-0.04:bs=0.12:rm=-0.03:bm=0.06',
    'vignette=angle=0.9',
  ],
  vintage: [
    'eq=brightness=0.03:contrast=0.9:saturation=0.85:gamma=1.06',
    'colorbalance=rs=0.10:gs=0.05:bs=-0.08:rh=0.10:bh=-0.12',
  ],
  noir: ['eq=brightness=-0.02:contrast=1.25:saturation=0', 'vignette=angle=0.8'],
  'warm-film': [
    'eq=contrast=1.06:saturation=1.05',
    'colorbalance=rm=0.10:gm=0.03:bm=-0.12:rh=0.08:bh=-0.10',
  ],
  cold: [
    'eq=contrast=1.06',
    'colorbalance=rm=-0.10:bm=0.12:rs=-0.06:bs=0.12:rh=-0.04:bh=0.06',
  ],
  vibrant: ['eq=contrast=1.12:saturation=1.35:gamma=0.98'],
  dreamy: [
    'eq=brightness=0.05:contrast=0.9:saturation=1.08:gamma=1.05',
    'colorbalance=rm=0.06:bm=0.06:rh=0.08:bh=0.04',
  ],
};

/**
 * A grade-réteg teljes lánca: előbb a `grade` preset (ha van), MAJD a kézi
 * `adjust` finomhangolás — mindkettő `enable`-ablakkal a klip tartamára. Vezető
 * vesszős füzért ad (mint az adjustChain), üres, ha se preset, se kézi korrekció.
 */
function gradeChain(clip, enableExpr) {
  const en = enableExpr ? `:enable='${enableExpr}'` : '';
  const parts = [];
  const preset = clip.grade && clip.grade !== 'none' ? GRADES[clip.grade] : null;
  if (preset) {
    for (const f of preset) {
      parts.push(f + en);
    }
  }
  const presetChain = parts.length ? ',' + parts.join(',') : '';
  // a kézi adjust vezető vesszős láncot ad (szintén enable-ablakkal) — RÁrétegződik
  return presetChain + adjustChain(clip, enableExpr);
}

/**
 * 💡 Lighting-presetek (🧊 3D V2): hangulat-világítás split-tone color-grade-
 * ként — az árnyék/középtónus/csúcsfény külön színt kap (colorbalance
 * s/m/h csatornák), eq-val kísérve. A képjavítás (adjust) UTÁN fut.
 */
const LIGHTING = {
  studio: 'eq=brightness=0.04:contrast=1.06:saturation=1.04,colorbalance=rm=0.02:bm=0.02',
  sunset:
    'eq=contrast=1.05:saturation=1.08,' +
    'colorbalance=rm=0.16:gm=0.03:bm=-0.18:rh=0.10:bh=-0.14:rs=0.06:bs=-0.06',
  neon:
    'eq=contrast=1.08:saturation=1.22,' +
    'colorbalance=rm=0.10:bm=0.20:rs=0.12:bs=0.22:gh=-0.05',
  cyberpunk:
    'eq=contrast=1.12:saturation=1.12,' +
    'colorbalance=rs=-0.14:gs=0.02:bs=0.24:rh=0.18:gh=0.02:bh=-0.20',
};

function lightingChain(clip) {
  const preset = LIGHTING[clip.lighting];
  return preset ? `,${preset}` : '';
}

/**
 * 🎯 AI Select (CC V2): a képjavítás CSAK a kijelölésre hat — a korrigált és
 * az eredeti kép a téma-maszkkal keveredik (maskedmerge). A maszk a bgremove
 * cache-ből jön; háttér-célnál a maszk invertálva megy.
 */
function selectiveChain(clip, W, H, labelIn, labelOut, idx, graph, addInput, dur) {
  const sel = clip.selective;
  const adjust = adjustChain(clip);
  if (!sel || !adjust) {
    return false;
  }
  const alphaFile = path.join(bgRemoveDir(sel.id), 'alpha.png');
  if (!fs.existsSync(alphaFile)) {
    return false;
  }
  const aIdx = addInput(['-loop', '1', '-t', dur.toFixed(3), '-i', alphaFile]);
  const invert = sel.target === 'background' ? ',lutyuv=y=negval' : '';
  graph.push(`[${labelIn}]split[selA${idx}][selB${idx}]`);
  // a korrekció a MÁSOLATON fut, majd a maszk szerint keveredik vissza
  // (a maskedmerge minden bemenete gbrp — különben gray-re tárgyalna le)
  graph.push(`[selB${idx}]${adjust.slice(1)},format=gbrp[selC${idx}]`);
  graph.push(`[selA${idx}]format=gbrp[selD${idx}]`);
  graph.push(
    `[${aIdx}:v]scale=${W}:${H},format=gray${invert},format=gbrp[selM${idx}]`
  );
  graph.push(
    `[selD${idx}][selC${idx}][selM${idx}]maskedmerge,format=yuv420p[${labelOut}]`
  );
  return true;
}

/**
 * 🙈 Arc-elmosás (adatvédelem): a régió KIVÁGVA elmosódik és visszakerül a
 * helyére — így a szűrő csak a kis területen fut (gyors), és a kép többi
 * része érintetlen marad. A régió statikus (a mintavett arcok uniója+margó),
 * páros pixelekre igazítva; a `pixelate` mozaikot ad lágy blur helyett.
 */
/**
 * 🌀 Mozgás-elmosás / sima lassítás (speed ramp v2) — a `fps=` lépést váltja ki.
 * Gyorsításnál a decimálás ELŐTT keveri a kockákat (tmix), így épp azokat mossa
 * össze, amiket a képkocka-ritkítás eldobna. Lassításnál a minterpolate köztes
 * kockákat számol a lépcsőzés helyett; ez CPU-igényes, ezért rövid darabokra
 * korlátozzuk. Erő nélkül a régi, egyszerű fps-lánc megy.
 */
function motionChain(clip, dur) {
  const strength = Math.max(0, Math.min(1, clip.motionBlur ?? 0));
  const plain = `fps=${FPS},`;
  if (strength <= 0) {
    return plain;
  }
  if (clip.speed > 1.05) {
    // a sebességgel arányos keverési ablak (2× → ~4 kocka, 6×-nál a 8-as plafon)
    const frames = Math.max(2, Math.min(8, Math.round(1 + strength * clip.speed * 1.6)));
    return `tmix=frames=${frames},${plain}`;
  }
  if (clip.speed < 0.95 && dur <= 8) {
    return (
      `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,`
    );
  }
  return plain;
}

function faceBlurChain(clip, W, H, labelIn, labelOut, idx, graph, skip = 0) {
  const fb = clip.faceBlur;
  if (!fb) {
    return false;
  }
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const bw = even(Math.min(1, Math.max(0.03, fb.w)) * W);
  const bh = even(Math.min(1, Math.max(0.03, fb.h)) * H);
  const strength = Math.min(2, Math.max(0.3, fb.strength ?? 1));
  // mozaik: a régió ~14 blokk szélesre zsugorodik, majd pont-mintásan vissza —
  // a blokkméret így a régió MÉRETÉHEZ igazodik (felismerhetetlen arc), nem
  // fix pixelszámhoz
  const blocks = Math.max(4, Math.round(14 / strength));
  const effect = fb.pixelate
    ? `scale=${Math.max(2, blocks)}:${Math.max(
        2,
        Math.round((blocks * bh) / bw)
      )},scale=${bw}:${bh}:flags=neighbor`
    : `gblur=sigma=${(Math.min(bw, bh) * 0.09 * strength).toFixed(1)}`;

  // 🎯 KÖVETÉS: fix méretű régió, mozgó középpont — a crop/overlay x/y per-frame
  // T-kifejezés (T = szűrő-idő + skip = klip-lokális). Track nélkül statikus.
  const track = Array.isArray(fb.track) && fb.track.length > 0 ? [...fb.track].sort((a, b) => a.t - b.t) : null;
  let bxTok;
  let byTok;
  if (track) {
    const T = `(t+${skip.toFixed(3)})`;
    const px5 = (v) => Number(v).toFixed(5);
    const axisExpr = (axis, fb0) => {
      const fr = track.map((p) => ({ t: p.t, v: p[axis] ?? fb0 }));
      let expr = px5(fr[fr.length - 1].v);
      for (let k = fr.length - 2; k >= 0; k--) {
        const a = fr[k];
        const b = fr[k + 1];
        const span = Math.max(b.t - a.t, 0.001);
        const P = `min(max((${T}-${px5(a.t)})/${px5(span)},0),1)`;
        expr = `if(lt(${T},${px5(b.t)}),(${px5(a.v)}+${px5(b.v - a.v)}*${P}),${expr})`;
      }
      return `if(lt(${T},${px5(fr[0].t)}),${px5(fr[0].v)},${expr})`;
    };
    // középpont → bal-felső sarok, a képkeretre klippelve
    bxTok = `clip((${axisExpr('x', fb.x)})*${W}-${bw / 2},0,${W - bw})`;
    byTok = `clip((${axisExpr('y', fb.y)})*${H}-${bh / 2},0,${H - bh})`;
  } else {
    bxTok = String(even(Math.min(W - bw, Math.max(0, (fb.x - fb.w / 2) * W))));
    byTok = String(even(Math.min(H - bh, Math.max(0, (fb.y - fb.h / 2) * H))));
  }
  graph.push(`[${labelIn}]split[fbA${idx}][fbB${idx}]`);
  graph.push(`[fbB${idx}]crop=w=${bw}:h=${bh}:x='${bxTok}':y='${byTok}',${effect}[fbC${idx}]`);
  graph.push(`[fbA${idx}][fbC${idx}]overlay=x='${bxTok}':y='${byTok}'[${labelOut}]`);
  return true;
}

/**
 * 🎭 Track/luma/alpha matte: egy külső média (kép) fényereje (luma) vagy alfája
 * adja a klip átlátszóságát. A matte WxH-ra skálázva → gray/alphaextract (opc.
 * negate) → a fg-alfával szorozva (alphamerge). Visszaadja az új címkét, vagy a
 * bemenetit, ha nincs matte.
 */
function matteChain(clip, W, H, labelIn, idx, graph, addInput, dur) {
  const m = clip.matte;
  if (!m || !m.uri) {
    return labelIn;
  }
  const mIdx = addInput(['-loop', '1', '-t', dur.toFixed(3), '-i', m.uri]);
  const inv = m.invert ? ',negate' : '';
  if (m.type === 'alpha') {
    graph.push(`[${mIdx}:v]scale=${W}:${H},format=rgba,alphaextract${inv}[mta${idx}]`);
  } else {
    graph.push(`[${mIdx}:v]scale=${W}:${H},format=gray${inv}[mta${idx}]`);
  }
  graph.push(`[${labelIn}]split[mtf${idx}][mtfa${idx}]`);
  graph.push(`[mtfa${idx}]alphaextract[mtae${idx}]`);
  graph.push(`[mtae${idx}][mta${idx}]blend=all_mode=multiply:shortest=1[mtab${idx}]`);
  graph.push(`[mtf${idx}][mtab${idx}]alphamerge[mtm${idx}]`);
  return `mtm${idx}`;
}

/**
 * ✂️ Chroma-él igazítás (matte choke/grow): a kulcsolt fg alfáján `erosion`
 * (edge<0 = perem megevése) vagy `dilation` (edge>0 = növelés) |edge|·4 menetben.
 * Visszaadja az új címkét, vagy a bemenetit, ha nincs edge.
 */
function edgeChain(clip, labelIn, idx, graph) {
  const e = clip.chromaKey && clip.chromaKey.edge;
  if (!e) {
    return labelIn;
  }
  const passes = Math.min(4, Math.max(1, Math.round(Math.abs(e) * 4)));
  const op = Array(passes).fill(e < 0 ? 'erosion' : 'dilation').join(',');
  graph.push(`[${labelIn}]split[egf${idx}][egfa${idx}]`);
  graph.push(`[egfa${idx}]alphaextract,${op}[ega${idx}]`);
  graph.push(`[egf${idx}][ega${idx}]alphamerge[egm${idx}]`);
  return `egm${idx}`;
}

function filterDrawbox(clip, W, H) {
  const f = FILTERS[clip.filterId];
  if (!f) {
    return '';
  }
  const op = f.opacity * (clip.filterIntensity ?? 1);
  return `,drawbox=x=0:y=0:w=${W}:h=${H}:color=0x${f.color}@${op.toFixed(3)}:t=fill`;
}

function fadeFilters(clip, visDur) {
  let s = '';
  const fi = clip.fadeInSec ?? 0;
  const fo = clip.fadeOutSec ?? 0;
  if (fi > 0) {
    s += `,fade=t=in:st=0:d=${Math.min(fi, visDur).toFixed(3)}`;
  }
  if (fo > 0) {
    const d = Math.min(fo, visDur);
    s += `,fade=t=out:st=${(visDur - d).toFixed(3)}:d=${d.toFixed(3)}`;
  }
  return s;
}

/**
 * A vizuális sáv felbontása nem átfedő szegmensekre (átfedésnél a későbbi
 * kezdetű klip győz), a lyukak fekete kitöltést kapnak.
 */
function visualSegments(project, total) {
  const clips = trackOf(project, 'video')
    .clips.slice()
    .sort((a, b) => a.start - b.start || clipEnd(a) - clipEnd(b));
  const segments = [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const next = clips[i + 1];
    const visStart = Math.max(clip.start, cursor);
    const visEnd = Math.min(clipEnd(clip), next ? next.start : Infinity);
    if (visEnd <= visStart) {
      continue; // teljesen takarásban
    }
    if (visStart > cursor) {
      segments.push({ kind: 'gap', duration: visStart - cursor });
    }
    segments.push({
      kind: clip.kind,
      clip,
      // a klip elejéből ennyit vágott le a takarás
      skip: visStart - clip.start,
      duration: visEnd - visStart,
    });
    cursor = visEnd;
  }
  if (cursor < total) {
    segments.push({ kind: 'gap', duration: total - cursor });
  }
  if (segments.length === 0) {
    segments.push({ kind: 'gap', duration: Math.max(total, 1) });
  }
  return segments;
}

/**
 * ffmpeg futtatása előrehaladás-jelentéssel: a -progress kimenet out_time_us
 * sora (mikroszekundum) osztva a teljes hosszal adja a 0-1 arányt.
 */
function runFfmpegWithProgress(args, totalSeconds, onProgress) {
  return new Promise((resolve, reject) => {
    // a -progress globális opció — a kimeneti fájl elé kell, különben az
    // ffmpeg második kimenetként értelmezné a pipe:1-et
    const child = spawn('ffmpeg', ['-progress', 'pipe:1', '-nostats', ...args], {
      timeout: 10 * 60 * 1000,
    });
    let stderrTail = '';
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/) ?? line.match(/^out_time_ms=(\d+)/);
        if (m && totalSeconds > 0 && onProgress) {
          const seconds = parseInt(m[1], 10) / 1e6;
          onProgress(Math.max(0, Math.min(1, seconds / totalSeconds)));
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    child.on('error', (err) => reject(new Error(`ffmpeg hiba: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg hiba: ${stderrTail}`));
      }
    });
  });
}

/**
 * @param project a vided projekt (az uri-k már helyi fájlutak)
 * @param workDir munkakönyvtár
 * @param onProgress opcionális 0-1 előrehaladás-visszahívás
 * @returns az elkészült mp4 útvonala
 */
/**
 * 🧱 Compound / pre-compose feloldása: a `comp`-ot hordozó video-klipeket a
 * beágyazott al-idővonalukból REKURZÍVAN MP4-be rendereli, és a klip uri-ját a
 * kész fájlra cseréli (a `comp`-ot törli) → onnantól sima videó-klip. Így a fő
 * render változatlan úton kompozitál. A rekurzió a levél-kompozícióknál megáll.
 */
async function resolveCompounds(project, workDir, settings) {
  let idx = 0;
  const tracks = [];
  for (const tk of project.tracks) {
    const clips = [];
    for (const c of tk.clips) {
      if (c.kind === 'video' && c.comp && Array.isArray(c.comp.tracks) && c.comp.tracks.length > 0) {
        const sub = {
          id: `${c.id}-comp`,
          name: 'comp',
          aspectRatio: c.comp.aspectRatio || project.aspectRatio,
          tracks: c.comp.tracks,
          assets: c.comp.assets || [],
          createdAt: '',
          updatedAt: '',
          schemaVersion: project.schemaVersion,
        };
        const subDir = path.join(workDir, `comp_${idx++}`);
        try {
          fs.mkdirSync(subDir, { recursive: true });
          await renderProject(sub, subDir, () => {}, settings); // ← rekurzió
          const mp4 = path.join(subDir, 'out.mp4');
          const dur = projectDuration(sub);
          clips.push({ ...c, uri: mp4, comp: undefined, trimIn: c.trimIn ?? 0, sourceDuration: dur, speed: c.speed ?? 1 });
          continue;
        } catch (err) {
          console.warn('pre-compose render kihagyva:', err.message); // → a nyers uri marad
        }
      }
      clips.push(c);
    }
    tracks.push({ ...tk, clips });
  }
  return { ...project, tracks };
}

async function renderProject(project, workDir, onProgress, settings = {}) {
  // export-beállítások (P0-design): felbontás/fps/minőség a kliens Export
  // paneljéről — a FPS a modul-konstans árnyékolásával jut el minden lánchoz
  const shortSide = Math.min(2160, Math.max(480, parseInt(settings.resolution, 10) || 1080));
  const FPS = [24, 30, 60].includes(parseInt(settings.fps, 10))
    ? parseInt(settings.fps, 10)
    : 30;
  const CRF = { low: 28, medium: 23, high: 19 }[settings.quality] ?? 20;
  const base = CANVAS[project.aspectRatio] ?? CANVAS['9:16'];
  const scale = shortSide / Math.min(base.w, base.h);
  const even = (v) => Math.round((v * scale) / 2) * 2;
  const canvas = { w: even(base.w), h: even(base.h) };
  const { w: W, h: H } = canvas;
  // 🧱 compound clip / pre-compose: a beágyazott kompozíciók rekurzív renderje MP4-be
  project = await resolveCompounds(project, workDir, settings);
  const total = projectDuration(project);
  if (total <= 0) {
    throw new Error('Üres projekt — nincs mit renderelni.');
  }

  const segments = visualSegments(project, total);
  // szöveg-jellegű rétegek: címek + feliratok + matricák (v3), legacy: text
  const textClips = clipsOfTypes(project, ['text', 'captions', 'overlay'])
    .filter((c) => c.kind === 'text')
    .sort((a, b) => a.start - b.start);
  const shapeClips = clipsOfTypes(project, ['overlay'])
    .filter((c) => c.kind === 'shape')
    .sort((a, b) => a.start - b.start);
  const audioClips = clipsOfTypes(project, ['music', 'voiceover', 'sfx', 'audio']).filter(
    (c) => c.kind === 'audio'
  );

  // feliratok + formák rasterizálása (közös Chromium-útvonal); a formák a
  // szöveg-overlay lánccal kompatibilis bejegyzésekként kerülnek a sorba —
  // a formák ELŐBB, hogy a szöveg rájuk kerülhessen
  let texts = [];
  try {
    const shapes = await renderShapePngs(shapeClips, canvas, workDir);
    const labels = await renderTextPngs(textClips, canvas, workDir);
    texts = [...shapes, ...labels];
  } catch (err) {
    // felirat nélkül is leszállítjuk a videót, de jelezzük
    console.warn('Felirat-rasterizálás kihagyva:', err.message);
  }

  const inputs = [];
  const inputIndex = new Map(); // kulcs: `${file}|még loop-e` → index

  const addInput = (args, key) => {
    if (key && inputIndex.has(key)) {
      return inputIndex.get(key);
    }
    const idx = inputs.length;
    inputs.push(args);
    if (key) {
      inputIndex.set(key, idx);
    }
    return idx;
  };

  const graph = [];
  const segLabels = [];

  const hasTilt = (clip) =>
    Boolean(
      clip.tilt3d && ((clip.tilt3d.rotX ?? 0) !== 0 || (clip.tilt3d.rotY ?? 0) !== 0)
    );

  const hasTransform = (clip) =>
    (clip.transform &&
      (clip.transform.scale !== 1 ||
        clip.transform.x !== 0 ||
        clip.transform.y !== 0 ||
        (clip.transform.rotation ?? 0) !== 0)) ||
    (clip.opacity ?? 1) < 1 ||
    hasTilt(clip);

  /** a döntött kép túlnyúlhat az eredeti kereten — ekkora átlátszó margót kap */
  const TILT_PAD = 1.3;

  /**
   * Térbeli döntés (🧊 3D V1): a kliens-előnézet CSS-konvenciójával megegyező
   * perspektivikus warp. A forrás átlátszó margót kap (a kereten kívülre
   * vetülő sarkok ne csorbuljanak, a négyszögön kívül alfa=0 maradjon), majd a
   * perspective szűrő sense=destination módban a NÉGY VETÍTETT SAROKRA képezi
   * a képet. A sarkok W/H-kifejezések (a fit-méret előre nem ismert); a
   * fókusztáv (W+H)*0.75 ≈ 1.2·max(W,H) — vesszőtlen kifejezés, mert a
   * filtergraphban a vessző szűrőhatár.
   */
  const tiltChain = (clip) => {
    if (!hasTilt(clip)) {
      return '';
    }
    const rad = (deg) => (Math.max(-45, Math.min(45, deg)) * Math.PI) / 180;
    const rx = rad(clip.tilt3d.rotX ?? 0);
    const ry = rad(clip.tilt3d.rotY ?? 0);
    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);
    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    const n = (v) => v.toFixed(6);
    const F = `(W+H)*0.75`;
    // CSS-sorrend: rotateY, majd rotateX; nézőpont +z-n, k = F/(F−z)
    const corner = (u, v) => {
      const g = 2 * TILT_PAD; // a tartalom fél-mérete a paddelt keretben: W/g, H/g
      const xw = (u * cosY) / g;
      const yw = (u * sinY * sinX) / g;
      const yh = (v * cosX) / g;
      const zw = (-u * sinY * cosX) / g;
      const zh = (v * sinX) / g;
      const K = `${F}/(${F}-(W*${n(zw)}+H*${n(zh)}))`;
      return {
        x: `W/2+W*${n(xw)}*${K}`,
        y: `H/2+(W*${n(yw)}+H*${n(yh)})*${K}`,
      };
    };
    const tl = corner(-1, -1);
    const tr = corner(1, -1);
    const bl = corner(-1, 1);
    const br = corner(1, 1);
    return (
      `,format=yuva444p,` +
      `pad=trunc(iw*${TILT_PAD}/2)*2:trunc(ih*${TILT_PAD}/2)*2:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,` +
      `perspective=x0='${tl.x}':y0='${tl.y}':x1='${tr.x}':y1='${tr.y}':` +
      `x2='${bl.x}':y2='${bl.y}':x3='${br.x}':y3='${br.y}':sense=destination,` +
      `format=rgba`
    );
  };

  /** green screen (P0-10): a kulcs-szín átlátszóvá válik + opcionális spill-suppression */
  const chromaChain = (clip) => {
    const c = clip.chromaKey;
    if (!c) {
      return '';
    }
    const hex = String(c.color || '#00ff00').replace('#', '');
    const color = '0x' + hex;
    const sim = Math.min(0.45, Math.max(0.02, c.similarity ?? 0.18));
    const blend = Math.min(0.3, Math.max(0, c.blend ?? 0.05));
    let s = `,chromakey=color=${color}:similarity=${sim.toFixed(3)}:blend=${blend.toFixed(3)}`;
    // 🟢 spill-suppression: a kulcs-szín visszaverődésének (zöld/kék perem)
    // eltávolítása a témáról — az ffmpeg `despill` szűrőjével, a kulcs-szín
    // domináns csatornájából kikövetkeztetett típussal (green/blue)
    if (c.spill) {
      const r = parseInt(hex.slice(0, 2) || '0', 16);
      const g = parseInt(hex.slice(2, 4) || '0', 16);
      const b = parseInt(hex.slice(4, 6) || '0', 16);
      const type = b > g && b >= r ? 'blue' : 'green';
      const mix = Math.min(1, Math.max(0.1, typeof c.spill === 'number' ? c.spill : 0.5));
      s += `,despill=type=${type}:mix=${mix.toFixed(2)}:expand=${(mix * 0.4).toFixed(2)}`;
    }
    return s;
  };

  /**
   * Maszk (P0-10): a lágy szélű forma EGYETLEN szürke kockán készül el (a geq
   * per-pixel kiértékelése drága — képkockánként futtatva percekig tartana),
   * majd loop-olva az fg alfájával szorzódik össze (chroma-val kombinálható).
   */
  // háromszög-legyező poligon-teszt token-koordinátákból (szám VAGY T-kifejezés)
  const polyWExpr = (ptsX, ptsY, apexX, apexY) => {
    const K = ptsX.length;
    const tri = [];
    for (let k = 0; k < K; k++) {
      const ax = ptsX[k];
      const ay = ptsY[k];
      const bx = ptsX[(k + 1) % K];
      const by = ptsY[(k + 1) % K];
      const s1 = `((${bx}-${ax})*(Y-${ay})-(${by}-${ay})*(X-${ax}))`;
      const s2e = `((${apexX}-${bx})*(Y-${by})-(${apexY}-${by})*(X-${bx}))`;
      const s3 = `((${ax}-${apexX})*(Y-${apexY})-(${ay}-${apexY})*(X-${apexX}))`;
      tri.push(`(gte(${s1},0)*gte(${s2e},0)*gte(${s3},0)+lte(${s1},0)*lte(${s2e},0)*lte(${s3},0))`);
    }
    return `min(${tri.join('+')},1)`;
  };

  // statikus poligon (a legyező-súlyponttal) — a NEM-animált út és az animált
  // fallback közös építője; a `toFixed(1)` rögzíti a régi kimenetet (paritás)
  const staticPoly = (points, expand) => {
    let pts = points.map((p) => ({ x: p.x * W, y: p.y * H }));
    const cxP = pts.reduce((s2, p) => s2 + p.x, 0) / pts.length;
    const cyP = pts.reduce((s2, p) => s2 + p.y, 0) / pts.length;
    if (expand !== 0) {
      pts = pts.map((p) => ({ x: cxP + (p.x - cxP) * (1 + expand), y: cyP + (p.y - cyP) * (1 + expand) }));
    }
    const n = (v) => Number(v).toFixed(1);
    return polyWExpr(pts.map((p) => n(p.x)), pts.map((p) => n(p.y)), n(cxP), n(cyP));
  };

  /**
   * Maszk (P0-10 + 🎬 rotoszkóp): a lágy szélű forma szürke maszk-kockán készül.
   * NEM animált (nincs `track`): EGYETLEN kocka + loop (olcsó — a régi út bitre
   * változatlan). Animált (`track`): a geometria klip-lokális kulcskockákból
   * interpolálva, PER-FRAME geq (loop nélkül) — a `skip` a szegmens klipbeli
   * kezdete (geq idő-változó `T`, klip-idő = T + skip). Ellipszis/téglalap
   * teljes per-frame; poligon per-vertex ha a pontszám állandó és ≤16, különben
   * a klip közepéhez legközelebbi keret statikus alakja (dokumentált korlát).
   */
  const withMask = (i, fgLabel, mask, dur, skip = 0, maskInputIdx = null) => {
    if (!mask) {
      return fgLabel;
    }
    // 🎬 kész szürke maszk-videó (worker-rasterizer, tetszőleges pontszám +
    // feather-animáció): csak az fg-alfa szorzása kell, geq nélkül
    if (maskInputIdx != null) {
      graph.push(`[${maskInputIdx}:v]scale=${W}:${H},format=gray[mimg${i}]`);
      graph.push(`[${fgLabel}]split[mf${i}][mfa${i}]`);
      graph.push(`[mfa${i}]alphaextract[mae${i}]`);
      graph.push(`[mae${i}][mimg${i}]blend=all_mode=multiply:shortest=1[mab${i}]`);
      graph.push(`[mf${i}][mab${i}]alphamerge[mfg${i}]`);
      return `mfg${i}`;
    }
    const track =
      Array.isArray(mask.track) && mask.track.length > 0
        ? [...mask.track].sort((a, b) => a.time - b.time)
        : null;
    const fNum = Math.min(0.3, Math.max(mask.feather ?? 0.05, 0.005));
    const ENum = Math.max(-0.5, Math.min(0.5, mask.expand ?? 0));

    // interpolált skalár-mező if-lánca a T időre (a kliens maskAnim.ts lineáris görbéjével azonos)
    const T = `(T+${skip.toFixed(3)})`;
    const px5 = (v) => Number(v).toFixed(5);
    const scalarExpr = (getter, fb) => {
      const fr = track.map((f) => ({ t: f.time, v: getter(f) ?? fb }));
      let expr = px5(fr[fr.length - 1].v);
      for (let k = fr.length - 2; k >= 0; k--) {
        const a = fr[k];
        const b = fr[k + 1];
        const span = Math.max(b.t - a.t, 0.001);
        const P = `min(max((${T}-${px5(a.t)})/${px5(span)},0),1)`;
        expr = `if(lt(${T},${px5(b.t)}),(${px5(a.v)}+${px5(b.v - a.v)}*${P}),${expr})`;
      }
      return `if(lt(${T},${px5(fr[0].t)}),${px5(fr[0].v)},${expr})`;
    };

    // ellipszis/téglalap közös tokenjei (szám vagy T-kifejezés)
    const cx = track ? `(${scalarExpr((f) => f.x, mask.x)})*${W}` : (mask.x * W).toFixed(1);
    const cy = track ? `(${scalarExpr((f) => f.y, mask.y)})*${H}` : (mask.y * H).toFixed(1);
    const rw = track
      ? `(${scalarExpr((f) => f.w, mask.w)})*${(W / 2).toFixed(3)}`
      : ((Math.max(mask.w, 0.02) * W) / 2).toFixed(1);
    const rh = track
      ? `(${scalarExpr((f) => f.h, mask.h)})*${(H / 2).toFixed(3)}`
      : ((Math.max(mask.h, 0.02) * H) / 2).toFixed(1);
    const fDiv = track ? `max(0.005,(${scalarExpr((f) => f.feather, mask.feather ?? 0.05)}))` : fNum.toFixed(3);
    const oneMinE = track ? `(1+(${scalarExpr((f) => f.expand, mask.expand ?? 0)}))` : (1 + ENum).toFixed(3);

    // perFrame = a wExpr ténylegesen T-függő (a loop-ot ilyenkor elhagyjuk)
    let perFrame = false;
    let wExpr;
    if (mask.shape === 'polygon' && Array.isArray(mask.points) && mask.points.length >= 3) {
      if (track) {
        const baseCount = track[0].points?.length ?? 0;
        const canMorph =
          baseCount >= 3 &&
          baseCount <= 16 &&
          track.every((f) => Array.isArray(f.points) && f.points.length === baseCount);
        if (canMorph) {
          perFrame = true;
          const apexX = (mask.x * W).toFixed(1); // állandó legyező-apex (kis kifejezés)
          const apexY = (mask.y * H).toFixed(1);
          const vExpr = (k, axis) => scalarExpr((f) => f.points[k][axis], axis === 'x' ? mask.x : mask.y);
          const ptsX = Array.from({ length: baseCount }, (_, k) => `(${vExpr(k, 'x')})*${W}`);
          const ptsY = Array.from({ length: baseCount }, (_, k) => `(${vExpr(k, 'y')})*${H}`);
          wExpr = polyWExpr(ptsX, ptsY, apexX, apexY);
        } else {
          // fallback: a klip közepéhez legközelebbi keret statikus alakja
          const mid = dur / 2;
          const rep = track.reduce((best, f) =>
            Math.abs(f.time - mid) < Math.abs(best.time - mid) ? f : best
          );
          wExpr = staticPoly(rep.points ?? mask.points, rep.expand ?? ENum);
        }
      } else {
        wExpr = staticPoly(mask.points, ENum);
      }
    } else if (mask.shape === 'ellipse') {
      perFrame = !!track;
      const d = `sqrt(pow((X-${cx})/(${rw}),2)+pow((Y-${cy})/(${rh}),2))`;
      wExpr = `min(max((${oneMinE}-${d})/${fDiv},0),1)`;
    } else {
      perFrame = !!track;
      const fpx = track
        ? `max(2,(${scalarExpr((f) => f.feather, mask.feather ?? 0.05)})*${H})`
        : Math.max(2, fNum * H).toFixed(1);
      const off = track ? `(${scalarExpr((f) => f.expand, mask.expand ?? 0)})*${H}` : (ENum * H).toFixed(1);
      const dEdge =
        `min(min(X-((${cx})-(${rw})),((${cx})+(${rw}))-X),` +
        `min(Y-((${cy})-(${rh})),((${cy})+(${rh}))-Y))`;
      wExpr = `min(max((${dEdge}+${off})/${fpx},0),1)`;
    }
    if (mask.invert) {
      wExpr = `(1-${wExpr})`;
    }
    // 🌓 maszk-átlátszóság: a kimaszkolt terület megtartott láthatósága (alfa-padló)
    const mo = Math.max(0, Math.min(1, mask.opacity ?? 0));
    if (mo > 0) {
      wExpr = `(${mo.toFixed(3)}+${(1 - mo).toFixed(3)}*(${wExpr}))`;
    }
    if (perFrame) {
      // per-frame: a szürke maszk a teljes hosszon renderel (geq minden kockán újraértékel)
      graph.push(
        `color=white:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=gray,geq=lum='255*${wExpr}'[mimg${i}]`
      );
    } else {
      const frames = Math.ceil(dur * FPS) + 2;
      graph.push(
        `color=white:s=${W}x${H}:r=${FPS}:d=${(2 / FPS).toFixed(4)},format=gray,` +
          `geq=lum='255*${wExpr}',loop=loop=${frames}:size=1:start=0[mimg${i}]`
      );
    }
    graph.push(`[${fgLabel}]split[mf${i}][mfa${i}]`);
    graph.push(`[mfa${i}]alphaextract[mae${i}]`);
    graph.push(`[mae${i}][mimg${i}]blend=all_mode=multiply:shortest=1[mab${i}]`);
    graph.push(`[mf${i}][mab${i}]alphamerge[mfg${i}]`);
    return `mfg${i}`;
  };

  /**
   * forgatás + átlátszóság lánc az overlay-útvonal forrására (rgba-ban).
   * `skip` = a szegmens kezdete a klipen belül (mp) — a kulcskocka-idő
   * klip-lokális, a szűrő-idő szegmens-lokális, ezért T = szűrő-idő + skip.
   *
   * Kulcskockás forgatás/átlátszóság esetén PER-FRAME (a kliens
   * src/lib/keyframes.ts görbéivel megegyező kifejezés); a kimeret ilyenkor =
   * bemeret (nincs pad/overlay-ütközés a withKeyframeMotionnel). Kulcskocka
   * nélkül a régi statikus út fut — a meglévő renderek bitre változatlanok.
   */
  const appearanceChain = (clip, skip = 0) => {
    let s = chromaChain(clip) + ',format=rgba';
    const k = clip.keyframes ?? {};
    if (k.rotation && k.rotation.length > 0) {
      // rotate: a `t` a szűrő (szegmens-lokális) ideje → klip-idő = t + skip
      const T = `(t+${skip.toFixed(3)})`;
      const degExpr = kfChannelExpr(k.rotation, clip.transform?.rotation ?? 0, T);
      s += `,rotate=a='(${degExpr})*PI/180':c=black@0`;
    } else {
      const rotation = clip.transform?.rotation ?? 0;
      if (rotation !== 0) {
        const rad = ((rotation % 360) * Math.PI) / 180;
        s += `,rotate=${rad.toFixed(5)}:ow=rotw(${rad.toFixed(5)}):oh=roth(${rad.toFixed(5)}):c=black@0`;
      }
    }
    if (k.opacity && k.opacity.length > 0) {
      // geq per-frame alfa: a geq idő-változója `T` (nagybetű) → klip-idő = T + skip
      const Tg = `(T+${skip.toFixed(3)})`;
      const opExpr = kfChannelExpr(k.opacity, clip.opacity ?? 1, Tg);
      s += `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='clip((${opExpr}),0,1)*alpha(X,Y)'`;
    } else {
      const opacity = clip.opacity ?? 1;
      if (opacity < 1) {
        s += `,colorchannelmixer=aa=${opacity.toFixed(3)}`;
      }
    }
    return s;
  };

  /** elmosott, sötétített cover-változat háttérnek (blur-kitöltés) */
  const blurBackgroundChain =
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    `gblur=sigma=28,eq=brightness=-0.06,format=yuv420p,setsar=1`;

  // --- Kulcskockák (P0-5): a kliens src/lib/keyframes.ts görbéivel megegyező
  // ffmpeg-időkifejezések. P = klippelt progressz, easing az induló kulcskockáé.
  const easedProgress = (P, easing) => {
    switch (easing) {
      case 'easeIn':
        return `pow(${P},2)`;
      case 'easeOut':
        return `(1-pow(1-${P},2))`;
      case 'easeInOut':
        return `(${P}*${P}*(3-2*${P}))`;
      default:
        return P;
    }
  };

  // 🎞️ Köbös-Bézier easing (a kliens src/lib/keyframes.ts bezierEase-ével AZONOS
  // felezéses megoldás) — az FFmpeg nem tud zárt alakban Bézier-időt visszafejteni,
  // ezért a bezier-szegmenst finom LINEÁRIS al-kulcskockákra „sütjük", és a
  // kész if-lánc ugyanazt a görbét reprodukálja (preview↔render paritás).
  const bezierEaseNode = (cp, p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const [x1, y1, x2, y2] = cp;
    const bx = (u) => { const v = 1 - u; return 3 * v * v * u * x1 + 3 * v * u * u * x2 + u * u * u; };
    const by = (u) => { const v = 1 - u; return 3 * v * v * u * y1 + 3 * v * u * u * y2 + u * u * u; };
    let lo = 0, hi = 1, u = p;
    for (let i = 0; i < 24; i++) {
      u = (lo + hi) / 2;
      const x = bx(u);
      if (Math.abs(x - p) < 1e-5) break;
      if (x < p) lo = u; else hi = u;
    }
    return by(u);
  };
  const BEZIER_STEPS = 16;
  const expandBezier = (kfs) => {
    if (!kfs || kfs.length < 2 || !kfs.some((k) => k.easing === 'bezier' && Array.isArray(k.bezier))) {
      return kfs;
    }
    const out = [];
    for (let i = 0; i < kfs.length; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (b && a.easing === 'bezier' && Array.isArray(a.bezier)) {
        // a szegmens kezdő-pontja + BEZIER_STEPS-1 köztes lineáris al-pont
        out.push({ time: a.time, value: a.value, easing: 'linear' });
        for (let s = 1; s < BEZIER_STEPS; s++) {
          const p = s / BEZIER_STEPS;
          out.push({
            time: a.time + p * (b.time - a.time),
            value: a.value + (b.value - a.value) * bezierEaseNode(a.bezier, p),
            easing: 'linear',
          });
        }
      } else {
        out.push(a);
      }
    }
    return out;
  };

  /** kulcskocka-csatorna → darabonkénti if-lánc a T időkifejezésre */
  const kfChannelExpr = (rawKfs, fallback, T) => {
    const kfs = expandBezier(rawKfs); // bezier → finom lineáris LUT (paritás)
    if (!kfs || kfs.length === 0) {
      return Number(fallback).toFixed(5);
    }
    const n = (v) => Number(v).toFixed(5);
    let expr = n(kfs[kfs.length - 1].value); // utolsó után tartva
    for (let i = kfs.length - 2; i >= 0; i--) {
      const a = kfs[i];
      const b = kfs[i + 1];
      const span = Math.max(b.time - a.time, 0.001);
      const P = `min(max((${T}-${n(a.time)})/${n(span)},0),1)`;
      const seg = `(${n(a.value)}+${n(b.value - a.value)}*${easedProgress(P, a.easing)})`;
      expr = `if(lt(${T},${n(b.time)}),${seg},${expr})`;
    }
    return `if(lt(${T},${n(kfs[0].time)}),${n(kfs[0].value)},${expr})`; // első előtt tartva
  };

  const hasKf = (clip) => {
    const k = clip.keyframes;
    // a forgatás/átlátszóság kulcskocka is ide sorolja a klipet, hogy az
    // appearanceChain per-frame úton fusson (a motion scale/pan no-op marad)
    return Boolean(
      k &&
        ['scale', 'x', 'y', 'rotation', 'opacity'].some(
          (c) => Array.isArray(k[c]) && k[c].length > 0
        )
    );
  };

  /**
   * Animált zoom/pan lánc: a fit-méretű (rgba) forrás per-frame skálázást kap,
   * fix méretű átlátszó padbe kerül (a változó frame-méret overlay-be nem
   * mehet — lásd a pop-animáció tanulságait), majd az alapra overlay-eződik
   * t-függő x/y kifejezéssel. T = t + skip (a szegmens a klip belsejében is
   * kezdődhet takarás miatt).
   */
  const withKeyframeMotion = (i, fitLabel, clip, seg, suffix, baseLabel, dur) => {
    const T = `(t+${seg.skip.toFixed(3)})`;
    const k = clip.keyframes ?? {};
    const base = clip.transform ?? { scale: 1, x: 0, y: 0 };
    const maxScale = Math.min(
      Math.max(base.scale ?? 1, ...(k.scale ?? []).map((kf) => kf.value), 1),
      4
    );
    const tiltGrow = hasTilt(clip) ? TILT_PAD : 1;
    const padW = Math.ceil((W * maxScale * tiltGrow) / 2) * 2 + 2;
    const padH = Math.ceil((H * maxScale * tiltGrow) / 2) * 2 + 2;
    const S = kfChannelExpr(k.scale, base.scale ?? 1, T);
    const OX = `(${kfChannelExpr(k.x, base.x ?? 0, T)})*${W}`;
    const OY = `(${kfChannelExpr(k.y, base.y ?? 0, T)})*${H}`;
    let baseIn = baseLabel;
    if (!baseIn) {
      baseIn = `kbase${i}`;
      graph.push(
        `color=black:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuv420p,setsar=1[${baseIn}]`
      );
    }
    graph.push(
      `[${fitLabel}]scale=w='max(2,trunc(iw*${S}))':h='max(2,trunc(ih*${S}))':eval=frame,` +
        `pad=${padW}:${padH}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame,format=rgba[kfg${i}]`
    );
    graph.push(
      `[${baseIn}][kfg${i}]overlay=x='(${W}-w)/2+${OX}':y='(${H}-h)/2+${OY}':shortest=0` +
        suffix +
        `[seg${i}]`
    );
  };

  /**
   * 🏔️ 2.5D parallax (🧊 3D V1): a fotó worker-oldalon készült fg/mid/bg
   * rétegei EGY kameramozgást kapnak eltérő erővel (bg 0,35× · mid 0,7× ·
   * fg 1×) — a mélység illúzióját a rétegek egymáshoz képesti elmozdulása
   * adja. A bg kis extra zoomot kap, hogy a mozgásnál ne lásson ki a széle.
   * A rétegek cover-fitben pontosan fedik egymást (mint a lapos fotó), a
   * mozgás a kulcskocka-motor t-kifejezéseivel megy. Visszatérés: sikerült-e
   * (ha a rétegek hiányoznak, a hívó lapos fotóként rendereli).
   */
  const withDepthParallax = (i, clip, seg, suffix, label) => {
    const dp = clip.depthParallax;
    const dir = depthLayerDir(dp.id);
    const names = ['bg', 'mid', 'fg'];
    if (!names.every((n) => fs.existsSync(path.join(dir, `${n}.png`)))) {
      return false;
    }
    const strength = Math.min(1.5, Math.max(0.3, dp.strength ?? 1));
    const T = `(t+${seg.skip.toFixed(3)})`;
    const hasMotion = hasKf(clip);
    // kameramozgás nélkül is éljen a mélység: lágy push-in + oldalpan az alap
    const base = hasMotion
      ? clip.keyframes
      : {
          scale: [
            { time: 0, value: 1.04, easing: 'easeInOut' },
            { time: clip.duration, value: 1.16, easing: 'easeInOut' },
          ],
          x: [
            { time: 0, value: 0.03, easing: 'easeInOut' },
            { time: clip.duration, value: -0.03, easing: 'easeInOut' },
          ],
        };
    // csatorna gyengítése a semleges felé + szorzó (bg extra zoom)
    const damp = (kfs, neutral, f, mul = 1) =>
      (kfs ?? []).map((kf) => ({
        ...kf,
        value: (neutral + (kf.value - neutral) * f) * mul,
      }));
    const layerSpecs = [
      { name: 'bg', f: 0.35 * strength, zoom: 1.09 },
      { name: 'mid', f: 0.7 * strength, zoom: 1 },
      { name: 'fg', f: 1.0 * strength, zoom: 1 },
    ];
    let acc = `dpbase${i}`;
    graph.push(
      `color=black:s=${W}x${H}:r=${FPS}:d=${seg.duration.toFixed(3)},format=yuv420p,setsar=1[${acc}]`
    );
    layerSpecs.forEach((spec, li) => {
      const idx = addInput([
        '-loop', '1',
        '-t', seg.duration.toFixed(3),
        '-i', path.join(dir, `${spec.name}.png`),
      ]);
      const scaleKfs = damp(base.scale, 1, spec.f, spec.zoom);
      const xKfs = damp(base.x, 0, spec.f);
      const yKfs = damp(base.y, 0, spec.f);
      const maxScale = Math.min(
        Math.max(spec.zoom, ...scaleKfs.map((kf) => kf.value), 1),
        4
      );
      const padW = Math.ceil((W * maxScale) / 2) * 2 + 2;
      const padH = Math.ceil((H * maxScale) / 2) * 2 + 2;
      const S = kfChannelExpr(scaleKfs, spec.zoom, T);
      const OX = `(${kfChannelExpr(xKfs, 0, T)})*${W}`;
      const OY = `(${kfChannelExpr(yKfs, 0, T)})*${H}`;
      graph.push(
        `[${idx}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H},setsar=1,format=rgba,` +
          `scale=w='max(2,trunc(iw*${S}))':h='max(2,trunc(ih*${S}))':eval=frame,` +
          `pad=${padW}:${padH}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame,format=rgba[dpl${i}_${li}]`
      );
      const last = li === layerSpecs.length - 1;
      const out = last ? label : `dpacc${i}_${li}`;
      graph.push(
        `[${acc}][dpl${i}_${li}]overlay=x='(${W}-w)/2+${OX}':y='(${H}-h)/2+${OY}':shortest=0` +
          (last ? suffix : '') +
          `[${out}]`
      );
      acc = out;
    });
    return true;
  };

  /**
   * A transzformált klip az alapjára kerül overlay-jel: a méretezés után a
   * középponthoz képest x·W / y·H eltolással — az app előnézetével megegyező
   * módon. Az alap fekete, vagy blur-kitöltésnél a klip elmosott cover-je
   * (baseLabel).
   */
  const withTransform = (i, srcLabel, clip, dur, suffix, baseLabel) => {
    const t = clip.transform;
    const ox = Math.round((t?.x ?? 0) * W);
    const oy = Math.round((t?.y ?? 0) * H);
    let base = baseLabel;
    if (!base) {
      base = `tbase${i}`;
      graph.push(
        `color=black:s=${W}x${H}:r=${FPS}:d=${dur.toFixed(3)},format=yuv420p,setsar=1[${base}]`
      );
    }
    const out = `seg${i}`;
    graph.push(
      `[${base}][${srcLabel}]overlay=x=(${W}-w)/2+${ox}:y=(${H}-h)/2+${oy}:shortest=0` +
        suffix +
        `[${out}]`
    );
    return out;
  };

  // 🎬 ANIMÁLT MASZK pre-pass (async, a szinkron forEach ELŐTT): a track-kel bíró
  // maszkokhoz per-frame szürke PNG-képsort gyártunk (worker-rasterizer) — ez
  // oldja fel a ≤16 csúcsú per-frame geq korlátot (tetszőleges pontszám +
  // feather-animáció). Chromium/hiba esetén NEM állítunk indexet → a withMask a
  // geq-útra esik vissza (a statikus maszkok érintetlenek).
  const maskSeqIdx = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const c = seg.clip;
    if (
      (seg.kind === 'video' || seg.kind === 'image') &&
      c &&
      c.mask &&
      Array.isArray(c.mask.track) &&
      c.mask.track.length > 0
    ) {
      try {
        const { renderMaskSequence } = require('./mask-render');
        const dir = path.join(workDir, `mask_${i}`);
        fs.mkdirSync(dir, { recursive: true });
        const seqM = await renderMaskSequence(
          c.mask,
          { skip: seg.skip, duration: seg.duration, fps: FPS, W, H },
          dir
        );
        if (seqM) {
          maskSeqIdx[i] = addInput(['-framerate', String(FPS), '-i', seqM.pattern]);
        }
      } catch (err) {
        console.warn('mask-render kihagyva:', err.message); // → geq fallback
      }
    }
  }

  segments.forEach((seg, i) => {
    const label = `seg${i}`;
    if (seg.kind === 'gap') {
      graph.push(
        `color=black:s=${W}x${H}:r=${FPS}:d=${seg.duration.toFixed(3)},format=yuv420p,setsar=1[${label}]`
      );
    } else if (seg.kind === 'video') {
      const clip = seg.clip;
      const idx = addInput(['-i', clip.uri], `v|${clip.uri}`);
      const srcStart = clip.trimIn + seg.skip * clip.speed;
      const srcEnd = srcStart + seg.duration * clip.speed;
      const decode =
        `[${idx}:v]trim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},` +
        `setpts=(PTS-STARTPTS)/${clip.speed},` +
        motionChain(clip, seg.duration);
      // AI Select esetén az adjust NEM a teljes képre megy — a maszkolt
      // lépés adja hozzá a szegmens végén
      const suffix = (clip.selective ? '' : adjustChain(clip)) + lightingChain(clip) + filterDrawbox(clip, W, H) + fadeFilters(clip, seg.duration);
      const blur = clip.backgroundFill === 'blur';
      if (hasKf(clip)) {
        // animált zoom/pan: fit (contain) méretű rgba forrás → keyframe-lánc
        const fit =
          `scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1` +
          appearanceChain(clip, seg.skip) +
          tiltChain(clip);
        let baseLabel;
        if (blur) {
          graph.push(`${decode}split[kA${i}][kB${i}]`);
          graph.push(`[kB${i}]${blurBackgroundChain}[kblur${i}]`);
          graph.push(`[kA${i}]${fit}[kfit${i}]`);
          baseLabel = `kblur${i}`;
        } else {
          graph.push(decode + fit + `[kfit${i}]`);
        }
        withKeyframeMotion(i, `kfit${i}`, clip, seg, suffix, baseLabel, seg.duration);
      } else if (hasTransform(clip)) {
        const s = clip.transform?.scale ?? 1;
        const boxW = Math.round((W * s) / 2) * 2;
        const boxH = Math.round((H * s) / 2) * 2;
        const src = `tsrc${i}`;
        const fgScale =
          `scale=${boxW}:${boxH}:force_original_aspect_ratio=decrease,` +
          `crop=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1` +
          appearanceChain(clip, seg.skip) +
          tiltChain(clip);
        let baseLabel;
        if (blur) {
          graph.push(`${decode}split[preA${i}][preB${i}]`);
          graph.push(`[preB${i}]${blurBackgroundChain}[tblur${i}]`);
          graph.push(`[preA${i}]${fgScale}[${src}]`);
          baseLabel = `tblur${i}`;
        } else {
          graph.push(decode + fgScale + `[${src}]`);
        }
        withTransform(i, src, clip, seg.duration, suffix, baseLabel);
      } else if (blur || clip.chromaKey || clip.mask || clip.matte) {
        // composite-út: contain-fit fg (chroma + maszk alfa-formálással) az
        // alap fölé — az alap fekete vagy a klip elmosott cover-je
        const fgChain =
          `scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1` +
          chromaChain(clip) +
          `,format=rgba,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
        let baseLabel;
        if (blur) {
          graph.push(`${decode}split[bfA${i}][bfB${i}]`);
          graph.push(`[bfB${i}]${blurBackgroundChain}[bbg${i}]`);
          graph.push(`[bfA${i}]${fgChain}[bfg${i}]`);
          baseLabel = `bbg${i}`;
        } else {
          baseLabel = `cbase${i}`;
          graph.push(
            `color=black:s=${W}x${H}:r=${FPS}:d=${seg.duration.toFixed(3)},format=yuv420p,setsar=1[${baseLabel}]`
          );
          graph.push(decode + fgChain + `[bfg${i}]`);
        }
        const fgE = edgeChain(clip, `bfg${i}`, i, graph);
        const fgFinal = withMask(i, fgE, clip.mask, seg.duration, seg.skip, maskSeqIdx[i]);
        const fgM = matteChain(clip, W, H, fgFinal, i, graph, addInput, seg.duration);
        graph.push(
          `[${baseLabel}][${fgM}]overlay=x=0:y=0:shortest=0` + suffix + `[${label}]`
        );
      } else {
        graph.push(
          decode +
            `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
            `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1` +
            suffix +
            `[${label}]`
        );
      }
    } else {
      // kép: loop-olt input, cover-illesztés
      const clip = seg.clip;
      // AI Select esetén az adjust NEM a teljes képre megy — a maszkolt
      // lépés adja hozzá a szegmens végén
      const suffix = (clip.selective ? '' : adjustChain(clip)) + lightingChain(clip) + filterDrawbox(clip, W, H) + fadeFilters(clip, seg.duration);
      const blur = clip.backgroundFill === 'blur';
      // 🌫️ portré-blur: a forrás a worker fókusz-változatára cserélődik — így
      // minden további út (kulcskocka/transform/tilt/blur-háttér) változatlanul
      // működik rajta. A 🎬 fókusz-húzás külön kompozit (lásd lentebb).
      let srcUri = clip.uri;
      const focusDir = clip.depthFocus ? depthLayerDir(clip.depthFocus.id) : null;
      const focusNear = focusDir ? path.join(focusDir, 'focus-near.png') : null;
      const focusFar = focusDir ? path.join(focusDir, 'focus-far.png') : null;
      const focusReady =
        focusNear && fs.existsSync(focusNear) && fs.existsSync(focusFar);
      if (clip.depthFocus?.mode === 'portrait' && focusReady) {
        srcUri = focusNear;
      }
      if (clip.depthParallax && withDepthParallax(i, clip, seg, suffix, label)) {
        // 2.5D rétegek kompozitálva — a lapos utak kimaradnak
      } else if (
        focusReady &&
        (clip.depthFocus.mode === 'toFar' || clip.depthFocus.mode === 'toNear')
      ) {
        // fókusz-húzás: a két fókusz-állapot cover-fitben egymásra kerül, és a
        // felső réteg alfája a szegmens középső szakaszán úszik be — rack focus
        const toFar = clip.depthFocus.mode === 'toFar';
        const bottom = toFar ? focusNear : focusFar;
        const top = toFar ? focusFar : focusNear;
        const d = seg.duration;
        const fadeStart = Math.min(d * 0.25, 1);
        const fadeDur = Math.max(0.3, Math.min(d * 0.5, 2));
        const cover = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
        const idxA = addInput(['-loop', '1', '-t', d.toFixed(3), '-i', bottom]);
        const idxB = addInput(['-loop', '1', '-t', d.toFixed(3), '-i', top]);
        graph.push(`[${idxA}:v]fps=${FPS},${cover},format=yuv420p[fca${i}]`);
        graph.push(
          `[${idxB}:v]fps=${FPS},${cover},format=rgba,` +
            `fade=t=in:st=${fadeStart.toFixed(3)}:d=${fadeDur.toFixed(3)}:alpha=1[fcb${i}]`
        );
        graph.push(
          `[fca${i}][fcb${i}]overlay=x=0:y=0:shortest=0` + suffix + `[${label}]`
        );
      } else {
      const idx = addInput(['-loop', '1', '-t', seg.duration.toFixed(3), '-i', srcUri]);
      if (hasKf(clip)) {
        // animált zoom/pan képen: cover-illesztésű rgba forrás → keyframe-lánc
        const fit =
          `scale=${W}:${H}:force_original_aspect_ratio=increase,` +
          `crop=${W}:${H},setsar=1` +
          appearanceChain(clip, seg.skip) +
          tiltChain(clip);
        let baseLabel;
        if (blur) {
          graph.push(`[${idx}:v]fps=${FPS},split[kA${i}][kB${i}]`);
          graph.push(`[kB${i}]${blurBackgroundChain}[kblur${i}]`);
          graph.push(`[kA${i}]${fit}[kfit${i}]`);
          baseLabel = `kblur${i}`;
        } else {
          graph.push(`[${idx}:v]fps=${FPS},${fit}[kfit${i}]`);
        }
        withKeyframeMotion(i, `kfit${i}`, clip, seg, suffix, baseLabel, seg.duration);
      } else if (hasTransform(clip)) {
        const s = clip.transform?.scale ?? 1;
        const boxW = Math.round((W * s) / 2) * 2;
        const boxH = Math.round((H * s) / 2) * 2;
        const src = `tsrc${i}`;
        const fgScale =
          `scale=${boxW}:${boxH}:force_original_aspect_ratio=increase,` +
          `crop=${boxW}:${boxH},setsar=1` +
          appearanceChain(clip, seg.skip) +
          tiltChain(clip);
        let baseLabel;
        if (blur) {
          graph.push(`[${idx}:v]fps=${FPS},split[preA${i}][preB${i}]`);
          graph.push(`[preB${i}]${blurBackgroundChain}[tblur${i}]`);
          graph.push(`[preA${i}]${fgScale}[${src}]`);
          baseLabel = `tblur${i}`;
        } else {
          graph.push(`[${idx}:v]fps=${FPS},${fgScale}[${src}]`);
        }
        withTransform(i, src, clip, seg.duration, suffix, baseLabel);
      } else if (blur || clip.chromaKey || clip.mask || clip.matte) {
        // composite-út: blur-nál contain-fit, különben cover-fit fg; chroma +
        // maszk alfa-formálás, az alap fekete vagy az elmosott cover
        const fgChain = blur
          ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1` +
            chromaChain(clip) +
            `,format=rgba,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0`
          : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1` +
            chromaChain(clip) +
            `,format=rgba`;
        let baseLabel;
        if (blur) {
          graph.push(`[${idx}:v]fps=${FPS},split[bfA${i}][bfB${i}]`);
          graph.push(`[bfB${i}]${blurBackgroundChain}[bbg${i}]`);
          graph.push(`[bfA${i}]${fgChain}[bfg${i}]`);
          baseLabel = `bbg${i}`;
        } else {
          baseLabel = `cbase${i}`;
          graph.push(
            `color=black:s=${W}x${H}:r=${FPS}:d=${seg.duration.toFixed(3)},format=yuv420p,setsar=1[${baseLabel}]`
          );
          graph.push(`[${idx}:v]fps=${FPS},${fgChain}[bfg${i}]`);
        }
        const fgE = edgeChain(clip, `bfg${i}`, i, graph);
        const fgFinal = withMask(i, fgE, clip.mask, seg.duration, seg.skip, maskSeqIdx[i]);
        const fgM = matteChain(clip, W, H, fgFinal, i, graph, addInput, seg.duration);
        graph.push(
          `[${baseLabel}][${fgM}]overlay=x=0:y=0:shortest=0` + suffix + `[${label}]`
        );
      } else {
        graph.push(
          `[${idx}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
            `crop=${W}:${H},setsar=1,format=yuv420p` +
            suffix +
            `[${label}]`
        );
      }
      }
    }
    // 🎯 AI Select: a képjavítás maszkolt visszakeverése a szegmens végén
    let outLabel = label;
    if (seg.kind !== 'gap' && seg.clip?.selective) {
      const selected = `segsel${i}`;
      if (
        selectiveChain(seg.clip, W, H, outLabel, selected, i, graph, addInput, seg.duration)
      ) {
        outLabel = selected;
      }
    }
    // 🙈 arc-elmosás: a kész szegmens-kép kap egy záró blur-lépést a régión
    if (seg.kind !== 'gap' && seg.clip?.faceBlur) {
      const blurred = `segfb${i}`;
      if (faceBlurChain(seg.clip, W, H, outLabel, blurred, i, graph, seg.skip)) {
        outLabel = blurred;
      }
    }
    segLabels.push(`[${outLabel}]`);
  });

  // Szegmensek összefűzése — 3D/dinamikus átmenetekkel (🧊 3D V1): ha az előző
  // klip transitionOut-ot kér, az utolsó kockája d másodpercre kifagy (tpad
  // clone), és xfade viszi át a következő szegmensbe — az időzítés így NEM
  // csúszik (kimenet-hossz = szegmensek összege). Átmenet nélkül páronkénti
  // concat. Az xfade azonos tb/fps/formátumot kér → normalizálás elöl.
  const XFADE = {
    zoom: 'zoomin',
    spin: 'squeezeh',
    flip: 'squeezev',
    cube: 'smoothleft',
    circle: 'circleopen',
    dissolve: 'dissolve',
    // 2D átmenetek — közvetlen ffmpeg xfade-nevek
    wipeLeft: 'wipeleft',
    wipeRight: 'wiperight',
    wipeUp: 'wipeup',
    wipeDown: 'wipedown',
    slideLeft: 'slideleft',
    slideRight: 'slideright',
    pixelize: 'pixelize',
    blur: 'hblur',
    fadeBlack: 'fadeblack',
    fadeWhite: 'fadewhite',
    radial: 'radial',
  };
  const hasAnyTransition = segments.some(
    (s, i) =>
      i < segments.length - 1 &&
      s.kind !== 'gap' &&
      s.clip.transitionOut &&
      XFADE[s.clip.transitionOut.type]
  );
  if (!hasAnyTransition) {
    graph.push(`${segLabels.join('')}concat=n=${segments.length}:v=1:a=0[vtrack]`);
  } else {
    const norm = segments.map((s, i) => {
      // FONTOS: a segLabels-ből dolgozunk (nem fix `seg${i}`-ből) — az
      // arc-elmosás utólagos lépése átnevezheti a szegmens kimenetét, és egy
      // filtergraph-címkét csak EGYSZER lehet fogyasztani
      graph.push(`${segLabels[i]}format=yuv420p,fps=${FPS},settb=AVTB[segn${i}]`);
      return `segn${i}`;
    });
    let acc = norm[0];
    let accDur = segments[0].duration;
    for (let i = 1; i < segments.length; i++) {
      const prev = segments[i - 1];
      const trans =
        prev.kind !== 'gap' && prev.clip.transitionOut
          ? prev.clip.transitionOut
          : null;
      const mode = trans ? XFADE[trans.type] : null;
      const next = i === segments.length - 1 ? 'vtrack' : `vacc${i}`;
      if (mode) {
        const d = Math.min(
          Math.max(trans.duration ?? 0.5, 0.2),
          1.5,
          segments[i].duration
        );
        graph.push(
          `[${acc}]tpad=stop_mode=clone:stop_duration=${d.toFixed(3)}[vex${i}]`
        );
        graph.push(
          `[vex${i}][${norm[i]}]xfade=transition=${mode}:duration=${d.toFixed(3)}:offset=${accDur.toFixed(3)}[${next}]`
        );
      } else {
        graph.push(`[${acc}][${norm[i]}]concat=n=2:v=1:a=0[${next}]`);
      }
      acc = next;
      accDur += segments[i].duration;
    }
    if (segments.length === 1) {
      graph.push(`[${norm[0]}]null[vtrack]`);
    }
  }

  // ✨ Részecske-réteg (🧊 3D V2): Chromium-canvas képsor (fél felbontáson)
  // a videóra komponálva, a feliratok ALÁ; beat-syncnél a burstök a zene
  // downbeatjeire esnek (a beat-elemzés itt, a workeren fut). Hiba esetén a
  // render részecskék nélkül megy tovább.
  let overlayBase = 'vtrack';
  if (project.particles?.preset) {
    try {
      let bursts = [];
      if (project.particles.beatSync) {
        const music = clipsOfTypes(project, ['music'])
          .filter((c) => c.kind === 'audio')
          .sort((a, b) => a.start - b.start)[0];
        if (music) {
          const { analyzeBeats } = require('./beats');
          const grid = await analyzeBeats(music.uri);
          const src = (grid.downbeats?.length > 0 ? grid.downbeats : grid.beats) ?? [];
          bursts = src
            .map((b) => music.start + b)
            .filter((t) => t >= 0 && t <= Math.min(total, music.start + music.duration));
        }
      }
      const { renderParticleSequence } = require('./particles');
      const pw = Math.round(W / 4) * 2;
      const ph = Math.round(H / 4) * 2;
      const ptDir = path.join(workDir, 'particles');
      fs.mkdirSync(ptDir, { recursive: true });
      const seq = await renderParticleSequence(
        project.particles.preset,
        {
          W: pw,
          H: ph,
          fps: FPS,
          duration: total,
          bursts,
          intensity: project.particles.intensity ?? 1,
          seed: 42,
        },
        ptDir
      );
      const ptIdx = addInput(['-framerate', String(FPS), '-i', seq.pattern]);
      graph.push(`[${ptIdx}:v]scale=${W}:${H},format=rgba[ptl]`);
      // eof_action=pass: ha a képsor rövidebb (90 mp-es plafon), a réteg eltűnik
      graph.push(`[vtrack][ptl]overlay=x=0:y=0:eof_action=pass[vpt]`);
      overlayBase = 'vpt';
    } catch (err) {
      console.warn('particles kihagyva:', err.message);
    }
  }

  // Felirat-overlay lánc — a kliens TextOverlay-ével megegyező ütemezéssel:
  // · fade/slide: alpha-rámpa loop-olt PNG-streamen (fade → setpts a kezdőpontra)
  // · pop/pulse: valódi per-frame skálázás (scale eval=frame; az overlay követi
  //   a változó méretet, a -h/2 középre igazítás képkockánként újraszámolódik)
  // · slide/shake: mozgás az overlay y-kifejezésében (a fő idővonal t-jével)
  // · typewriter/karaoke: állapot-PNG-k enable-ablakokkal (text-render adja)
  let vLabel = overlayBase;
  let txN = 0;
  for (const t of texts) {
    const clip = t.clip;
    const anim = clip.animation ?? 'none';
    const clipStart = clip.start;
    const clipEndT = clipEnd(clip);
    const fontPx = (clip.fontSize / 100) * H;
    // követés/pozíció-kulcskockák (P0-6): a pozíció t-függő kifejezés lesz
    const textKf = clip.keyframes ?? {};
    const hasTextKf =
      (textKf.x?.length ?? 0) > 0 || (textKf.y?.length ?? 0) > 0;
    // 🧊 3D követés: méret-csatorna — a szöveg/matrica a témával nő/csökken
    const hasScaleKf = (textKf.scale?.length ?? 0) > 0;
    const kfT = `(t-${clipStart.toFixed(3)})`;
    const posX = hasTextKf
      ? `(${kfChannelExpr(textKf.x, clip.position.x, kfT)})*${W}`
      : (clip.position.x * W).toFixed(0);
    const posY = hasTextKf
      ? `(${kfChannelExpr(textKf.y, clip.position.y, kfT)})*${H}`
      : (clip.position.y * H).toFixed(0);

    for (const state of t.states) {
      const from = clipStart + state.from;
      const to = state.to == null ? clipEndT : Math.min(clipEndT, clipStart + state.to);
      if (to <= from) {
        continue;
      }
      const next = `vtx${txN}`;
      let yExpr = `${posY}-h/2`;
      let ovl;

      if (anim === 'fade' || anim === 'slide' || anim === 'pop' || anim === 'pulse') {
        // animált stream: az animáció a stream-lokális t-n fut (0-tól),
        // a setpts tolja a klip kezdetére; EOF után az utolsó (kész) képkocka
        // ismétlődik az enable-ablak végéig
        const animDur = anim === 'pulse' ? to - from : anim === 'pop' ? 0.4 : 0.5;
        const idx = addInput([
          '-loop', '1',
          '-framerate', String(FPS),
          '-t', Math.max(0.1, animDur).toFixed(3),
          '-i', state.file,
        ]);
        // a dinamikus scale kimenete fix méretű, átlátszó pad-be kerül
        // (eval=frame) — a változó képkockaméret az overlay-ben allokációs
        // hibát okozna 1080p+ vásznon
        const padFor = (factor) => {
          const mw = 2 * Math.ceil(((state.w ?? 0) * factor) / 2);
          const mh = 2 * Math.ceil(((state.h ?? 0) * factor) / 2);
          return mw > 0 && mh > 0
            ? `,pad=${mw}:${mh}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`
            : '';
        };
        let chain = `[${idx}:v]format=rgba`;
        if (anim === 'fade' || anim === 'slide') {
          chain += `,fade=t=in:st=0:d=0.4:alpha=1`;
        }
        // mindkét tengely explicit, 2px-en padlózva — a h=-2 arányos magasság
        // lapos feliratnál 0-ra kerekülne (invalid scaling dimension)
        const animScale = (factor) =>
          `,scale=w='max(2,iw*${factor})':h='max(2,ih*${factor})':eval=frame`;
        if (anim === 'pop') {
          // gyors belépés túllövéssel — a kliens 1.2·p·(2−p) görbéje;
          // a fade a scale előtt fut (méret-érzékeny szűrő)
          const f = 'if(lt(t,0.3),1.2*(t/0.3)*(2-(t/0.3)),1)';
          chain += `,fade=t=in:st=0:d=0.15:alpha=1`;
          chain += animScale(f);
          chain += padFor(1.2);
          chain += ',format=rgba';
        }
        if (anim === 'pulse') {
          chain += animScale('(1+0.05*sin(3*PI*t))');
          chain += padFor(1.06);
          chain += ',format=rgba';
        }
        chain += `,setpts=PTS+${from.toFixed(3)}/TB[tov${txN}]`;
        graph.push(chain);
        ovl = `tov${txN}`;
        if (anim === 'slide') {
          const offset = Math.round(fontPx * 0.9);
          yExpr = `${posY}-h/2+${offset}*(1-min((t-${from.toFixed(3)})/0.4,1))`;
        }
      } else if (hasScaleKf) {
        // méret-követett szöveg: a PNG a teljes ablakra loop-olt streammé
        // válik, per-frame skálázással (a stream-lokális t + eltolás adja a
        // klip-időt), fix átlátszó pad-ben (a változó méret az overlay-be nem
        // mehet), majd setpts tolja az enable-ablak elejére
        const idx = addInput([
          '-loop', '1',
          '-framerate', String(FPS),
          '-t', Math.max(0.1, to - from).toFixed(3),
          '-i', state.file,
        ]);
        const scaleT = `(t+${(from - clipStart).toFixed(3)})`;
        const SE = kfChannelExpr(textKf.scale, 1, scaleT);
        const maxS = Math.min(
          Math.max(...textKf.scale.map((kf) => kf.value), 1),
          2.5
        );
        const mw = 2 * Math.ceil(((state.w ?? 0) * maxS) / 2) + 2;
        const mh = 2 * Math.ceil(((state.h ?? 0) * maxS) / 2) + 2;
        graph.push(
          `[${idx}:v]format=rgba,` +
            `scale=w='max(2,trunc(iw*${SE}))':h='max(2,trunc(ih*${SE}))':eval=frame,` +
            `pad=${mw}:${mh}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame,format=rgba,` +
            `setpts=PTS+${from.toFixed(3)}/TB[tov${txN}]`
        );
        ovl = `tov${txN}`;
        if (anim === 'shake') {
          const amp = Math.max(2, Math.round(fontPx * 0.08));
          yExpr = `${posY}-h/2+${amp}*sin(14*PI*(t-${from.toFixed(3)}))`;
        }
      } else {
        const idx = addInput(['-i', state.file], `t|${state.file}`);
        ovl = `${idx}:v`;
        if (anim === 'shake') {
          const amp = Math.max(2, Math.round(fontPx * 0.08));
          yExpr = `${posY}-h/2+${amp}*sin(14*PI*(t-${from.toFixed(3)}))`;
        }
      }

      if (clip.kind === 'shape' && clip.blendMode) {
        // blend-mód (Creative Canvas): az elem a mód-semleges színű teljes
        // vászonra lapul (multiply→fehér, screen/lighten/difference→fekete,
        // overlay→középszürke), majd RGB-ben blendelődik az alappal
        const NEUTRAL = {
          multiply: 'white',
          screen: 'black',
          lighten: 'black',
          difference: 'black',
          overlay: '0x808080',
        };
        const neutral = NEUTRAL[clip.blendMode] ?? 'black';
        graph.push(`color=${neutral}:s=${W}x${H}:r=${FPS}[bln${txN}]`);
        graph.push(
          `[bln${txN}][${ovl}]overlay=x='${posX}-w/2':y='${yExpr}'[blf${txN}]`
        );
        graph.push(`[${vLabel}]format=gbrp[blb${txN}]`);
        graph.push(`[blf${txN}]format=gbrp[blg${txN}]`);
        graph.push(
          `[blb${txN}][blg${txN}]blend=all_mode=${blendName(clip.blendMode)}:enable='between(t,${from.toFixed(
            3
          )},${to.toFixed(3)})'[${next}]`
        );
      } else {
        graph.push(
          `[${vLabel}][${ovl}]overlay=x='${posX}-w/2':y='${yExpr}':enable='between(t,${from.toFixed(
            3
          )},${to.toFixed(3)})'[${next}]`
        );
      }
      vLabel = next;
      txN++;
    }
  }
  // 🎬 PiP-réteg(ek): a pip-sáv videó/kép klipjei a fő videó FÖLÉ overlay-eződnek,
  // a transform (scale/x/y) szerint méretezve+pozicionálva, időzítve (enable=between).
  const pipTrack = (project.tracks ?? []).find((t) => t.type === 'pip');
  const pipAudio = [];
  let pipN = 0;
  for (const clip of pipTrack?.clips ?? []) {
    if (clip.kind !== 'video' && clip.kind !== 'image') {
      continue;
    }
    const start = clip.start;
    const end = clip.start + clip.duration;
    const tr = clip.transform || {};
    const S = Math.max(0.05, Math.min(1, tr.scale ?? 0.32));
    const pw = Math.max(2, Math.round((W * S) / 2) * 2);
    const ox = Math.round((tr.x ?? 0) * W);
    const oy = Math.round((tr.y ?? 0) * H);
    // 🎬 PiP-keret (webcam-bubble): a keret BELÜL van (mint az RN border-box) —
    // a tartalmat a keret-vastagsággal kisebbre méretezzük, majd `pad` a keret
    // színével visszatölti az eredeti méretre; a lekerekítést `geq` alfa adja.
    const frame = clip.pipFrame;
    const bw = frame && frame.borderWidth ? Math.max(0, Math.round(frame.borderWidth * H)) : 0;
    const frac = frame ? Math.max(0, Math.min(0.5, frame.radius ?? 0)) : 0;
    const contentW = bw > 0 ? Math.max(2, Math.round((pw - 2 * bw) / 2) * 2) : pw;
    const srcLabel = `pip${pipN}`;
    if (clip.kind === 'video') {
      const speed = clip.speed || 1;
      const srcDur = (clip.duration * speed).toFixed(3);
      const idx = addInput(['-ss', (clip.trimIn || 0).toFixed(3), '-t', srcDur, '-i', clip.uri], `pipv|${clip.id}`);
      graph.push(
        `[${idx}:v]setpts=(PTS-STARTPTS)/${speed}+${start.toFixed(3)}/TB,fps=${FPS},scale=${contentW}:-2[${srcLabel}]`
      );
      if ((clip.volume ?? 1) > 0 && (await hasAudioStream(clip.uri))) {
        pipAudio.push({ idx, start, speed, volume: clip.volume ?? 1 });
      }
    } else {
      const idx = addInput(['-loop', '1', '-t', clip.duration.toFixed(3), '-i', clip.uri], `pipi|${clip.id}`);
      graph.push(
        `[${idx}:v]fps=${FPS},scale=${contentW}:-2,setpts=PTS-STARTPTS+${start.toFixed(3)}/TB[${srcLabel}]`
      );
    }
    // keret + lekerekítés lánc (ha van); a W,H a geq-ben a keretezett méret
    let ovlLabel = srcLabel;
    const fsteps = [];
    if (bw > 0) {
      const hex = (frame.borderColor || '#ffffff').replace('#', '');
      fsteps.push(`pad=iw+${2 * bw}:ih+${2 * bw}:${bw}:${bw}:0x${hex}`);
    }
    if (frac > 0) {
      const R = `(${frac.toFixed(4)}*min(W,H))`;
      const alpha = `255*clip(${R}-hypot(max(0,${R}-min(X,W-1-X)),max(0,${R}-min(Y,H-1-Y)))+0.5,0,1)`;
      fsteps.push('format=yuva420p', `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='${alpha}'`);
    }
    if (fsteps.length > 0) {
      const framed = `pipf${pipN}`;
      graph.push(`[${srcLabel}]${fsteps.join(',')}[${framed}]`);
      ovlLabel = framed;
    }
    const next = `vpip${pipN}`;
    const bm = frame && frame.blendMode;
    if (bm) {
      // 🎨 keverési mód: a PiP a mód-semleges színű teljes vászonra lapul
      // (multiply→fehér, screen/lighten/difference→fekete, overlay→szürke), majd
      // RGB-ben blendelődik az alap kompozittal — a forma-blend mintájára; a
      // PiP alfája (lekerekítés) miatt a doboz-alakú szakasz keveredik, a többi
      // semleges (érintetlen).
      const NEUTRAL = {
        multiply: 'white',
        screen: 'black',
        lighten: 'black',
        difference: 'black',
        overlay: '0x808080',
      };
      const neutral = NEUTRAL[bm] ?? 'black';
      graph.push(`color=${neutral}:s=${W}x${H}:r=${FPS}[pbln${pipN}]`);
      graph.push(`[pbln${pipN}][${ovlLabel}]overlay=x=(${W}-w)/2+${ox}:y=(${H}-h)/2+${oy}[pblf${pipN}]`);
      graph.push(`[${vLabel}]format=gbrp[pblb${pipN}]`);
      graph.push(`[pblf${pipN}]format=gbrp[pblg${pipN}]`);
      graph.push(
        `[pblb${pipN}][pblg${pipN}]blend=all_mode=${blendName(bm)}:enable='between(t,${start.toFixed(
          3
        )},${end.toFixed(3)})'[${next}]`
      );
    } else {
      let baseLabel = vLabel;
      const win = `between(t,${start.toFixed(3)},${end.toFixed(3)})`;
      // 🌒 vetett árnyék: a keretezett PiP-ből sötét, elmosott, féligátlátszó
      // sziluett készül, és a PiP MÖGÉ, jobbra-le eltolva overlay-eződik
      if (frame && frame.shadow) {
        const dx = Math.round(0.01 * W);
        const dy = Math.round(0.014 * H);
        const sigma = Math.max(4, Math.round(0.012 * H));
        graph.push(`[${ovlLabel}]split[pipmn${pipN}][pipsh${pipN}]`);
        graph.push(
          `[pipsh${pipN}]format=rgba,colorchannelmixer=rr=0:gg=0:bb=0,gblur=sigma=${sigma},colorchannelmixer=aa=0.5[shad${pipN}]`
        );
        const withShadow = `vsh${pipN}`;
        graph.push(
          `[${vLabel}][shad${pipN}]overlay=x=(${W}-w)/2+${ox}+${dx}:y=(${H}-h)/2+${oy}+${dy}:enable='${win}':shortest=0[${withShadow}]`
        );
        baseLabel = withShadow;
        ovlLabel = `pipmn${pipN}`;
      }
      graph.push(
        `[${baseLabel}][${ovlLabel}]overlay=x=(${W}-w)/2+${ox}:y=(${H}-h)/2+${oy}:enable='${win}':shortest=0[${next}]`
      );
    }
    vLabel = next;
    pipN++;
  }

  // 🎨 Grade-réteg(ek): az adjust-sáv klipjei a KÉSZ kompozitra (fő videó + PiP)
  // adnak nem-destruktív színkorrekciót, `enable`-ablakkal időzítve (CapCut-minta).
  const adjustTrack = (project.tracks ?? []).find((t) => t.type === 'adjust');
  let adjN = 0;
  for (const clip of adjustTrack?.clips ?? []) {
    if (clip.kind !== 'adjust') {
      continue;
    }
    const start = clip.start;
    const end = clip.start + clip.duration;
    const chain = gradeChain(clip, `between(t,${start.toFixed(3)},${end.toFixed(3)})`);
    if (!chain) {
      continue;
    }
    const next = `vgr${adjN}`;
    const strength = Math.max(0, Math.min(1, clip.strength ?? 1));
    const dur = end - start;
    const fadeIn = Math.max(0, Math.min(clip.fadeInSec ?? 0, dur));
    const fadeOut = Math.max(0, Math.min(clip.fadeOutSec ?? 0, dur));
    if (strength < 0.999 || fadeIn > 0 || fadeOut > 0) {
      // 🎛️ grade-erősség + fade: az eredetit és a grade-elt képet keverjük az
      // alfán át (a grade lánc enable-ablaka miatt ablakon kívül azonosak, így a
      // globális keverés is helyes). Az alfa = `strength`, amit a klip elején/
      // végén `fade` idő szerint 0→1→0 burkológörbével moduál → a grade fokozatosan
      // ERŐSÖDIK, majd HALVÁNYUL. orig*(1−a) + graded*a.
      let fades = '';
      if (fadeIn > 0) {
        fades += `,fade=t=in:st=${start.toFixed(3)}:d=${fadeIn.toFixed(3)}:alpha=1`;
      }
      if (fadeOut > 0) {
        fades += `,fade=t=out:st=${(end - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}:alpha=1`;
      }
      graph.push(`[${vLabel}]split[gro${adjN}][grg${adjN}]`);
      graph.push(`[grg${adjN}]${chain.slice(1)}[grgg${adjN}]`);
      graph.push(
        `[grgg${adjN}]format=yuva420p${fades},colorchannelmixer=aa=${strength.toFixed(3)}[grga${adjN}]`
      );
      graph.push(`[gro${adjN}][grga${adjN}]overlay[${next}]`);
    } else {
      // a lánc vezető vesszővel jön — [vLabel]<chain>[next]
      graph.push(`[${vLabel}]${chain.slice(1)}[${next}]`);
    }
    vLabel = next;
    adjN++;
  }

  graph.push(`[${vLabel}]format=yuv420p[vout]`);

  // hang: néma alap + hozzájárulások; a beszéd (videó-hang + voiceover) külön
  // buszra gyűlik, hogy az autoDuck-os zene sidechain-nel halkulhasson alatta
  const audioLabels = ['abase'];
  const speechLabels = [];
  const duckLabels = [];
  graph.push(
    `anullsrc=channel_layout=stereo:sample_rate=44100:d=${total.toFixed(3)}[abase]`
  );

  // Voice Studio (P0-9) — a láncok a voicechain.js-ben élnek, mert az
  // ELŐNÉZETI PROXY pontosan ugyanezt kell hogy alkalmazza (különben az
  // előnézet és az export hangja szétcsúszna)
  const DEREVERB = dereverbChain();

  let audioIdx = 0;
  // 🎚️ hangerő-automáció (P0-5): volume-kulcskockákkal a statikus érték
  // helyett t-kifejezés megy (eval=frame); a kf-idő klip-idő (t + skip)
  const volumeExpr = (clip, skip) => {
    const kfs = clip.keyframes?.volume;
    if (!kfs || kfs.length === 0) {
      return `volume=${clip.volume}`;
    }
    const T = skip > 0 ? `(t+${skip.toFixed(3)})` : 't';
    return `volume='${kfChannelExpr(kfs, clip.volume, T)}':eval=frame`;
  };
  const hasAnyVolume = (clip) =>
    clip.volume > 0 || (clip.keyframes?.volume ?? []).some((k) => k.value > 0);

  for (const seg of segments) {
    if (seg.kind !== 'video' || !hasAnyVolume(seg.clip)) {
      continue;
    }
    const clip = seg.clip;
    if (!(await hasAudioStream(clip.uri))) {
      continue;
    }
    const idx = addInput(['-i', clip.uri], `v|${clip.uri}`);
    const srcStart = clip.trimIn + seg.skip * clip.speed;
    const srcEnd = srcStart + seg.duration * clip.speed;
    const delayMs = Math.round((clip.start + seg.skip) * 1000);
    const label = `av${audioIdx++}`;
    graph.push(
      `[${idx}:a]atrim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},` +
        `asetpts=PTS-STARTPTS,${atempoChain(clip.speed)},` +
        (clip.deReverb ? DEREVERB : '') +
        (clip.voiceEnhance ? VOICE_ENHANCE : '') +
        `${volumeExpr(clip, seg.skip)},` +
        `aresample=44100,adelay=${delayMs}|${delayMs}[${label}]`
    );
    speechLabels.push(label);
  }

  for (const clip of audioClips) {
    if (!hasAnyVolume(clip)) {
      continue;
    }
    if (!(await hasAudioStream(clip.uri))) {
      continue;
    }
    const idx = addInput(['-i', clip.uri], `a|${clip.uri}`);
    const delayMs = Math.round(clip.start * 1000);
    const label = `aa${audioIdx++}`;
    let chain =
      `[${idx}:a]atrim=0:${clip.duration.toFixed(3)},asetpts=PTS-STARTPTS,` +
      (clip.deReverb ? DEREVERB : '') +
      (clip.voiceEnhance ? VOICE_ENHANCE : '') +
      // 🎛️ granuláris Pro-audio FX (EQ/HPF/LPF/komp/limiter/de-esser/denoise/reverb/delay/normalize)
      audioFxChain(clip.audioFx) +
      panFilter(clip.pan) +
      volumeExpr(clip, 0);
    if (clip.fadeIn > 0) {
      chain += `,afade=t=in:st=0:d=${clip.fadeIn.toFixed(3)}`;
    }
    if (clip.fadeOut > 0) {
      chain += `,afade=t=out:st=${Math.max(0, clip.duration - clip.fadeOut).toFixed(3)}:d=${clip.fadeOut.toFixed(3)}`;
    }
    chain += `,aresample=44100,adelay=${delayMs}|${delayMs}[${label}]`;
    graph.push(chain);
    if (clip.source === 'voiceover') {
      speechLabels.push(label);
    } else if (clip.autoDuck) {
      duckLabels.push(label);
    } else {
      audioLabels.push(label);
    }
  }

  if (duckLabels.length > 0 && speechLabels.length > 0) {
    // beszéd-busz kettéosztva: egyik a mixbe, másik a sidechain kulcsa
    const speechMix =
      speechLabels.length > 1
        ? (graph.push(
            `${speechLabels.map((l) => `[${l}]`).join('')}amix=inputs=${speechLabels.length}:duration=longest:normalize=0[spmix]`
          ),
          'spmix')
        : speechLabels[0];
    graph.push(
      `[${speechMix}]aformat=sample_fmts=fltp:channel_layouts=stereo,asplit[spOut][spKeyRaw]`
    );
    // a kulcs-ág csenddel párnázva — különben a sidechaincompress a beszéd
    // végénél levágná a zene-buszt is
    graph.push(`[spKeyRaw]apad[spKey]`);
    const duckMix =
      duckLabels.length > 1
        ? (graph.push(
            `${duckLabels.map((l) => `[${l}]`).join('')}amix=inputs=${duckLabels.length}:duration=longest:normalize=0[dkmix]`
          ),
          'dkmix')
        : duckLabels[0];
    graph.push(
      `[${duckMix}]aformat=sample_fmts=fltp:channel_layouts=stereo[dkin]`
    );
    graph.push(
      `[dkin][spKey]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=350[ducked]`
    );
    audioLabels.push('spOut', 'ducked');
  } else {
    audioLabels.push(...speechLabels, ...duckLabels);
  }

  // 🎬 PiP-audio: a pip-videók hangja a klip kezdetére késleltetve, a mixbe
  for (let k = 0; k < pipAudio.length; k++) {
    const pa = pipAudio[k];
    const ms = Math.round(pa.start * 1000);
    const tempo = pa.speed >= 0.5 && pa.speed <= 2 ? `,atempo=${pa.speed}` : '';
    graph.push(
      `[${pa.idx}:a]asetpts=PTS-STARTPTS${tempo},adelay=${ms}|${ms},volume=${pa.volume}[pipa${k}]`
    );
    audioLabels.push(`pipa${k}`);
  }

  graph.push(
    `${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:duration=first:normalize=0[aout]`
  );

  const scriptFile = path.join(workDir, 'filtergraph.txt');
  fs.writeFileSync(scriptFile, graph.join(';\n'));

  const outFile = path.join(workDir, 'out.mp4');
  const args = [
    '-y',
    ...inputs.flat(),
    '-filter_complex_script', scriptFile,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', String(CRF),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', total.toFixed(3),
    '-movflags', '+faststart',
    outFile,
  ];
  await runFfmpegWithProgress(args, total, onProgress);
  return outFile;
}

// az adjustChain a kép-dokumentum rasterizálójának is kell — ugyanaz a
// képjavítás menjen a fotó-rétegre, mint a videóklipre
module.exports = { renderProject, projectDuration, adjustChain };

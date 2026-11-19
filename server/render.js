const { logCaught } = require('./lib/caught');
// A projekt-JSON → FFmpeg parancs fordítása és futtatása.
//
// Vizuális sáv: a klipek start szerint rendezve, átfedésnél a későbbi győz
// (mint az app activeVisualClip-je), a lyukakat fekete tölti ki. Sebesség,
// szűrő-overlay és fade a szegmensen belül érvényesül. A feliratok előre
// rasterizált PNG-k, időzített overlay-ként. Hang: néma alap + minden
// hozzájárulás amix-szel (normalize=0), így az időzítés determinisztikus.
const fs = require('fs');
const path = require('path');

const { renderShapePngs, renderTextPngs } = require('./text-render');

// 🧩 A render moduljai (server/render/): tiszta láncépítők és időzítés-matek; ez a fájl a
// vezénylés (renderProject) — az exportok változatlanok.
const {
  MAX_RENDER_DURATION_SEC,
  MAX_AUDIO_RENDER_DURATION_SEC,
  maxRenderSecFor,
  CANVAS,
  XFADE_MODES,
  xfadeMode,
} = require('./render/constants');
const { runFfmpegWithProgress } = require('./render/ffmpeg');
const { EDGE_FADE_SEC, edgeFades, isDuckTrigger } = require('./render/audioTiming');
const { clipsOfTypes, projectDuration, segSourceWindow, visualSegments } = require('./render/timeline');
const { EFFECT_DEFAULT_AMOUNT, effectFilterStr, effectChainFx, shearPoint, bezierEaseNode } = require('./render/effects');
const {
  videoEncoderArgs,
  outputColorFilter,
  audioEncoderArgs,
  AUDIO_FORMATS,
  audioExtractArgs,
  gifArgs,
} = require('./render/presets');
const { applyMaster } = require('./render/master');
const { FILTERS, adjustChain, gradeChain } = require('./render/videoFilters');
const { RenderContentError } = require('./render/errors');
const { createClipChains } = require('./render/clipChains');
const { prepareMaskSequences, buildSegmentGraph, concatSegments, addParticles } = require('./render/segmentGraph');
const { overlayTexts } = require('./render/textLayers');
const { overlayPip, overlayAdjust } = require('./render/compositeLayers');
const { buildAudioGraph } = require('./render/audioGraph');

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
async function resolveCompounds(project, workDir, settings, signal, report) {
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
          await renderProject(sub, subDir, () => {}, settings, signal, report); // ← rekurzió (abort-tudatos)
          const mp4 = path.join(subDir, 'out.mp4');
          const dur = projectDuration(sub);
          clips.push({ ...c, uri: mp4, comp: undefined, trimIn: c.trimIn ?? 0, sourceDuration: dur, speed: c.speed ?? 1 });
          continue;
        } catch (err) {
          logCaught('render.js:resolveCompounds', err);
          if (signal && signal.aborted) throw err;
          // 🛑 a beágyazott kompozíció helyén a nyers forrás állna — rossz tartalom: a render álljon meg
          throw new RenderContentError('compound', err);
        }
      }
      clips.push(c);
    }
    tracks.push({ ...tk, clips });
  }
  return { ...project, tracks };
}

async function renderProject(project, workDir, onProgress, settings = {}, signal, report) {
  // export-beállítások (P0-design): felbontás/fps/minőség a kliens Export
  // paneljéről — a FPS a modul-konstans árnyékolásával jut el minden lánchoz
  const shortSide = Math.min(2160, Math.max(480, parseInt(settings.resolution, 10) || 1080));
  const FPS = [24, 30, 60].includes(parseInt(settings.fps, 10))
    ? parseInt(settings.fps, 10)
    : 30;
  const CRF = { low: 28, medium: 23, high: 19 }[settings.quality] ?? 20;
  const base = CANVAS[project.aspectRatio];
  if (!base) {
    // ismeretlen képarány → érthető hiba, NEM csendes 9:16 (B14)
    throw new Error(`Ismeretlen képarány: ${project.aspectRatio}`);
  }
  const scale = shortSide / Math.min(base.w, base.h);
  const even = (v) => Math.round((v * scale) / 2) * 2;
  const canvas = { w: even(base.w), h: even(base.h) };
  const { w: W, h: H } = canvas;
  if (signal && signal.aborted) {
    throw new Error('render megszakítva');
  }
  // 🧱 compound clip / pre-compose: a beágyazott kompozíciók rekurzív renderje MP4-be
  project = await resolveCompounds(project, workDir, settings, signal, report);
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
  const audioClips = clipsOfTypes(project, ['music', 'voiceover', 'sfx', 'audio', 'aux1', 'aux2', 'aux3', 'aux4', 'aux5']).filter(
    (c) => c.kind === 'audio'
  );

  // feliratok + formák rasterizálása (közös Chromium-útvonal); a formák a
  // szöveg-overlay lánccal kompatibilis bejegyzésekként kerülnek a sorba —
  // a formák ELŐBB, hogy a szöveg rájuk kerülhessen
  // ⚠️ KÜLÖN try/catch: egyetlen hibás FORMA nem viheti el az ÖSSZES feliratot.
  // (Korábban közös blokkban voltak, így egy rossz méretű forma miatt a videó
  // „sikeresen" elkészült — csak épp szöveg és felirat nélkül.)
  let texts = [];
  // 🛑 hiányzó szöveg/forma = hibás videó → a render álljon meg érthető hibával (nem „siker" szöveg nélkül)
  try {
    texts.push(...(await renderShapePngs(shapeClips, canvas, workDir)));
  } catch (err) {
    logCaught('render.js:renderProject', err);
    throw new RenderContentError('shape', err);
  }
  try {
    texts.push(...(await renderTextPngs(textClips, canvas, workDir)));
  } catch (err) {
    logCaught('render.js:renderProject', err);
    throw new RenderContentError('text', err);
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

  // a render-környezet: a kiemelt láncépítők ezen át kapják a vásznat, az fps-t és a gráfot
  const rc = { project, workDir, settings, signal, report, FPS, W, H, canvas, total, segments, graph, addInput };
  const chains = createClipChains(rc);

  const maskSeqIdx = await prepareMaskSequences(rc);
  const segLabels = buildSegmentGraph(rc, chains, maskSeqIdx);
  concatSegments(rc, segLabels);
  const overlayBase = await addParticles(rc);

  let vLabel = await overlayTexts(rc, texts, overlayBase);
  const pip = await overlayPip(rc, vLabel);
  vLabel = pip.vLabel;
  const pipAudio = pip.pipAudio;
  vLabel = overlayAdjust(rc, vLabel);

  // a kimeneti szín-tér pixel-szinten (B22) — a tagek ehhez igazodnak (videoEncoderArgs)
  graph.push(`[${vLabel}]${outputColorFilter(settings)}[vout]`);

  // 🎧 „azt kapod, amit hallasz”: ha a telefon feltöltötte a kész keverést (előnézet = export —
  // effektek, duck, master is), a szerver NEM keveri újra: ez a sáv kerül a videó alá / a
  // hangfájlba. A régi kliens (keverés nélkül) a szerveres keverést kapja.
  const mixPath = typeof project.audioMixUri === 'string' && fs.existsSync(project.audioMixUri) ? project.audioMixUri : null;
  await buildAudioGraph(rc, mixPath, audioClips, pipAudio);

  // 🎧 hang-only export (WAV/MP3/AAC/FLAC/Opus, PRO-AUDIO A25): a mix videó nélkül, lebegőpontos
  // PCM-ként kerül a köztes fájlba, így a veszteségmentes kimenet valóban az; a kép nem kódolódik
  const audio = audioExtractArgs(settings);
  // mono kimenetnél a lekeverés a master ELŐTT: különben a hangosság-cél a sztereó mixre
  // teljesülne, és a mono fájl ~3 LU-val halkabb lenne
  const mixIdx = graph.length - 1;
  if (Number(settings.channels) === 1) {
    graph[mixIdx] = graph[mixIdx].replace(/\[aout\]$/, ',aformat=channel_layouts=mono[aout]');
  }
  if (audio) {
    // mintapontos hossz: a `-t` a PCM-csomag (1024 minta) határán vágna
    graph[mixIdx] = graph[mixIdx].replace(/\[aout\]$/, `,atrim=end=${total.toFixed(6)}[aout]`);
    graph.push('[vout]nullsink');
  }

  const scriptFile = path.join(workDir, 'filtergraph.txt');
  fs.writeFileSync(scriptFile, graph.join(';\n'));

  // ProRes-t .mov konténerbe (az mp4 nem szabványos hozzá)
  const outFile = path.join(workDir, audio ? 'out.mka' : settings.codec === 'prores' ? 'out.mov' : 'out.mp4');
  const streams = audio
    ? ['-map', '[aout]', '-c:a', 'pcm_f32le']
    : ['-map', '[vout]', '-map', '[aout]', ...videoEncoderArgs(settings, FPS, CRF), ...audioEncoderArgs(settings)];
  const args = [
    '-y',
    ...inputs.flat(),
    '-filter_complex_script', scriptFile,
    ...streams,
    '-t', total.toFixed(3),
    ...(audio ? [] : ['-movflags', '+faststart']),
    outFile,
  ];
  await runFfmpegWithProgress(args, total, onProgress, signal);

  // 🎚️ MASTER (kétmenetes): EQ + multiband + loudnorm(mért, linear) a kész keverékre. A hiba
  // a render hibája (A30): a mester nélküli fájl hibás hangosságú volna, jelzés nélkül.
  let masteredFile = outFile;
  // a telefon keverésében a master már benne van (nem mesterelünk kétszer)
  if (project.audioMaster && !mixPath) {
    masteredFile = await applyMaster(outFile, project.audioMaster, workDir, total, onProgress, {
      audioOnly: !!audio,
      settings,
      signal,
    }).catch((e) => {
      logCaught('render.js:renderProject', e);
      throw new Error(signal && signal.aborted ? 'render megszakítva' : `A mesterelés nem sikerült: ${e.message}`);
    });
  }

  if (audio) {
    const audioFile = path.join(workDir, `out.${audio.ext}`);
    await runFfmpegWithProgress(['-y', '-i', masteredFile, ...audio.args, audioFile], total, onProgress, signal);
    return audioFile;
  }

  // 🎞️ GIF-export (VIDEO-STUDIO §5): a kész videóból animált GIF (palette-optimalizálva).
  if (settings.gif) {
    const g = gifArgs(settings);
    const gifFile = path.join(workDir, `out.${g.ext}`);
    await runFfmpegWithProgress(['-y', '-i', masteredFile, ...g.args, gifFile], total, onProgress, signal);
    return gifFile;
  }

  return masteredFile;
}

// az adjustChain a kép-dokumentum rasterizálójának is kell — ugyanaz a
// képjavítás menjen a fotó-rétegre, mint a videóklipre
module.exports = {
  FILTERS,
  EDGE_FADE_SEC,
  edgeFades,
  isDuckTrigger,
  renderProject,
  outputColorFilter,
  projectDuration,
  adjustChain,
  gradeChain,
  segSourceWindow,
  effectFilterStr,
  effectChainFx,
  EFFECT_DEFAULT_AMOUNT,
  shearPoint,
  bezierEaseNode,
  audioExtractArgs,
  gifArgs,
  AUDIO_FORMATS,
  MAX_RENDER_DURATION_SEC,
  MAX_AUDIO_RENDER_DURATION_SEC,
  maxRenderSecFor,
  XFADE_MODES,
  xfadeMode,
};
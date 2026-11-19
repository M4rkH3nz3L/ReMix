const { logCaught } = require('../lib/caught');
// 🎬 A vizuális sáv filtergraph-ja: animált-maszk előkészítés, szegmensenkénti láncok, összefűzés
// átmenetekkel, részecske-réteg. A renderProject-ből kiemelve (a sorrend és a címkék változatlanok).
const fs = require('fs');
const path = require('path');

const { depthLayerDir } = require('../depth');
const { XFADE_MODES, xfadeMode } = require('./constants');
const { effectChainFx } = require('./effects');
const { segSourceWindow, clipsOfTypes } = require('./timeline');
const {
  adjustChain,
  lightingChain,
  selectiveChain,
  motionChain,
  stabilizeChain,
  faceBlurChain,
  matteChain,
  edgeChain,
  filterDrawbox,
  fadeFilters,
} = require('./videoFilters');
const { noteDegraded } = require('./errors');

/** az animált maszkok képsorai — szegmens-index → ffmpeg-input index */
async function prepareMaskSequences(rc) {
  const { segments, workDir, FPS, W, H, addInput, report } = rc;
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
        const { renderMaskSequence } = require('../mask-render');
        const dir = path.join(workDir, `mask_${i}`);
        fs.mkdirSync(dir, { recursive: true });
        const seqM = await renderMaskSequence(
          c.mask,
          { skip: seg.skip, duration: seg.duration, fps: FPS, W, H },
          dir
        );
        if (seqM) {
          maskSeqIdx[i] = addInput(['-framerate', String(FPS), '-i', seqM.pattern]);
        } else {
          noteDegraded(report, 'mask');
        }
      } catch (err) {
        logCaught('render.js:renderProject', err);
        noteDegraded(report, 'mask'); // → geq-közelítés
      }
    }
  }
  return maskSeqIdx;
}

/** a szegmensek láncai a graph-ba; visszaadja a szegmens-kimenetek címkéit (`[label]`) */
function buildSegmentGraph(rc, chains, maskSeqIdx) {
  const { segments, W, H, FPS, graph, addInput } = rc;
  const {
    perspChain,
    hasTransform,
    tiltChain,
    skewChain,
    chromaChain,
    withMask,
    appearanceChain,
    blurBackgroundChain,
    hasKf,
    withKeyframeMotion,
    withDepthParallax,
    withTransform,
  } = chains;
  const segLabels = [];

  segments.forEach((seg, i) => {
    const label = `seg${i}`;
    if (seg.kind === 'gap') {
      graph.push(
        `color=black:s=${W}x${H}:r=${FPS}:d=${seg.duration.toFixed(3)},format=yuv420p,setsar=1[${label}]`
      );
    } else if (seg.kind === 'video') {
      const clip = seg.clip;
      const idx = addInput(['-i', clip.uri], `v|${clip.uri}`);
      const { srcStart, srcEnd } = segSourceWindow(clip, seg);
      const decode =
        `[${idx}:v]trim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},` +
        (clip.reversed ? 'reverse,' : '') + // ⏪ a trimmelt ablak megfordítása
        `setpts=(PTS-STARTPTS)/${clip.speed},` +
        motionChain(clip, seg.duration) +
        stabilizeChain(clip);
      // AI Select esetén az adjust NEM a teljes képre megy — a maszkolt
      // lépés adja hozzá a szegmens végén
      const suffix = (clip.selective ? '' : adjustChain(clip)) + lightingChain(clip) + filterDrawbox(clip, W, H) + fadeFilters(clip, seg.duration);
      const blur = clip.backgroundFill === 'blur';
      if (hasKf(clip)) {
        // animált zoom/pan: fit (contain) méretű rgba forrás → keyframe-lánc
        const fit =
          `scale=${W}:${H}:force_original_aspect_ratio=decrease,setsar=1` +
          appearanceChain(clip, seg.skip) +
          effectChainFx(clip) +
          tiltChain(clip) +
          skewChain(clip) + perspChain(clip);
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
          effectChainFx(clip) +
          tiltChain(clip) +
          skewChain(clip) + perspChain(clip);
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
        // 🎛️ a sima video-út (se kf, se transform, se maszk) EDDIG kihagyta az effekt-láncot
        // (effectChainFx) — így a blur/grain/… + az új effektek a leggyakoribb klipen nem hatottak. Pótolva.
        graph.push(
          decode +
            `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
            `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1` +
            effectChainFx(clip) +
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
          effectChainFx(clip) +
          tiltChain(clip) +
          skewChain(clip) + perspChain(clip);
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
          effectChainFx(clip) +
          tiltChain(clip) +
          skewChain(clip) + perspChain(clip);
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
        // 🎛️ a sima KÉP-út is kihagyta az effekt-láncot (effectChainFx) — pótolva (mint a video-ágon)
        graph.push(
          `[${idx}:v]fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,` +
            `crop=${W}:${H},setsar=1,format=yuv420p` +
            effectChainFx(clip) +
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
  return segLabels;
}

/** a szegmensek összefűzése a [vtrack] címkére (átmenetekkel vagy concat-tal) */
function concatSegments(rc, segLabels) {
  const { segments, W, H, FPS, graph } = rc;
  // Szegmensek összefűzése — 3D/dinamikus átmenetekkel (🧊 3D V1): ha az előző
  // klip transitionOut-ot kér, az utolsó kockája d másodpercre kifagy (tpad
  // clone), és xfade viszi át a következő szegmensbe — az időzítés így NEM
  // csúszik (kimenet-hossz = szegmensek összege). Átmenet nélkül páronkénti
  // concat. Az xfade azonos tb/fps/formátumot kér → normalizálás elöl.
  // 🧊 átmenet-map: modul-szintű XFADE_MODES (EGY forrás a kliens-tükörrel)
  const XFADE = XFADE_MODES;
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
        // 🧭 irány: az irányos családoknál (wipe/slide/cube) az xfade-variánst váltja
        const xmode = xfadeMode(trans.type, trans.direction);
        // ⏩ easing: a tiszta crossfade-nél (dissolve) eased progress egyéni expr-rel
        const ez = trans.easing && trans.easing !== 'linear' ? trans.easing : null;
        let xfadeArgs;
        if (ez && trans.type === 'dissolve') {
          const P =
            ez === 'easeIn' ? 'P*P' : ez === 'easeOut' ? '(1-(1-P)*(1-P))' : 'if(lt(P,0.5),2*P*P,1-2*(1-P)*(1-P))';
          xfadeArgs = `transition=custom:expr='A*(1-(${P}))+B*(${P})'`;
        } else {
          xfadeArgs = `transition=${xmode}`;
        }
        const w0 = accDur;
        const w1 = accDur + d;
        const xfLabel = `vxf${i}`;
        graph.push(
          `[${acc}]tpad=stop_mode=clone:stop_duration=${d.toFixed(3)}[vex${i}]`
        );
        graph.push(
          `[vex${i}][${norm[i]}]xfade=${xfadeArgs}:duration=${d.toFixed(3)}:offset=${accDur.toFixed(3)}[${xfLabel}]`
        );
        // 🎛️ átmenet-flourishök az ablakra ([w0,w1]): zoom-lökés (zoompan),
        // elmosás (gblur enable), forgás-lökés (rotate enable) — az intensity skálázza
        const I = Math.max(0, Math.min(1, trans.intensity ?? 1));
        const fx = [];
        if ((trans.zoom ?? 0) > 0.01) {
          fx.push(
            `zoompan=z='1+${(trans.zoom * I * 0.3).toFixed(3)}*max(0,sin(PI*(time-${w0.toFixed(3)})/${d.toFixed(3)}))':d=1:s=${W}x${H}:fps=${FPS}`
          );
        }
        if ((trans.blur ?? 0) > 0.01) {
          fx.push(
            `gblur=sigma=${(trans.blur * I * 18).toFixed(1)}:enable='between(t,${w0.toFixed(3)},${w1.toFixed(3)})'`
          );
        }
        if ((trans.rotation ?? 0) > 0.01) {
          fx.push(
            `rotate=a='${(trans.rotation * I * 0.6).toFixed(3)}*sin(PI*max(0,min(1,(t-${w0.toFixed(3)})/${d.toFixed(3)})))':c=black:enable='between(t,${w0.toFixed(3)},${w1.toFixed(3)})'`
          );
        }
        if (fx.length) {
          graph.push(`[${xfLabel}]${fx.join(',')}[${next}]`);
        } else {
          graph.push(`[${xfLabel}]null[${next}]`);
        }
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
}

/** a részecske-réteg; visszaadja a feliratok alá kerülő alap-címkét */
async function addParticles(rc) {
  const { project, total, workDir, W, H, FPS, graph, addInput, report } = rc;
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
          const { analyzeBeats } = require('../beats');
          const grid = await analyzeBeats(music.uri);
          const src = (grid.downbeats?.length > 0 ? grid.downbeats : grid.beats) ?? [];
          bursts = src
            .map((b) => music.start + b)
            .filter((t) => t >= 0 && t <= Math.min(total, music.start + music.duration));
        }
      }
      const { renderParticleSequence } = require('../particles');
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
      logCaught('render.js:renderProject', err);
      noteDegraded(report, 'particles');
    }
  }
  return overlayBase;
}

module.exports = {
  prepareMaskSequences,
  buildSegmentGraph,
  concatSegments,
  addParticles,
};

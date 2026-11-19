// 🎬 PiP- és grade-rétegek a kész kompozitra (a renderProject-ből kiemelve, változatlan tartalommal).
const { blendName } = require('./constants');
const { hasAudioStream } = require('./ffmpeg');
const { FILTERS, gradeChain } = require('./videoFilters');

/**
 * A pip-sáv klipjei a `vLabel` kompozit fölé.
 * @returns { vLabel, pipAudio } — az új kompozit-címke és a PiP-hangok (a hang-gráfnak)
 */
async function overlayPip(rc, vLabel) {
  const { project, W, H, FPS, graph, addInput } = rc;
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
      // ⏪ B19: a fordított PiP-klip a renderben is visszafelé szól/látszik
      const rev = clip.reversed ? 'reverse,' : '';
      graph.push(
        `[${idx}:v]${rev}setpts=(PTS-STARTPTS)/${speed}+${start.toFixed(3)}/TB,fps=${FPS},scale=${contentW}:-2[${srcLabel}]`
      );
      if ((clip.volume ?? 1) > 0 && (await hasAudioStream(clip.uri))) {
        pipAudio.push({ idx, start, speed, volume: clip.volume ?? 1, reversed: !!clip.reversed });
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
    // 🎨 B19: a PiP saját szűrő-tintje (a fő klipek drawbox-mintájára, a PiP méretén)
    const pf = FILTERS[clip.filterId];
    if (pf) {
      const op = pf.opacity * (clip.filterIntensity ?? 1);
      fsteps.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0x${pf.color}@${op.toFixed(3)}:t=fill`);
    }
    if (bw > 0) {
      const hex = (frame.borderColor || '#ffffff').replace('#', '');
      fsteps.push(`pad=iw+${2 * bw}:ih+${2 * bw}:${bw}:${bw}:0x${hex}`);
    }
    if (frac > 0) {
      const R = `(${frac.toFixed(4)}*min(W,H))`;
      const alpha = `255*clip(${R}-hypot(max(0,${R}-min(X,W-1-X)),max(0,${R}-min(Y,H-1-Y)))+0.5,0,1)`;
      fsteps.push('format=yuva420p', `geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='${alpha}'`);
    }
    // 🔄 B19: forgatás (a doboz-közép körül, átlátszó sarkokkal) + 🌫️ opacitás —
    // a preview (PipLayer) eddig mutatta, a kész videóból hiányzott
    const rotDeg = Number(tr.rotation) || 0;
    if (rotDeg) {
      const rad = ((rotDeg * Math.PI) / 180).toFixed(6);
      fsteps.push('format=rgba', `rotate=${rad}:c=none:ow=rotw(${rad}):oh=roth(${rad})`);
    }
    const pipOpacity = typeof clip.opacity === 'number' ? Math.max(0, Math.min(1, clip.opacity)) : 1;
    if (pipOpacity < 1) {
      fsteps.push('format=rgba', `colorchannelmixer=aa=${pipOpacity.toFixed(3)}`);
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
  return { vLabel, pipAudio };
}

/** az adjust-sáv grade-rétegei a `vLabel` kompozitra; visszaadja az új címkét */
function overlayAdjust(rc, vLabel) {
  const { project, graph } = rc;
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
  return vLabel;
}

module.exports = {
  overlayPip,
  overlayAdjust,
};

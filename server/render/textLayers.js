const { logCaught } = require('../lib/caught');
// 🔤 Felirat-, matrica- és forma-overlay lánc (a renderProject-ből kiemelve, változatlan tartalommal).
const fs = require('fs');
const path = require('path');

const { blendName } = require('./constants');
const { clipEnd } = require('./timeline');
const { kfChannelExpr } = require('./keyframeExpr');
const { noteDegraded } = require('./errors');

/**
 * A rasterizált szöveg/forma bejegyzések (`texts`) overlay-e az `overlayBase` címkére.
 * @returns a kész kompozit címkéje
 */
async function overlayTexts(rc, texts, overlayBase) {
  const { workDir, report, W, H, FPS, canvas, graph, addInput } = rc;
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
    const posYRaw = hasTextKf
      ? `(${kfChannelExpr(textKf.y, clip.position.y, kfT)})*${H}`
      : (clip.position.y * H).toFixed(0);
    // ↕️ alapvonal-eltolás (baseline shift): + = felfelé (kisebb y)
    const blPx = Math.round((clip.baselineShift ?? 0) * fontPx);
    const posY = blPx !== 0 ? `(${posYRaw}-${blPx})` : posYRaw;

    // 🪟 Szöveg-maszk (mask text): a szöveg alakja ABLAK az alatta lévő
    // kompozitra — a betűkben éles videó, körülötte elmosott+sötétített változat.
    // A szöveg alfáját (a state-PNG) a vászonra pad-eljük, azzal maszkoljuk a
    // kompozit egy másolatát, majd a sötétített bg-re overlay-ezzük; a teljes
    // hatás a klip idővonal-ablakában cseréli le a képet (enable-lel).
    if (clip.kind === 'text' && clip.maskReveal && t.states[0]) {
      const st = t.states[0];
      const from = clipStart;
      const to = clipEndT;
      const tw = Math.max(2, st.w || 2);
      const th = Math.max(2, st.h || 2);
      const padX = Math.max(0, Math.min(W - tw, Math.round(clip.position.x * W - tw / 2)));
      const padY = Math.max(0, Math.min(H - th, Math.round(clip.position.y * H - th / 2)));
      const tIdx = addInput(['-i', st.file], `t|${st.file}`);
      const next = `vtx${txN}`;
      graph.push(`[${vLabel}]split=3[mrg${txN}][mrf${txN}][mrb${txN}]`);
      graph.push(`[mrb${txN}]boxblur=8:1,eq=brightness=-0.30:saturation=0.75[mrdk${txN}]`);
      graph.push(`[${tIdx}:v]alphaextract,pad=${W}:${H}:${padX}:${padY}:color=black[mrm${txN}]`);
      graph.push(`[mrf${txN}][mrm${txN}]alphamerge[mrwin${txN}]`);
      graph.push(`[mrdk${txN}][mrwin${txN}]overlay=0:0[mreff${txN}]`);
      graph.push(
        `[mrg${txN}][mreff${txN}]overlay=0:0:enable='between(t,${from.toFixed(3)},${to.toFixed(
          3
        )})'[${next}]`
      );
      vLabel = next;
      txN++;
      continue;
    }

    // 🎞️ Path-animáció (drawOn / morph): per-frame forma-képsor; a beérkező
    // animáció után a beállt alak (lastFile) áll ki a klip végéig.
    if (
      clip.kind === 'shape' &&
      clip.pathAnim &&
      Array.isArray(clip.points) &&
      clip.points.length >= 2
    ) {
      let seq = null;
      try {
        const { renderPathSequence } = require('../shape-motion');
        const psDir = path.join(workDir, 'pathanim');
        fs.mkdirSync(psDir, { recursive: true });
        seq = await renderPathSequence(clip, canvas, psDir, FPS);
      } catch (err) {
        logCaught('render.js:renderProject', err);
        noteDegraded(report, 'pathAnim');
      }
      if (!seq) noteDegraded(report, 'pathAnim');
      if (seq) {
        const from = clipStart;
        const to = clipEndT;
        const animEnd = Math.min(to, from + seq.animTotal);
        const seqIdx = addInput(['-framerate', String(FPS), '-i', seq.pattern]);
        graph.push(`[${seqIdx}:v]format=rgba,setpts=PTS+${from.toFixed(3)}/TB[pseq${txN}]`);
        const mid = `vtx${txN}`;
        graph.push(
          `[${vLabel}][pseq${txN}]overlay=x='${posX}-w/2':y='${posY}-h/2':eof_action=pass:enable='between(t,${from.toFixed(
            3
          )},${animEnd.toFixed(3)})'[${mid}]`
        );
        vLabel = mid;
        txN++;
        if (seq.lastFile && to - animEnd > 0.02) {
          const lastIdx = addInput(['-i', seq.lastFile], `t|${seq.lastFile}`);
          const next2 = `vtx${txN}`;
          graph.push(
            `[${vLabel}][${lastIdx}:v]overlay=x='${posX}-w/2':y='${posY}-h/2':enable='between(t,${animEnd.toFixed(
              3
            )},${to.toFixed(3)})'[${next2}]`
          );
          vLabel = next2;
          txN++;
        }
        continue;
      }
    }

    // 🎬 Kinetic typography: per-char/word/line animált PNG-KÉPSOR (a statikus
    // state-eket felülírja). A beérkező (loop=false) animáció után a beállt
    // teljes szöveg (lastFile) áll ki a klip végéig; a wave (loop=true) a
    // periódust ciklizálja.
    if (clip.kind === 'text' && clip.textMotion) {
      let seq = null;
      try {
        const { renderTextSequence } = require('../text-motion');
        const tmDir = path.join(workDir, 'textmotion');
        fs.mkdirSync(tmDir, { recursive: true });
        seq = await renderTextSequence(clip, canvas, tmDir, FPS);
      } catch (err) {
        logCaught('render.js:renderProject', err);
        noteDegraded(report, 'textMotion'); // → álló szöveg (a normál state-kezelés)
      }
      if (!seq) noteDegraded(report, 'textMotion');
      if (seq) {
        const from = clipStart;
        const to = clipEndT;
        if (seq.loop) {
          const idx = addInput(['-stream_loop', '-1', '-framerate', String(FPS), '-i', seq.pattern]);
          const next = `vtx${txN}`;
          graph.push(
            `[${vLabel}][${idx}:v]overlay=x='${posX}-w/2':y='${posY}-h/2':eof_action=pass:enable='between(t,${from.toFixed(
              3
            )},${to.toFixed(3)})'[${next}]`
          );
          vLabel = next;
          txN++;
        } else {
          const animEnd = Math.min(to, from + seq.animTotal);
          // 1) a beérkező képsor a [from, animEnd] ablakban (setpts a klip elejére)
          const seqIdx = addInput(['-framerate', String(FPS), '-i', seq.pattern]);
          graph.push(`[${seqIdx}:v]format=rgba,setpts=PTS+${from.toFixed(3)}/TB[tseq${txN}]`);
          const mid = `vtx${txN}`;
          graph.push(
            `[${vLabel}][tseq${txN}]overlay=x='${posX}-w/2':y='${posY}-h/2':eof_action=pass:enable='between(t,${from.toFixed(
              3
            )},${animEnd.toFixed(3)})'[${mid}]`
          );
          vLabel = mid;
          txN++;
          // 2) a beállt teljes szöveg a [animEnd, to] ablakban (statikus lastFile)
          if (seq.lastFile && to - animEnd > 0.02) {
            const lastIdx = addInput(['-i', seq.lastFile], `t|${seq.lastFile}`);
            const next = `vtx${txN}`;
            graph.push(
              `[${vLabel}][${lastIdx}:v]overlay=x='${posX}-w/2':y='${posY}-h/2':enable='between(t,${animEnd.toFixed(
                3
              )},${to.toFixed(3)})'[${next}]`
            );
            vLabel = next;
            txN++;
          }
        }
        continue;
      }
      // seq == null (nincs Chromium) → visszaesés a normál state-kezelésre
    }

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
  return vLabel;
}

module.exports = { overlayTexts };

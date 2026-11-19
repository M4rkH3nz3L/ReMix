// 🎧 A hang-filtergraph: kész telefonos keverés VAGY szerveres keverés (videó-hang, hangklipek,
// formáns, harmónia, buszok, sávonkénti sidechain, duck, PiP-hang) az [aout] címkére.
// (A renderProject-ből kiemelve, változatlan tartalommal.)
const { VOICE_ENHANCE, dereverbChain, audioFxChain, panFilter } = require('../voicechain');
const { needsFormantPrep, prepareFormantClip } = require('../formantPrep');
const { hasAudioStream, audioChannelCount } = require('./ffmpeg');
const {
  MONO_TO_STEREO,
  FINE_FRAMES,
  audioSpeed,
  audioSpeedChain,
  edgeFades,
  isDuckTrigger,
  atempoChain,
} = require('./audioTiming');
const { segSourceWindow } = require('./timeline');
const { kfChannelExpr } = require('./keyframeExpr');

/**
 * @param mixPath a telefon kész keverése (vagy null → szerveres keverés)
 * @param audioClips a hang-sávok klipjei
 * @param pipAudio a PiP-videók hangjai (overlayPip)
 */
async function buildAudioGraph(rc, mixPath, audioClips, pipAudio) {
  const { project, segments, total, workDir, graph, addInput } = rc;
  if (mixPath) {
    const mixIn = addInput(['-i', mixPath], 'audiomix');
    graph.push(
      `[${mixIn}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=44100,apad,atrim=end=${total.toFixed(6)}[aout]`
    );
  } else {
    // hang: néma alap + hozzájárulások; a beszéd (videó-hang + voiceover) külön
    // buszra gyűlik, hogy az autoDuck-os zene sidechain-nel halkulhasson alatta
    const audioLabels = ['abase'];
    const speechLabels = [];
    const duckLabels = [];
    // 🎚️ V9: a hangklip-címkék sávja (a sávonkénti sidechain-csoportokhoz)
    const labelTrack = new Map();
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

    // 🎚️ pásztázás: statikus (panFilter) VAGY automáció (pan-kulcskockák → per-frame aeval).
    // A dinamikus balansz ugyanazt a lineáris törvényt követi, mint a statikus panFilter
    // (lg=1-max(0,pan), rg=1-max(0,-pan)), csak a `pan` itt t-függő kifejezés.
    const panChain = (clip, skip) => {
      const pk = clip.keyframes?.pan;
      if (!pk || pk.length === 0) {
        return panFilter(clip.pan);
      }
      const T = skip > 0 ? `(t+${skip.toFixed(3)})` : 't';
      const PAN = kfChannelExpr(pk, clip.pan ?? 0, T);
      return (
        `aformat=channel_layouts=stereo,` +
        `aeval='val(0)*(1-max(0,${PAN}))|val(1)*(1-max(0,-(${PAN})))':c=stereo,`
      );
    };

    for (const seg of segments) {
      if (seg.kind !== 'video' || !hasAnyVolume(seg.clip)) {
        continue;
      }
      const clip = seg.clip;
      if (!(await hasAudioStream(clip.uri))) {
        continue;
      }
      const idx = addInput(['-i', clip.uri], `v|${clip.uri}`);
      const { srcStart, srcEnd } = segSourceWindow(clip, seg);
      const videoMono = (await audioChannelCount(clip.uri)) === 1;
      const delayMs = Math.round((clip.start + seg.skip) * 1000);
      const label = `av${audioIdx++}`;
      graph.push(
        `[${idx}:a]atrim=start=${srcStart.toFixed(3)}:end=${srcEnd.toFixed(3)},` +
          (clip.reversed ? 'areverse,' : '') + // ⏪ a trimmelt hang-ablak megfordítása
          `asetpts=PTS-STARTPTS,` +
          (videoMono ? MONO_TO_STEREO : '') + // a monó videóhang is teljes szinten, mint az élő lejátszóban
          // ⚠️ 1-es sebességnél NINCS atempo: a WSOLA-szűrő 1,0-n sem semleges (mérve: 287 minta =
          // 6,5 ms késés + mintaszintű átdolgozás) — a videó hangja eltolódott és torzult
          (clip.speed !== 1 ? `${atempoChain(clip.speed)},` : '') +
          (clip.deReverb ? DEREVERB : '') +
          (clip.voiceEnhance ? VOICE_ENHANCE : '') +
          ((clip.keyframes?.volume ?? []).length > 0 ? FINE_FRAMES : '') +
          `${volumeExpr(clip, seg.skip)},` +
          `aresample=44100,adelay=${delayMs}|${delayMs}[${label}]`
      );
      speechLabels.push(label);
    }

    // 🎚️ klip → sáv-típus térkép a sávonkénti mixer-gainhez (fader)
    const clipTrackType = {};
    for (const tr of project.tracks) {
      for (const c of tr.clips) {
        clipTrackType[c.id] = tr.type;
      }
    }
    const clipFades = edgeFades(project);
    // 🎚️ sidechain-duck trigger-sáv (AudioMaster.duckTrigger); hiányzó = voiceover-viselkedés
    const duckTrigger = project.audioMaster?.duckTrigger;
    for (const clip of audioClips) {
      if (!hasAnyVolume(clip)) {
        continue;
      }
      if (!(await hasAudioStream(clip.uri))) {
        continue;
      }
      const delayMs = Math.round(clip.start * 1000);
      const label = `aa${audioIdx++}`;
      // 🎚️ a forráson belüli kezdet (trimIn) → atrim=start; a szegmens ennyitől
      // szól `duration` hosszan (a fade-ek az asetpts után 0-tól számolnak)
      const aTrimIn = clip.trimIn || 0;
      // sávonkénti mixer-gain (fader) — a klip sávjának gainje (hiányzó = 1)
      const trackGain = project.trackMix?.[clipTrackType[clip.id]]?.gain ?? 1;
      // 🗣️ V7.3: formáns-megőrző hangmagasság — a klip ablaka (vágás, irány, sebesség, hangmagasság + korrekció)
      // előre kirenderelve; a lánc ebből a fájlból indul, a hangmagasság nélküli effektekkel
      const windowFilter =
        `atrim=start=${aTrimIn.toFixed(3)}:end=${(aTrimIn + clip.duration * audioSpeed(clip)).toFixed(3)},` +
        (clip.reversed ? 'areverse,' : '') +
        `asetpts=PTS-STARTPTS,` +
        audioSpeedChain(clip);
      const formantFile = needsFormantPrep(clip, clip.audioFx?.pitchSemitones)
        ? await prepareFormantClip({ uri: clip.uri, windowFilter, semitones: Math.round(clip.audioFx.pitchSemitones), duration: clip.duration, workDir, key: clip.id })
        : null;
      const idx = formantFile ? addInput(['-i', formantFile], `f|${clip.id}`) : addInput(['-i', clip.uri], `a|${clip.uri}`);
      const mono = !formantFile && (await audioChannelCount(clip.uri)) === 1;
      let chain = formantFile
        ? `[${idx}:a]asetpts=PTS-STARTPTS,` +
          (clip.deReverb ? DEREVERB : '') +
          (clip.voiceEnhance ? VOICE_ENHANCE : '') +
          audioFxChain({ ...clip.audioFx, pitchSemitones: 0 }) +
          panChain(clip, 0) +
          ((clip.keyframes?.volume ?? []).length > 0 ? FINE_FRAMES : '') +
          volumeExpr(clip, 0) +
          (trackGain !== 1 ? `,volume=${trackGain.toFixed(3)}` : '')
        :
        // 🔁 loop-klip: a hurok-szakasz ismétlődik (aloop), majd a klip hosszára vágva
      (clip.loopLength > 0
        ? `[${idx}:a]aresample=44100,atrim=start=${aTrimIn.toFixed(6)}:end=${(aTrimIn + clip.loopLength).toFixed(6)},asetpts=PTS-STARTPTS,aloop=loop=-1:size=${Math.round(clip.loopLength * 44100)},atrim=start=${(clip.loopOffset || 0).toFixed(6)}:end=${((clip.loopOffset || 0) + clip.duration).toFixed(6)},`
        : `[${idx}:a]atrim=start=${aTrimIn.toFixed(3)}:end=${(aTrimIn + clip.duration * audioSpeed(clip)).toFixed(3)},`) +
          (clip.reversed ? 'areverse,' : '') + // ⏪ a hang-ablak megfordítása
          `asetpts=PTS-STARTPTS,` +
        audioSpeedChain(clip) +
        (mono ? MONO_TO_STEREO : '') +
        (clip.deReverb ? DEREVERB : '') +
        (clip.voiceEnhance ? VOICE_ENHANCE : '') +
        // 🎛️ granuláris Pro-audio FX (EQ/HPF/LPF/komp/limiter/de-esser/denoise/reverb/delay/normalize)
        audioFxChain(clip.audioFx) +
        panChain(clip, 0) +
        ((clip.keyframes?.volume ?? []).length > 0 ? FINE_FRAMES : '') +
        volumeExpr(clip, 0) +
        (trackGain !== 1 ? `,volume=${trackGain.toFixed(3)}` : '');
      const fades = clipFades[clip.id] ?? { in: clip.fadeIn, out: clip.fadeOut };
      if (fades.in > 0) {
        chain += `,afade=t=in:st=0:d=${fades.in.toFixed(4)}`;
      }
      if (fades.out > 0) {
        chain += `,afade=t=out:st=${Math.max(0, clip.duration - fades.out).toFixed(4)}:d=${fades.out.toFixed(4)}`;
      }
      chain += `,aresample=44100,adelay=${delayMs}|${delayMs}[${label}]`;
      graph.push(chain);
      const isTrigger = isDuckTrigger(clip, clipTrackType[clip.id], duckTrigger);
      const pushToBus = (lbl) => {
        labelTrack.set(lbl, clipTrackType[clip.id]);
        if (isTrigger) {
          speechLabels.push(lbl);
        } else if (clip.autoDuck) {
          duckLabels.push(lbl);
        } else {
          audioLabels.push(lbl);
        }
      };
      pushToBus(label);

      // 🎵 HARMÓNIA-hang (AUDIOT §5): a klip MELLÉ egy félhang-intervallummal eltolt, halkabb
      // másodhang (külön dekód → ugyanaz a test + kombinált pitch-eltolás → a száraz busz). A
      // teljes eltolás (klip-pitch + harmónia) ±12-re szorítva, hogy az atempo biztonságos maradjon.
      const harm = clip.audioFx?.harmony;
      if (harm && Math.round(harm) !== 0) {
        const hlabel = `ah${audioIdx++}`;
        const total = Math.max(-12, Math.min(12, Math.round(clip.audioFx.pitchSemitones || 0) + Math.round(harm)));
        const hFx = { ...clip.audioFx, pitchSemitones: total, harmony: 0 };
        // 🗣️ V7.3: a harmónia-hang is formáns-korrigálva, ha a klipen be van kapcsolva
        const hFile = needsFormantPrep(clip, total)
          ? await prepareFormantClip({ uri: clip.uri, windowFilter, semitones: total, duration: clip.duration, workDir, key: `${clip.id}_harm` })
          : null;
        const idx2 = hFile ? addInput(['-i', hFile], `fh|${clip.id}`) : addInput(['-i', clip.uri], `harm|${clip.uri}`);
        let hchain = hFile
          ? `[${idx2}:a]asetpts=PTS-STARTPTS,` +
            (clip.deReverb ? DEREVERB : '') +
            (clip.voiceEnhance ? VOICE_ENHANCE : '') +
            audioFxChain({ ...hFx, pitchSemitones: 0 }) +
            panChain(clip, 0) +
            volumeExpr(clip, 0) +
            `,volume=0.7` +
            (trackGain !== 1 ? `,volume=${trackGain.toFixed(3)}` : '')
          :
          `[${idx2}:a]atrim=start=${aTrimIn.toFixed(3)}:end=${(aTrimIn + clip.duration * audioSpeed(clip)).toFixed(3)},` +
          (clip.reversed ? 'areverse,' : '') + // ⏪ a hang-ablak megfordítása
          `asetpts=PTS-STARTPTS,` +
          audioSpeedChain(clip) +
          (clip.deReverb ? DEREVERB : '') +
          (clip.voiceEnhance ? VOICE_ENHANCE : '') +
          audioFxChain(hFx) +
          panChain(clip, 0) +
          volumeExpr(clip, 0) +
          `,volume=0.7` + // a harmónia halkabb (háttér-réteg)
          (trackGain !== 1 ? `,volume=${trackGain.toFixed(3)}` : '');
        if (clip.fadeIn > 0) {
          hchain += `,afade=t=in:st=0:d=${clip.fadeIn.toFixed(3)}`; // a harmónia-hang a felhasználói fade-et követi
        }
        if (clip.fadeOut > 0) {
          hchain += `,afade=t=out:st=${Math.max(0, clip.duration - clip.fadeOut).toFixed(3)}:d=${clip.fadeOut.toFixed(3)}`;
        }
        hchain += `,aresample=44100,adelay=${delayMs}|${delayMs}[${hlabel}]`;
        graph.push(hchain);
        pushToBus(hlabel);
      }
    }

    // 🎚️ V9.2: küldések és effekt-buszok (a kliens `mixRange` tükre): a sáv jele a fader UTÁN, a halkítás ELŐTT
    // ágazik a buszokra (küldés-mértékkel); a busz a saját effekt-láncán és a visszatérő szintjén át a master elé
    {
      const buses = (project.audioBuses || []).filter((b) => b && b.id);
      if (buses.length > 0) {
        const sends = project.audioSends || {};
        const busIns = new Map(buses.map((b) => [b.id, []]));
        const renamed = new Map();
        for (const [lbl, tr] of [...labelTrack]) {
          const sv = sends[tr] || {};
          const active = buses.filter((b) => Number(sv[b.id]) > 0);
          if (active.length === 0) continue;
          const main = `${lbl}_s`;
          const outs = [main, ...active.map((_, k) => `${lbl}_b${k}`)];
          graph.push(`[${lbl}]asplit=${outs.length}${outs.map((o) => `[${o}]`).join('')}`);
          active.forEach((b, k) => {
            graph.push(`[${lbl}_b${k}]volume=${Number(sv[b.id]).toFixed(4)}[${lbl}_bv${k}]`);
            busIns.get(b.id).push(`${lbl}_bv${k}`);
          });
          for (const arr of [audioLabels, speechLabels, duckLabels]) {
            const i = arr.indexOf(lbl);
            if (i >= 0) arr[i] = main;
          }
          renamed.set(lbl, main);
        }
        for (const [from, to] of renamed) {
          const tr = labelTrack.get(from);
          labelTrack.delete(from);
          labelTrack.set(to, tr);
        }
        buses.forEach((b, bi) => {
          const ins = busIns.get(b.id);
          if (ins.length === 0) return;
          const mixed = ins.length > 1 ? (graph.push(`${ins.map((l) => `[${l}]`).join('')}amix=inputs=${ins.length}:duration=longest:normalize=0[busm${bi}]`), `busm${bi}`) : ins[0];
          const fx = audioFxChain(b.fx || {}).replace(/^,+|,+$/g, '');
          const g = Math.max(0, Math.min(1, Number(b.gain) || 0));
          graph.push(`[${mixed}]aformat=sample_fmts=fltp:channel_layouts=stereo${fx ? `,${fx}` : ''},volume=${g.toFixed(4)}[bus${bi}]`);
          audioLabels.push(`bus${bi}`);
        });
      }
    }

    // 🎚️ V9: sávonkénti sidechain (a kliens `offlineMixPlan.sidechains` + `mixRange` tükre): a célsáv klipjei egy
    // sínre, a forrás jele szétválik (a saját helyére + csoportonként egy kulcs-másolat), sidechaincompress
    // a régi halkítás paramétereivel (0,02 / 25 ms / 350 ms) és a sáv arányával; a célsáv a régi halkításból kimarad
    {
      const tracksWith = new Set(labelTrack.values());
      const groups = [];
      for (const [target, mix] of Object.entries(project.trackMix || {})) {
        const sc = mix && mix.sidechain;
        if (!sc || sc.from === target || !tracksWith.has(target) || !tracksWith.has(sc.from)) continue;
        groups.push({ target, from: sc.from, ratio: Math.max(2, Math.min(20, Number(sc.ratio) || 2)) });
      }
      if (groups.length > 0) {
        const lists = [audioLabels, speechLabels, duckLabels];
        const current = new Map();
        const cur = (l) => current.get(l) || l;
        const take = (l) => {
          for (const arr of lists) {
            const i = arr.indexOf(l);
            if (i >= 0) {
              arr.splice(i, 1);
              return;
            }
          }
        };
        const keyCopies = groups.map(() => []);
        for (const [lbl, tr] of labelTrack) {
          const using = groups.map((g, gi) => (g.from === tr ? gi : -1)).filter((gi) => gi >= 0);
          if (using.length === 0) continue;
          const main = `${lbl}_m`;
          const outs = [main, ...using.map((gi) => `${lbl}_k${gi}`)];
          graph.push(`[${lbl}]asplit=${outs.length}${outs.map((o) => `[${o}]`).join('')}`);
          for (const arr of lists) {
            const i = arr.indexOf(lbl);
            if (i >= 0) arr[i] = main;
          }
          current.set(lbl, main);
          using.forEach((gi) => keyCopies[gi].push(`${lbl}_k${gi}`));
        }
        groups.forEach((g, gi) => {
          const targets = [...labelTrack].filter(([, tr]) => tr === g.target).map(([l]) => cur(l));
          targets.forEach(take);
          const mixOf = (ls, name) => (ls.length > 1 ? (graph.push(`${ls.map((l) => `[${l}]`).join('')}amix=inputs=${ls.length}:duration=longest:normalize=0[${name}]`), name) : ls[0]);
          const inL = mixOf(targets, `scin${gi}`);
          const keyL = mixOf(keyCopies[gi], `sck${gi}`);
          graph.push(`[${inL}]aformat=sample_fmts=fltp:channel_layouts=stereo[scinf${gi}]`);
          graph.push(`[${keyL}]aformat=sample_fmts=fltp:channel_layouts=stereo,apad[sckp${gi}]`);
          graph.push(`[scinf${gi}][sckp${gi}]sidechaincompress=threshold=0.02:ratio=${g.ratio}:attack=25:release=350[scout${gi}]`);
          audioLabels.push(`scout${gi}`);
        });
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
      const tempo = pa.speed !== 1 && pa.speed >= 0.5 && pa.speed <= 2 ? `,atempo=${pa.speed}` : '';
      graph.push(
        `[${pa.idx}:a]${pa.reversed ? 'areverse,' : ''}asetpts=PTS-STARTPTS${tempo},adelay=${ms}|${ms},volume=${pa.volume}[pipa${k}]`
      );
      audioLabels.push(`pipa${k}`);
    }

    graph.push(
      `${audioLabels.map((l) => `[${l}]`).join('')}amix=inputs=${audioLabels.length}:duration=first:normalize=0[aout]`
    );
  }
}

module.exports = { buildAudioGraph };

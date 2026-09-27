// 🎙️ Voice Studio hang-láncok — KÖZÖS a render és az előnézeti proxy közt.
//
// Ez azért van külön modulban, mert az előnézeti proxynak PONTOSAN ugyanazt a
// feldolgozást kell adnia, mint a végső rendernek. Ha a két lánc külön élne,
// előbb-utóbb szétcsúsznának, és a felhasználó mást hallana az előnézetben,
// mint az exportált videóban — ez a funkció épp ezt hivatott megszüntetni.
const fs = require('fs');
const path = require('path');

/**
 * Beszéd-javító lánc (P0‑9): zajszűrés, sziszegés-vágás, kompresszor és
 * −16 LUFS loudness. A klip hangereje a lánc UTÁN skáláz.
 * Vesszőre végződik, mert a hívó további szűrőket fűz mögé.
 */
const VOICE_ENHANCE =
  'highpass=f=75,afftdn=nf=-28,deesser,' +
  'acompressor=threshold=-18dB:ratio=3:attack=5:release=150,' +
  'loudnorm=I=-16:TP=-1.5:LRA=11,';

const RNNOISE = path.join(__dirname, 'models', 'rnnoise-std.rnnn');

/**
 * De-reverb: RNNoise-modell (ha megvan) + kapuzás a lecsengő farokra + a
 * „dobozos" alsó-közép sáv visszavétele. A modell nélkül a kapu+EQ önmagában
 * is sokat javít, ezért a hiánya nem hiba.
 */
function dereverbChain() {
  return (
    (fs.existsSync(RNNOISE) ? `arnndn=m='${RNNOISE}':mix=0.75,` : '') +
    'agate=threshold=0.02:ratio=2.5:attack=8:release=90,' +
    'equalizer=f=300:t=q:w=1.2:g=-3,'
  );
}

/**
 * A klip beállításaihoz tartozó teljes lánc (záró vessző nélkül).
 * Üres string = nincs feldolgozás.
 */
function voiceChain({ voiceEnhance, deReverb }) {
  const chain =
    (deReverb ? dereverbChain() : '') + (voiceEnhance ? VOICE_ENHANCE : '');
  return chain.replace(/,$/, '');
}

/**
 * 🎛️ Granuláris Pro-audio effekt-lánc a klip `audioFx` beállításaiból (P0-audio).
 * A `voiceEnhance`/`deReverb` egygombos csomag MELLETT/HELYETT ad kézi vezérlést.
 * Vesszőre végződik (a hívó további szűrőket fűz mögé); üres string = nincs FX.
 * Sorrend: szűrők → zaj/sziszegés → dinamika → tér → normalizálás → limiter.
 */
function audioFxChain(fx) {
  if (!fx) {
    return '';
  }
  const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const parts = [];
  if (fx.highpass > 0) {
    parts.push(`highpass=f=${Math.round(clampN(fx.highpass, 20, 2000))}`);
  }
  if (fx.lowpass > 0) {
    parts.push(`lowpass=f=${Math.round(clampN(fx.lowpass, 1000, 20000))}`);
  }
  if (fx.eq) {
    const g = (v) => clampN(v || 0, -12, 12);
    if (g(fx.eq.low)) {
      parts.push(`equalizer=f=100:t=q:w=1:g=${g(fx.eq.low)}`);
    }
    if (g(fx.eq.mid)) {
      parts.push(`equalizer=f=1000:t=q:w=1:g=${g(fx.eq.mid)}`);
    }
    if (g(fx.eq.high)) {
      parts.push(`equalizer=f=8000:t=q:w=1:g=${g(fx.eq.high)}`);
    }
  }
  if (fx.denoise) {
    parts.push('afftdn=nf=-25');
  }
  if (fx.deEsser) {
    parts.push('deesser');
  }
  if (fx.compressor) {
    parts.push('acompressor=threshold=-18dB:ratio=3:attack=5:release=150');
  }
  if (fx.reverb > 0) {
    const a = clampN(fx.reverb, 0, 1);
    const dec = (0.3 + a * 0.5).toFixed(2);
    // két korai visszaverődés — enyhe terem-hatás
    parts.push(`aecho=0.8:0.9:40|75:${dec}|${(dec * 0.7).toFixed(2)}`);
  }
  if (fx.delay > 0) {
    const a = clampN(fx.delay, 0, 1);
    parts.push(`aecho=0.8:0.6:${Math.round(120 + a * 380)}:${(0.2 + a * 0.5).toFixed(2)}`);
  }
  if (fx.normalize) {
    parts.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  }
  if (fx.limiter) {
    parts.push('alimiter=limit=0.95');
  }
  const s = parts.join(',');
  return s ? s + ',' : '';
}

/**
 * Sztereó pásztázás a klip `pan` értékéből (−1 bal … 1 jobb). A mono forrást is
 * sztereóvá alakítja (aformat), különben a `c1` csatorna hiányozna. Vesszőre
 * végződik; 0/hiányzó = nincs pásztázás.
 */
function panFilter(pan) {
  if (!pan) {
    return '';
  }
  const p = Math.max(-1, Math.min(1, pan));
  const lg = (1 - Math.max(0, p)).toFixed(3);
  const rg = (1 - Math.max(0, -p)).toFixed(3);
  return `aformat=channel_layouts=stereo,pan=stereo|c0=${lg}*c0|c1=${rg}*c1,`;
}

// ── 🎚️ Projekt-szintű MASTER (AUDIO-MASTER) — KÉTMENETES, EQ + multiband ──────
// A hiteles mastering: (1) EQ + multiband kompresszió a keverékre, (2) loudnorm
// MÉRÉS, (3) a mért értékekkel `linear=true` loudnorm (PONTOS cél-LUFS/TP), (4)
// alimiter biztonsági plafon. A mérés+alkalmazás a renderben (render.js) fut; itt
// a MÉRÉS ELŐTTI gráfot (EQ+multiband) építjük, hogy a loudnorm a feldolgozott
// jelet mérje. A `mcompand` vessző-escaping helyett filter_complex 3-sávos
// `acompressor` (biztonságos).

function masterLra(dynamics) {
  return dynamics === 'natural' ? 11 : dynamics === 'punchy' ? 5 : 7;
}

function dbToLinear(db) {
  return Math.round(Math.pow(10, db / 20) * 1000) / 1000;
}

/** EQ-filterek (bass/equalizer/treble) a nem-nulla sávokra; '' ha mind 0. */
function masterEq(eq) {
  if (!eq) {
    return '';
  }
  const parts = [];
  if (eq.low) {
    parts.push(`bass=g=${eq.low}:f=110`);
  }
  if (eq.mid) {
    parts.push(`equalizer=f=1000:width_type=q:w=1:g=${eq.mid}`);
  }
  if (eq.high) {
    parts.push(`treble=g=${eq.high}:f=8000`);
  }
  return parts.join(',');
}

const COMP = 'acompressor=threshold=-18dB:ratio=2:attack=20:release=250:makeup=1';

/**
 * A MÉRÉS ELŐTTI master-gráf `[0:a]` → `[<out>]`: EQ + (opcionális) 3-sávos
 * multiband kompresszió. A hívó (render.js) fűzi hozzá a loudnorm+alimiter-t
 * (mérő- ill. alkalmazó-menetben). Filter_complex-részlet (`;`-vel tagolva).
 */
function masterGraph(master, out = 'mst') {
  const eq = masterEq(master.eq);
  const eqNode = eq ? `[0:a]${eq}[meq]` : `[0:a]anull[meq]`;
  if (!master.multiband) {
    return `${eqNode};[meq]anull[${out}]`;
  }
  // 3 sáv: mély (<250 Hz) · közép (250–4000) · magas (>4000), sávonként kompresszor
  return (
    `${eqNode};` +
    `[meq]asplit=3[b1][b2][b3];` +
    `[b1]lowpass=f=250,${COMP}[c1];` +
    `[b2]highpass=f=250,lowpass=f=4000,${COMP}[c2];` +
    `[b3]highpass=f=4000,${COMP}[c3];` +
    `[c1][c2][c3]amix=inputs=3:normalize=0[${out}]`
  );
}

module.exports = {
  VOICE_ENHANCE,
  dereverbChain,
  voiceChain,
  audioFxChain,
  panFilter,
  masterGraph,
  masterLra,
  dbToLinear,
  RNNOISE,
};

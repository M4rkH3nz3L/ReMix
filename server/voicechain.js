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

module.exports = { VOICE_ENHANCE, dereverbChain, voiceChain, RNNOISE };

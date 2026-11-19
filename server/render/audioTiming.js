// 🎧 Hang-időzítés: monó-felkeverés, finom keretek, kattogásmentes szél-fade-ek, sebesség/atempo,
// duck-trigger. (A server/render.js-ből kiemelve, változatlan tartalommal.)

// 🎧 A monó forrás mindkét oldalra TELJES szinten (mint az élő lejátszó); az ffmpeg
// alap-felkeverése −3 dB-lel tette, így az export halkabb volt, mint amit a user hallott
const MONO_TO_STEREO = 'pan=stereo|c0=c0|c1=c0,';
// 🎚️ hangerő-automációnál 64 mintás keretek: a `volume` kifejezése keretenként értékelődik
// (alapból ~1024 minta ≈ 23 ms lépcső); így a görbe a klip elejétől 64 mintánként lép —
// ugyanígy, mint a telefonos (offline) keverőben (`src/lib/offlineMix.ts`)
const FINE_FRAMES = 'asetnsamples=n=64:p=0,';

// 🎧 kattogásmentes vágás: a klip széle a hullámforma közepén ugrásszerű → hallható kattanás.
// Ha ott nincs felhasználói fade, 10 ms-os mikro-fade kerül rá — kivéve a kettévágott klip
// illesztését (ugyanaz a forrás folytatódik), ahol a fade beesést adna. A telefonos keverő
// UGYANEZT a szabályt követi (`src/lib/offlineMix.ts` EDGE_FADE_SEC / edgeFades; szerződés-teszt).
const EDGE_FADE_SEC = 0.01; // 44,1 és 48 kHz-en is egész mintaszám (441 / 480)
const EDGE_EPS = 1e-4;

/** klip-id → a ténylegesen alkalmazott { in, out } fade (mp) a hang-sávokon */
/** ⏩ a hangklip sebessége (hiányzó = 1) — a kliens `audioSpeedOf` tükre */
function audioSpeed(clip) {
  return clip.speed > 0 ? clip.speed : 1;
}

/**
 * ⏩ A gyorsított hangklip: a forrás-ablak `duration·speed`, utána hangmagasság-tartó atempo, és
 * a kimenet pontosan `duration` hosszú (az atempo kerekít) — így a további lánc (fade, kulcskocka,
 * pan) idővonal-időben dolgozik. 1× sebességnél üres: a lánc bájtra a régi (WSOLA-késés nélkül).
 */
function audioSpeedChain(clip) {
  const speed = audioSpeed(clip);
  if (speed === 1) {
    return '';
  }
  return `${atempoChain(speed)},apad,atrim=end=${clip.duration.toFixed(4)},asetpts=PTS-STARTPTS,`;
}

/** ✂️ két szomszéd a forrásban is folytatja egymást (a kliens `continuesInSource` tükre) */
function continuesInSource(prev, next) {
  if (!!prev.reversed !== !!next.reversed) {
    return false;
  }
  const loop = prev.loopLength || 0;
  if (loop > 0 || (next.loopLength || 0) > 0) {
    // 🔁 a kettévágott loop-klip: ugyanaz a hurok-ablak, a fázis pontosan folytatódik
    if (loop !== next.loopLength || Math.abs((prev.trimIn || 0) - (next.trimIn || 0)) >= EDGE_EPS) return false;
    const d = Math.abs((prev.loopOffset || 0) + prev.duration - (next.loopOffset || 0)) % loop;
    return d < EDGE_EPS || loop - d < EDGE_EPS;
  }
  const p = prev.trimIn || 0;
  const n = next.trimIn || 0;
  return prev.reversed
    ? Math.abs(n + next.duration * audioSpeed(next) - p) < EDGE_EPS
    : Math.abs(p + prev.duration * audioSpeed(prev) - n) < EDGE_EPS;
}

function edgeFades(project) {
  const out = {};
  for (const track of project.tracks ?? []) {
    const clips = (track.clips ?? []).filter((c) => c.kind === 'audio');
    // ⏩⏪ a forrásban is folytatódó szomszéd (sebesség és irány szerint — a kliens tükre)
    for (const c of clips) {
      const joinedBefore = clips.some(
        (p) => p !== c && p.uri === c.uri && Math.abs(p.start + p.duration - c.start) < EDGE_EPS && continuesInSource(p, c)
      );
      const joinedAfter = clips.some(
        (n) => n !== c && n.uri === c.uri && Math.abs(c.start + c.duration - n.start) < EDGE_EPS && continuesInSource(c, n)
      );
      out[c.id] = {
        in: c.fadeIn > 0 ? c.fadeIn : joinedBefore ? 0 : EDGE_FADE_SEC,
        out: c.fadeOut > 0 ? c.fadeOut : joinedAfter ? 0 : EDGE_FADE_SEC,
      };
    }
  }
  return out;
}

/**
 * 🎚️ sidechain-duck TRIGGER: alapból a voiceover sáv; ha a projekt `duckTrigger` sávot ad meg,
 * AZ a sáv a kulcs (pl. 'sfx' → a zene a hangeffektek alatt duckol). A régi közös `audio`
 * sávon a klip forrása dönt.
 */
function isDuckTrigger(clip, trackType, duckTrigger) {
  if (duckTrigger) {
    return trackType === duckTrigger;
  }
  return trackType === 'voiceover' || (trackType === 'audio' && clip.source === 'voiceover');
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

module.exports = {
  MONO_TO_STEREO,
  FINE_FRAMES,
  EDGE_FADE_SEC,
  EDGE_EPS,
  audioSpeed,
  audioSpeedChain,
  continuesInSource,
  edgeFades,
  isDuckTrigger,
  atempoChain,
};

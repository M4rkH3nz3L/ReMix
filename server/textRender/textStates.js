// ⌨️ Egy szövegklip PNG-állapotai (typewriter-prefixek, karaoke-fázisok, kiemelés) klip-időben.

/** az app palette.accent-je — a karaoke aktív szava ezt kapja */
const ACCENT = '#7c5cff';
/** a kliens gépelés-animációja: 1 karakter / 60 ms */
const TYPEWRITER_CHAR_SEC = 0.06;
const MAX_TYPEWRITER_STEPS = 20;
const MAX_KARAOKE_STATES = 24;

/**
 * Typewriter-fázisok: a szöveg prefixei, a kliens 60 ms/karakter üteméhez
 * időzítve. Hosszú szövegnél legfeljebb MAX_TYPEWRITER_STEPS lépésre bontva.
 * from/to a klip kezdetéhez képesti mp; to=null → a klip végéig.
 */
function typewriterStates(clip) {
  const len = clip.text.length;
  if (len === 0) {
    return null;
  }
  const steps = Math.min(len, MAX_TYPEWRITER_STEPS);
  const states = [];
  let prevChars = 0;
  for (let k = 0; k < steps; k++) {
    const chars = Math.max(1, Math.round((len * (k + 1)) / steps));
    if (chars === prevChars) {
      continue;
    }
    states.push({
      content: { mode: 'plain', text: clip.text.slice(0, chars) },
      from: prevChars * TYPEWRITER_CHAR_SEC,
      to: k === steps - 1 ? null : chars * TYPEWRITER_CHAR_SEC,
    });
    prevChars = chars;
  }
  return states;
}

/**
 * Karaoke-fázisok: a szavak az idő arányában gyulladnak fel (aktív = accent,
 * hátralévő = 45% opacitás) — az app TextOverlay-ével megegyező szabály.
 * Sok szónál csoportosítva, hogy az állapotszám korlátos maradjon.
 */
function karaokeStates(clip) {
  const words = clip.text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  const emphasis = new Set(clip.emphasis ?? []);
  const group = Math.ceil(words.length / MAX_KARAOKE_STATES);
  const stateCount = Math.ceil(words.length / group);
  // 🎤 szó-szintű időzítés (Whisper-igazítás), ha van; enélkül egyenletes
  // elosztás. A `wordAt(i)` a fázis-ablakok határait adja klip-időben.
  const timings =
    Array.isArray(clip.wordTimings) && clip.wordTimings.length === words.length
      ? clip.wordTimings
      : null;
  const per = clip.duration / words.length;
  const wordStart = (i) => (timings ? timings[i].t : i * per);
  const states = [];
  for (let s = 0; s < stateCount; s++) {
    const activeFrom = s * group;
    const activeTo = Math.min(words.length, (s + 1) * group) - 1;
    states.push({
      content: {
        mode: 'words',
        accent: ACCENT,
        words: words.map((word, i) => ({
          word,
          state: i < activeFrom ? 'past' : i <= activeTo ? 'active' : 'next',
          emp: emphasis.has(i),
        })),
      },
      from: wordStart(activeFrom),
      to: s === stateCount - 1 ? null : wordStart(activeTo + 1),
    });
  }
  return states;
}

/** ✨ kiemelt szavak sima (nem animált) feliraton — egyetlen words-állapot */
function emphasisState(clip) {
  const words = clip.text.split(/\s+/).filter(Boolean);
  const emphasis = new Set(clip.emphasis ?? []);
  if (words.length === 0 || emphasis.size === 0) {
    return null;
  }
  return [
    {
      content: {
        mode: 'words',
        accent: ACCENT,
        words: words.map((word, i) => ({ word, state: 'past', emp: emphasis.has(i) })),
      },
      from: 0,
      to: null,
    },
  ];
}

function statesFor(clip) {
  if (clip.animation === 'typewriter') {
    const states = typewriterStates(clip);
    if (states) {
      return states;
    }
  }
  if (clip.animation === 'karaoke') {
    const states = karaokeStates(clip);
    if (states) {
      return states;
    }
  }
  const emp = emphasisState(clip);
  if (emp) {
    return emp;
  }
  return [{ content: { mode: 'plain', text: clip.text }, from: 0, to: null }];
}

module.exports = {
  ACCENT,
  TYPEWRITER_CHAR_SEC,
  MAX_TYPEWRITER_STEPS,
  MAX_KARAOKE_STATES,
  typewriterStates,
  karaokeStates,
  emphasisState,
  statesFor,
};

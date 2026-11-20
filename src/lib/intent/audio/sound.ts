import { AUDIO_FX_PRESETS } from '@/lib/audioFxPresets';
import type { AudioFx } from '@/types/project';
import { num } from '@/lib/intent/audio/text';

/** 🔊 Hangzás-szándékok a tagmondatból: hangerő (dB) és effekt-/EQ-/hangmagasság-változás. */

/** a dB-mennyiség a tagmondatból (előjel az iránytól); `null`: nincs hangerő-szándék */
export function volumeDb(t: string): number | null {
  const down = /\b(halk\w*|lejjebb|csokk\w*|kisebb|quieter|lower|softer|turn( it)? down|reduce|decrease|leiser)\b/.test(t);
  const up = /\b(hangosabb\w*|felhang\w*|hangosit\w*|feljebb|emel\w*|novel\w*|louder|raise|boost|turn( it)? up|increase|lauter)\b/.test(t);
  if (!down && !up) return null;
  const db = t.match(/(\d+(?:[.,]\d+)?)\s*(?:db|decibel)/);
  let amount = db ? num(db[1]) : /\b(kicsit|picit|egy kicsit|slightly|a bit|a little)\b/.test(t) ? 2 : /\b(nagyon|sokkal|much|a lot)\b/.test(t) ? 6 : 3;
  if (/\b(felere|half)\b/.test(t)) amount = 6;
  return down ? -amount : amount;
}

const FX_WORDS: { re: RegExp; key: keyof AudioFx; on: AudioFx }[] = [
  { re: /zeng\w*|\b(reverb\w*|terem\w*)\b|\bhall\b(?=.*\b(auf|die|der|den|dem|mehr|weniger)\b)/, key: 'reverb', on: { reverb: 0.4 } },
  { re: /visszhang\w*|\b(echo\w*|delay\w*|kesleltet\w*)\b/, key: 'delay', on: { delay: 0.35 } },
  { re: /kompress\w*|\bcompress\w*/, key: 'compressor', on: { compressor: true } },
  { re: /zajszur\w*|\b(zajt|zaj|zajos|noise|denoise\w*|zugas\w*|rausch\w*)\b/, key: 'denoise', on: { denoise: true } },
  { re: /\b(de-?ess\w*|sziszeg\w*|sibil\w*|s-hang\w*)\b/, key: 'deEsser', on: { deEsser: true } },
  { re: /\b(normaliz\w*)\b/, key: 'normalize', on: { normalize: true } },
  { re: /\b(limiter\w*|limit\w*)\b/, key: 'limiter', on: { limiter: true } },
  { re: /\b(zajkapu\w*|gate|kapu)\b/, key: 'gate', on: { gate: true } },
  { re: /\b(szelesit\w*|szeles\w*|stereo ?wide\w*|wider|widen)\b/, key: 'stereoWide', on: { stereoWide: true } },
];
export const OFF = /\b(vedd le|vedd ki|kapcsold ki|kikapcs\w*|szedd le|tavolitsd el|torold|remove|turn off|disable|without|nelkul|ne legyen|no more|ki a)\b/;

/** az effekt-szándék: mely mezők változnak (és mire) — `null`: nincs effekt a tagmondatban */
export function fxPatch(t: string): { patch: AudioFx; label: string; off: boolean } | null {
  const off = OFF.test(t);
  const amount = /\b(sok|tobb|eros\w*|nagy|more|lots|heavy|strong)\b/.test(t) ? 0.65 : /\b(keves|kicsi|kicsit|enyhe|light|little|subtle|slight)\b/.test(t) ? 0.2 : null;
  const hit = FX_WORDS.filter((f) => f.re.test(t));
  const patch: AudioFx = {};
  const labels: string[] = [];
  for (const f of hit) {
    labels.push(f.key);
    if (off) (patch as Record<string, unknown>)[f.key] = undefined;
    else if (typeof f.on[f.key] === 'number' && amount !== null) (patch as Record<string, unknown>)[f.key] = f.key === 'delay' ? Math.min(0.6, amount) : amount;
    else Object.assign(patch, f.on);
  }
  // EQ: mély / magas
  const lowWord = /\b(mely\w*|basszus\w*|bass|low end|lows)\b/.test(t);
  const highWord = /\b(magas\w*|fenyes\w*|treble|highs|bright\w*|brilliance)\b/.test(t);
  const dark = /\b(tompa\w*|sotet\w*|darker|duller|muffled)\b/.test(t);
  const eqUp = /\b(emel\w*|tobb|novel\w*|boost|more|add|erosit\w*)\b/.test(t);
  const eqDown = /\b(kevesebb|csokk\w*|vagd|cut|less|reduce|vegy\w* vissza)\b/.test(t) || dark;
  if ((lowWord || highWord || dark) && !hit.length) {
    const d = eqDown ? -3 : eqUp ? 3 : dark ? -3 : 3;
    patch.eq = { low: lowWord ? d : 0, mid: 0, high: highWord || dark ? (dark ? -3 : d) : 0 };
    labels.push('eq');
  }
  const pitch = t.match(/([+-]?\d+)\s*(?:felhang\w*|semitone\w*|half ?steps?)/);
  if (pitch) {
    patch.pitchSemitones = Math.max(-12, Math.min(12, Number(pitch[1])));
    labels.push('pitchSemitones');
  }
  if (labels.length === 0) {
    const preset = /\b(telefon\w*|telephone|phone)\b/.test(t) ? 'phone' : /\b(radio\w*)\b/.test(t) ? 'radio' : /\b(podcast\w*)\b/.test(t) && /\b(hang\w*|voice|sound|preset|stilus\w*)\b/.test(t) ? 'podcast' : null;
    if (preset) {
      const p = AUDIO_FX_PRESETS.find((x) => x.key === preset)!;
      return { patch: { ...p.fx }, label: preset, off: false };
    }
    return null;
  }
  return { patch, label: labels.join('+'), off };
}

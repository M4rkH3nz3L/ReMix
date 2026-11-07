import { NORMALIZE_LUFS } from '@/lib/audioDsp';
import { AUDIO_FX_PRESETS } from '@/lib/audioFxPresets';
import { addMarker, SECTION_KINDS } from '@/lib/audioMarkers';
import { masterPreset } from '@/lib/audioMaster';
import { isAudioTrack } from '@/lib/audioTracks';
import { METERS } from '@/lib/audioTransport';
import { applyCommand, type EditorCommand } from '@/lib/commands';
import type { AudioClip, AudioFx, AudioMasterTarget, Project, TrackType } from '@/types/project';

/**
 * 🎙️🤖 Hang-asszisztens az eszközön (pure): magyar és angol mondatból ellenőrzött parancslista a
 * command buson. Szabály-alapú, nem nyelvi modell: offline, azonnali, iOS-en és Androidon is.
 * Amit nem ért, azt nem találgatja, hanem `unknown`-ként visszaadja. Egy későbbi helyi vagy
 * szerveres modell ugyanerre a lépés-listára fordíthat.
 */

export interface AudioStep {
  /** a lépés leírásának i18n-kulcsa (`studio.audio.assistant.step.*`) és paraméterei */
  key: string;
  params?: Record<string, string | number>;
  commands: EditorCommand[];
}

/** a parancs-buszon kívüli műveletek (munkamenet-állapot vagy meglévő folyamat) */
export type AudioAction =
  | { kind: 'mute' | 'unmute' | 'solo'; track: TrackType }
  | { kind: 'silence' | 'beatSplitBars' | 'beatSplitBeats' | 'check' | 'sync' | 'transcript' | 'mixSuggest' | 'masterAssist' };

export interface AudioIntentResult {
  steps: AudioStep[];
  actions: AudioAction[];
  /** a nem értett mondatrészek (az eredeti alakjukban) */
  unknown: string[];
}

export interface AudioIntentContext {
  project: Project;
  playhead: number;
  selectedClipId: string | null;
  /** a sávok megjelenített neve (az átnevezett sávokra is lehet hivatkozni) */
  trackNames: Partial<Record<TrackType, string>>;
  makeId: (prefix: string) => string;
  /** belső: a szomszéd tagmondat sávjai, ha ebben nincs megnevezve („kompresszort és zengést a beszédre”) */
  inherited?: TrackType[];
}

/** kisbetű, ékezet nélkül */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const quoted = (raw: string) => raw.match(/[„"“']([^„"”“']{1,60})["”“']/)?.[1]?.trim() || null;
const num = (s: string) => Number(s.replace(',', '.'));

/** a mondat tagmondatai (a vessző/pontosvessző és a kötőszavak mentén; az idézet egyben marad) */
export function splitClauses(raw: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  const words = raw.split(/(\s+)/);
  for (const w of words) {
    const q = (w.match(/[„"“”]/g) ?? []).length;
    const bare = norm(w.replace(/[,;.!?]+$/, ''));
    if (!inQuote && ['es', 'majd', 'aztan', 'utana', 'and', 'then', 'und', 'dann'].includes(bare)) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += w;
    if (q % 2 === 1) inQuote = !inQuote;
    if (!inQuote && /[,;]$/.test(w)) {
      parts.push(cur.replace(/[,;]$/, '').trim());
      cur = '';
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

const AUDIO_TRACK_WORDS: [RegExp, TrackType][] = [
  [/\b(zene\w*|music|musik\w*|alap\w*|dal\w*|song)\b/, 'music'],
  [/\b(besz\w*|narr\w*|voice\w*|vo|hangalam\w*|alamond\w*|szoveg\w*|speech|dialog\w*|stimme\w*|sprach\w*|sprecher\w*)\b/, 'voiceover'],
  [/\b(effekt\w*|sfx|hanghatas\w*|zorej\w*|effects?)\b/, 'sfx'],
];
const EXTRA: TrackType[] = ['aux1', 'aux2', 'aux3', 'aux4', 'aux5'];

/** a tagmondatban megnevezett sávok (csak a projektben létező, hangos sávok) */
function tracksIn(t: string, ctx: AudioIntentContext): TrackType[] {
  const exists = (type: TrackType) => ctx.project.tracks.some((tr) => tr.type === type);
  if (/\b(minden sav\w*|osszes sav\w*|mindent|all tracks|everything|every track)\b/.test(t)) {
    return ctx.project.tracks.filter((tr) => isAudioTrack(tr.type) && tr.clips.length > 0).map((tr) => tr.type);
  }
  const out = new Set<TrackType>();
  for (const [type, name] of Object.entries(ctx.trackNames) as [TrackType, string][]) {
    const n = norm(name ?? '');
    if (n.length > 2 && exists(type) && t.includes(n)) out.add(type);
  }
  for (const [re, type] of AUDIO_TRACK_WORDS) if (re.test(t) && exists(type)) out.add(type);
  const nth = t.match(/\b(\d)\.? ?sav\w*|\bsav\w* ?(\d)\b|\btrack ?(\d)\b/);
  if (nth) {
    const n = Number(nth[1] ?? nth[2] ?? nth[3]);
    const type = n >= 4 ? EXTRA[n - 4] : (['music', 'voiceover', 'sfx'] as TrackType[])[n - 1];
    if (type && exists(type)) out.add(type);
  }
  return out.size > 0 ? [...out] : (ctx.inherited ?? []);
}

/** csak a tagmondatban megnevezett sávok (öröklés nélkül) */
const ownTracks = (t: string, ctx: AudioIntentContext) => tracksIn(t, { ...ctx, inherited: [] });

const audioClipsOn = (project: Project, types: TrackType[]): AudioClip[] =>
  project.tracks.filter((t) => types.includes(t.type)).flatMap((t) => t.clips.filter((c): c is AudioClip => c.kind === 'audio'));

const selectedClip = (ctx: AudioIntentContext): AudioClip | null => {
  for (const t of ctx.project.tracks) {
    const c = t.clips.find((x) => x.id === ctx.selectedClipId);
    if (c && c.kind === 'audio') return c;
  }
  return null;
};

/** a célklipek: a megnevezett sávok klipjei, különben a kijelölt klip */
function targetClips(t: string, ctx: AudioIntentContext): AudioClip[] {
  const tracks = tracksIn(t, ctx);
  if (tracks.length > 0) return audioClipsOn(ctx.project, tracks);
  const sel = selectedClip(ctx);
  return sel ? [sel] : [];
}

/** a dB-mennyiség a tagmondatból (előjel az iránytól); `null`: nincs hangerő-szándék */
function volumeDb(t: string): number | null {
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
const OFF = /\b(vedd le|vedd ki|kapcsold ki|kikapcs\w*|szedd le|tavolitsd el|torold|remove|turn off|disable|without|nelkul|ne legyen|no more|ki a)\b/;

/** az effekt-szándék: mely mezők változnak (és mire) — `null`: nincs effekt a tagmondatban */
function fxPatch(t: string): { patch: AudioFx; label: string; off: boolean } | null {
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

// a platformnév magyar toldalékkal is („youtube-ra”, egybeírva „youtubera”)
const TARGETS: [RegExp, AudioMasterTarget][] = [
  [/\bspotify\w*/, 'spotify'],
  [/\b(youtube\w*|yt)\b/, 'youtube'],
  [/\b(apple ?music\w*|itunes)\b/, 'appleMusic'],
  [/\btik ?tok\w*/, 'tiktok'],
  [/\b(club|klub\w*|dj)\b/, 'club'],
  [/\bpodcast\w*\b/, 'podcast'],
  [/\b(instagram|reels|social|kozossegi)\b/, 'social'],
  [/\b(video\w*)\b/, 'video'],
];

const SECTIONS: [RegExp, string][] = [
  [/\b(intro)\b/, 'intro'],
  [/\b(elorefren\w*|pre-?chorus)\b/, 'preChorus'],
  [/\b(refren\w*|chorus)\b/, 'chorus'],
  [/\b(verze\w*|verse\w*|strofa\w*)\b/, 'verse'],
  [/\b(hid\w*|bridge)\b/, 'bridge'],
  [/\b(outro|zaras\w*|vege)\b/, 'outro'],
];

/** számszavak (hu/en/de, 1–12) → számjegy, de CSAK mértékegység előtt („hat decibellel” → „6 decibellel”; az „egy kicsit” névelő marad) */
const NUMBER_WORDS: Record<string, number> = {
  // a „hadd” a „hat” gyakori félrehallása a diktálásban
  egy: 1, ket: 2, hadd: 6, ketto: 2, harom: 3, negy: 4, ot: 5, hat: 6, het: 7, nyolc: 8, kilenc: 9, tiz: 10, tizenegy: 11, tizenketto: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eins: 1, zwei: 2, drei: 3, vier: 4, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwolf: 12,
};
export function numberWordsToDigits(t: string): string {
  return t.replace(/\b([a-z]+)\s+(?=(db|decibel\w*|mp\b|masodperc\w*|sec\w*|seconds?\b|sekunde\w*|felhang\w*|semitone\w*|halbton\w*))/g, (m, w: string) =>
    NUMBER_WORDS[w] !== undefined ? `${NUMBER_WORDS[w]} ` : m
  );
}

/**
 * a diktálás félrehallásai ellen: a parancsszavak kanonikus alakja (ékezet nélkül). Egy szó akkor
 * igazodik ide, ha legfeljebb 1 (8+ betűnél 2) betűben tér el, vagy ha két szomszédos darabja
 * együtt adja ki („úszta sd” → „usztasd”). Rövid (5 betűnél kisebb) szót nem javít — a „hall” nem lesz „halk”.
 */
const KEYWORDS = [
  'halkuljon', 'halkitsd', 'halkabban', 'hangositsd', 'hangosabban', 'alatt', 'usztasd', 'beusztatas', 'kiusztatas',
  'zengest', 'visszhangot', 'kompresszort', 'zajszurest', 'normalizalast', 'masterelj', 'beszedre', 'beszedet', 'beszed',
  'zenet', 'zenere', 'effektet', 'effektre', 'masodperc', 'masodperc alatt', 'decibellel', 'tempo', 'markert', 'refren',
  'csendeket', 'ellenorizd', 'nemitsd',
];
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const closest = (w: string): string | null => {
  if (w.length < 5 || KEYWORDS.includes(w)) return null;
  const max = w.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = max + 1;
  for (const k of KEYWORDS) {
    const d = editDistance(w, k, max);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return bestD <= max ? best : null;
};
export function fixDictation(t: string): string {
  const words = t.split(' ');
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[.,!?]+$/, '');
    const glued = i + 1 < words.length ? w + words[i + 1].replace(/[.,!?]+$/, '') : '';
    if (glued && (KEYWORDS.includes(glued) || (glued.length >= 6 && closest(glued) && !KEYWORDS.includes(w)))) {
      out.push(KEYWORDS.includes(glued) ? glued : closest(glued)!);
      i++;
      continue;
    }
    out.push(closest(w) ?? words[i]);
  }
  return out.join(' ');
}

function clause(raw: string, ctx: AudioIntentContext, out: AudioIntentResult): boolean {
  const t = numberWordsToDigits(fixDictation(norm(raw)));
  const project = ctx.project;
  const tracks = tracksIn(t, ctx);

  // folyamatok (a meglévő eszközök)
  if (/\b(csend\w*|silence\w*|holt ?ido\w*|dead air)\b/.test(t)) return out.actions.push({ kind: 'silence' }) > 0;
  if (/\b(utem\w*|bar\w*|beat\w*)\b/.test(t) && /\b(vag\w*|szetvag\w*|darabol\w*|split\w*|cut)\b/.test(t)) {
    return out.actions.push({ kind: /\b(utemresz\w*|beat\w*|negyed\w*)\b/.test(t) ? 'beatSplitBeats' : 'beatSplitBars' }) > 0;
  }
  if (/\b(javasol\w*|mixjavaslat\w*|suggest\w*|tanacs\w*|vorschlag\w*)\b/.test(t) || /\bmix\w* (javit\w*|improve)/.test(t)) return out.actions.push({ kind: 'mixSuggest' }) > 0;
  if (/\b(automatikus\w*|auto|segits\w*|seged\w*|assist\w*)\b/.test(t) && /\b(master\w*|maszter\w*|mastering)\b/.test(t)) return out.actions.push({ kind: 'masterAssist' }) > 0;
  if (/\b(ellenoriz\w*|check|vizsgald|nezd at|prufe\w*|uberprufe\w*)\b/.test(t)) return out.actions.push({ kind: 'check' }) > 0;
  if (/\b(szinkron\w*|sync\w*)\b/.test(t)) return out.actions.push({ kind: 'sync' }) > 0;
  if (/\b(atirat\w*|transcri\w*|szoveges vagas\w*)\b/.test(t)) return out.actions.push({ kind: 'transcript' }) > 0;

  // némítás / szóló (munkamenet-állapot)
  if (/\b(nemit\w*|mute|elnemit\w*)\b/.test(t) && tracks.length > 0) {
    const kind = /\b(vissza|kapcsold be|unmute|ne legyen nemit\w*)\b/.test(t) || /\bunmute\b/.test(t) ? 'unmute' : 'mute';
    for (const tr of tracks) out.actions.push({ kind, track: tr });
    return true;
  }
  if (/\b(szolo|solo)\b/.test(t) && tracks.length === 1) return out.actions.push({ kind: 'solo', track: tracks[0] }) > 0;

  // tempó és ütemjelzés
  const bpm = t.match(/\b(?:tempo\w*|bpm)\D{0,12}(\d{2,3})\b|\b(\d{2,3})\s*bpm\b/);
  if (bpm) {
    const v = Number(bpm[1] ?? bpm[2]);
    out.steps.push({ key: 'bpm', params: { bpm: v }, commands: [{ type: 'SET_BPM', bpm: v }] });
    return true;
  }
  const meter = t.match(/\b(\d{1,2})\s*\/\s*(4|8)\b/);
  if (meter && /\b(utem\w*|meter|time signature|ritmus\w*)\b|^\s*\d/.test(t)) {
    const m = METERS.find((x) => x.beatsPerBar === Number(meter[1]) && x.beatUnit === Number(meter[2]));
    if (m) {
      out.steps.push({ key: 'meter', params: { meter: `${m.beatsPerBar}/${m.beatUnit}` }, commands: [{ type: 'SET_TIME_SIGNATURE', timeSignature: m }] });
      return true;
    }
  }

  // master
  if (/\b(master\w*|maszter\w*|lufs|hangossag\w*|loudness)\b/.test(t)) {
    if (OFF.test(t) || /\b(master|maszter) ki\b/.test(t)) {
      out.steps.push({ key: 'masterOff', commands: [{ type: 'SET_AUDIO_MASTER', audioMaster: null }] });
      return true;
    }
    const lufs = t.match(/(-\s?\d{1,2}(?:[.,]\d)?)\s*lufs/);
    const target = TARGETS.find(([re]) => re.test(t))?.[1];
    const base = target ? masterPreset(target) : masterPreset('custom');
    const m = { ...base, ...(lufs ? { target: 'custom' as const, lufs: Math.max(-30, Math.min(-6, num(lufs[1].replace(/\s/g, '')))) } : {}) };
    if (!target && !lufs) m.lufs = project.audioMaster?.lufs ?? NORMALIZE_LUFS;
    const keep = project.audioMaster?.duckTrigger;
    out.steps.push({ key: 'master', params: { target: target ?? 'custom', lufs: m.lufs }, commands: [{ type: 'SET_AUDIO_MASTER', audioMaster: { ...m, ...(keep ? { duckTrigger: keep } : {}) } }] });
    return true;
  }

  // automatikus halkítás (ducking)
  if (/\b(duck\w*|halkul\w*|lehalkul\w*|bukj\w*)\b/.test(t) || (/\b(alatt|under|while|amikor)\b/.test(t) && /\b(halk\w*|lower|quieter)\b/.test(t) && /\b(besz\w*|voice|speech|narr\w*)\b/.test(t))) {
    const duck = tracks.filter((x) => x !== 'voiceover');
    const types = duck.length > 0 ? duck : (['music'] as TrackType[]);
    const clips = audioClipsOn(project, types);
    if (clips.length === 0) return false;
    const on = !OFF.test(t);
    out.steps.push({ key: on ? 'duckOn' : 'duckOff', params: { tracks: types.map((x) => ctx.trackNames[x] ?? x).join(', ') }, commands: clips.map((c) => ({ type: 'UPDATE_CLIP', clipId: c.id, patch: { autoDuck: on } })) });
    return true;
  }

  // be- / kiúsztatás
  const fadeIn = /\b(beuszt\w*|usztasd be|uszon be|fade ?in|fades? in)\b/.test(t);
  const fadeOut = /\b(kiuszt\w*|usztasd ki|fade ?out|fades? out|lecseng\w*)\b/.test(t);
  if (fadeIn || fadeOut) {
    const clips = targetClips(t, ctx);
    if (clips.length === 0) return false;
    const sec = Number(t.match(/(\d+(?:[.,]\d+)?)\s*(?:mp|s|sec|masodperc\w*|seconds?)\b/)?.[1]?.replace(',', '.') ?? 1);
    const first = clips.reduce((a, b) => (b.start < a.start ? b : a));
    const last = clips.reduce((a, b) => (b.start + b.duration > a.start + a.duration ? b : a));
    const cmds: EditorCommand[] = [];
    if (fadeIn) cmds.push({ type: 'UPDATE_CLIP', clipId: first.id, patch: { fadeIn: Math.min(sec, first.duration / 2) } });
    if (fadeOut) cmds.push({ type: 'UPDATE_CLIP', clipId: last.id, patch: { fadeOut: Math.min(sec, last.duration / 2) } });
    out.steps.push({ key: fadeIn && fadeOut ? 'fadeBoth' : fadeIn ? 'fadeIn' : 'fadeOut', params: { sec }, commands: cmds });
    return true;
  }

  // marker
  if (/\b(marker\w*|jelol\w*|jelzo\w*|jelold|mark)\b/.test(t)) {
    const section = SECTIONS.find(([re]) => re.test(t))?.[1];
    const label = quoted(raw) ?? (section ? `§${section}` : `${Math.floor(ctx.playhead / 60)}:${String(Math.floor(ctx.playhead % 60)).padStart(2, '0')}`);
    const color = SECTION_KINDS.find((k) => k.key === section)?.color;
    const markers = addMarker(project.markers ?? [], { id: ctx.makeId('marker'), time: Math.round(ctx.playhead * 1000) / 1000, label, ...(color ? { color } : {}) });
    out.steps.push({ key: 'marker', params: { label: section ?? label }, commands: [{ type: 'SET_MARKERS', markers }] });
    return true;
  }

  // vágás a lejátszófejnél
  if (/\b(vagd (el|ketté|kette|szet)|vagas itt|split|cut here|szetvag\w*)\b/.test(t)) {
    const sel = selectedClip(ctx);
    if (!sel || ctx.playhead <= sel.start || ctx.playhead >= sel.start + sel.duration) return false;
    out.steps.push({ key: 'split', commands: [{ type: 'SPLIT_CLIP', clipId: sel.id, time: ctx.playhead }] });
    return true;
  }

  // effektek (a megnevezett sávok klipjein, különben a kijelöltön)
  const fx = fxPatch(t);
  if (fx) {
    const clips = targetClips(t, ctx);
    if (clips.length === 0) return false;
    const cmds: EditorCommand[] = clips.map((c) => {
      const next: AudioFx = { ...(c.audioFx ?? {}) };
      for (const [k, v] of Object.entries(fx.patch)) {
        if (v === undefined) delete (next as Record<string, unknown>)[k];
        else (next as Record<string, unknown>)[k] = v;
      }
      if (fx.off && /\beq\b/.test(fx.label)) delete next.eq;
      return { type: 'UPDATE_CLIP', clipId: c.id, patch: { audioFx: next } };
    });
    out.steps.push({ key: fx.off ? 'fxOff' : 'fxOn', params: { fx: fx.label, count: clips.length }, commands: cmds });
    return true;
  }

  // hangerő: a megnevezett sávok szintje, különben a kijelölt klipé
  const db = volumeDb(t);
  const pct = t.match(/(\d{1,3})\s*%/);
  if (db !== null || (pct && /\b(ra|re|to|hangero\w*|volume|szint\w*)\b/.test(t))) {
    if (tracks.length > 0) {
      const cmds: EditorCommand[] = [];
      for (const tr of tracks) {
        const cur = project.trackMix?.[tr]?.gain ?? 1;
        const next = pct ? Number(pct[1]) / 100 : cur * Math.pow(10, db! / 20);
        const g = Math.round(Math.max(0, Math.min(1, next)) * 1000) / 1000;
        if (g !== cur) cmds.push({ type: 'SET_TRACK_GAIN', trackType: tr, gain: g });
      }
      out.steps.push({
        key: cmds.length === 0 ? 'atLimit' : 'trackGain',
        params: { tracks: tracks.map((x) => ctx.trackNames[x] ?? x).join(', '), db: pct ? `${pct[1]}%` : `${db! > 0 ? '+' : ''}${db} dB` },
        commands: cmds,
      });
      return true;
    }
    const sel = selectedClip(ctx);
    if (!sel) return false;
    const next = pct ? Number(pct[1]) / 100 : sel.volume * Math.pow(10, db! / 20);
    const v = Math.round(Math.max(0, Math.min(1, next)) * 1000) / 1000;
    out.steps.push({ key: v === sel.volume ? 'atLimit' : 'clipGain', params: { tracks: sel.label, db: pct ? `${pct[1]}%` : `${db! > 0 ? '+' : ''}${db} dB` }, commands: v === sel.volume ? [] : [{ type: 'UPDATE_CLIP', clipId: sel.id, patch: { volume: v } }] });
    return true;
  }
  return false;
}

/**
 * a Whisper kezdő-promptja a diktáláshoz: a parancsok szókincse (rövid, szakszavas mondatnál a
 * modell enélkül félrehall — mérve: „halkítsd” → „hall kicszd”)
 */
export const ASR_HINT =
  'Hangszerkesztés: zengés, visszhang, kompresszor, zajszűrés, de-esser, normalizálás, halkítsd, hangosítsd, decibel, zene, beszéd, effekt, master, Spotify, YouTube, LUFS, úsztasd be, marker, refrén, csendek, ütem. ' +
  'Audio editing: reverb, echo, compressor, noise reduction, louder, quieter, music, voice, master, fade in, marker, chorus.';

/** a mondat értelmezése: lépések (a command buson, egy undo), műveletek és a nem értett részek */
export function parseAudioIntent(raw: string, ctx: AudioIntentContext): AudioIntentResult {
  const out: AudioIntentResult = { steps: [], actions: [], unknown: [] };
  if (!raw.trim() || raw.length > 500) return out;
  // a diktálásban leszakadó mennyiség („…zenét, hat decibellel”) az előző tagmondathoz tartozik
  const parts = splitClauses(raw).reduce<string[]>((acc, part) => {
    const amountOnly = /^(\S+\s+)?\d*\s*(db|decibel\w*)\b/.test(numberWordsToDigits(norm(part)));
    if (amountOnly && acc.length > 0) acc[acc.length - 1] = `${acc[acc.length - 1]} ${part}`;
    else acc.push(part);
    return acc;
  }, []);
  const own = parts.map((p) => ownTracks(norm(p), ctx));
  /** egy tagmondat értelmezése a megadott állapoton (a sáv nélküli a szomszéd sávját örökli) */
  const one = (text: string, i: number, j: number, project: Project): AudioIntentResult => {
    const r: AudioIntentResult = { steps: [], actions: [], unknown: [] };
    const mine = ownTracks(norm(text), ctx);
    const next = own.slice(j + 1).find((x) => x.length > 0);
    const prev = own.slice(0, i).reverse().find((x) => x.length > 0);
    const inherited = mine.length > 0 ? [] : (next ?? prev ?? []);
    if (!clause(text, { ...ctx, project, inherited }, r)) r.unknown.push(text);
    return r;
  };
  const advance = (project: Project, r: AudioIntentResult) => r.steps.reduce((p, step) => step.commands.reduce((q, cmd) => applyCommand(q, cmd) ?? q, p), project);
  // a diktálás vesszővel szétszabdalhatja a mondatot („Masteray Y-u, YouTubera, és tegyél, markert ide”):
  // a magában nem érthető darab a következővel, különben az előzővel együtt próbálkozik — és csak akkor
  // fogadja el az összevonást, ha az maradék nélkül érthető
  const done: { text: string; from: number; to: number; before: Project; r: AudioIntentResult }[] = [];
  let working = ctx.project;
  for (let i = 0; i < parts.length; i++) {
    const r = one(parts[i], i, i, working);
    // csak rövid (≤ 2 szavas) töredék olvadhat össze — egy egész, értelmetlen tagmondatot nem nyelünk el
    const fragment = parts[i].trim().split(/\s+/).length <= 2;
    if (r.unknown.length > 0 && fragment && i + 1 < parts.length) {
      const merged = one(`${parts[i]} ${parts[i + 1]}`, i, i + 1, working);
      if (merged.unknown.length === 0) {
        done.push({ text: `${parts[i]} ${parts[i + 1]}`, from: i, to: i + 1, before: working, r: merged });
        working = advance(working, merged);
        i++;
        continue;
      }
    }
    const last = done[done.length - 1];
    if (r.unknown.length > 0 && fragment && last && last.r.unknown.length === 0) {
      const merged = one(`${last.text} ${parts[i]}`, last.from, i, last.before);
      // visszafelé csak akkor, ha a töredék valamit hozzátesz (pl. a master célját)
      if (merged.unknown.length === 0 && JSON.stringify(merged.steps) !== JSON.stringify(last.r.steps)) {
        done[done.length - 1] = { text: `${last.text} ${parts[i]}`, from: last.from, to: i, before: last.before, r: merged };
        working = advance(last.before, merged);
        continue;
      }
    }
    done.push({ text: parts[i], from: i, to: i, before: working, r });
    working = advance(working, r);
  }
  for (const d of done) {
    out.steps.push(...d.r.steps);
    out.actions.push(...d.r.actions);
    out.unknown.push(...d.r.unknown);
  }
  return out;
}

/** az összes lépés parancsai egyetlen kötegben (egy visszavonás) */
export const intentCommands = (r: AudioIntentResult): EditorCommand[] => r.steps.flatMap((s) => s.commands);

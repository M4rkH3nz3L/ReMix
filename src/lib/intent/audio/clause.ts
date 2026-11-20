import { NORMALIZE_LUFS } from '@/lib/audioDsp';
import { addMarker, SECTION_KINDS } from '@/lib/audioMarkers';
import { masterPreset } from '@/lib/audioMaster';
import { METERS } from '@/lib/audioTransport';
import type { EditorCommand } from '@/lib/commands';
import type { AudioFx, AudioMasterTarget, TrackType } from '@/types/project';
import { norm, num, quoted } from '@/lib/intent/audio/text';
import { fixDictation, numberWordsToDigits } from '@/lib/intent/audio/dictation';
import { audioClipsOn, selectedClip, targetClips, tracksIn } from '@/lib/intent/audio/tracks';
import { fxPatch, OFF, volumeDb } from '@/lib/intent/audio/sound';
import type { AudioIntentContext, AudioIntentResult } from '@/lib/intent/audio/types';

/** 🧩 Egy tagmondat értelmezése: a szabályok sorrendje a döntés (az első találat nyer). */

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

export function clause(raw: string, ctx: AudioIntentContext, out: AudioIntentResult): boolean {
  const t = numberWordsToDigits(fixDictation(norm(raw)));
  const project = ctx.project;
  const tracks = tracksIn(t, ctx);

  // 🔗 C7: stúdiók közti átadás — „tedd a zenét a videó alá”, „küldd a videóba”, „send it to a new video”
  if (/\b(video\w*|klip\w*)\b/.test(t) && (/\b(ala|under|unter|ins?|to|into)\b/.test(t) || /\b(tedd|tegyed|rakd|kuld\w*|vidd|put|send|add|schick\w*|leg\w*)\b/.test(t))) {
    const target = /\b(uj|new|neue?s?|neuen)\b/.test(t) ? 'new' : /\b(valaszt\w*|melyik\w*|choose|pick|auswahl|auswahlen|wahl\w*)\b/.test(t) ? 'pick' : 'latest';
    return out.actions.push({ kind: 'toVideo', target }) > 0;
  }

  // 🔇 V8: AI-zajszűrés — „AI-zajszűrés a beszédre”, „tisztítsd meg AI-val a hangot”, „AI denoise” (az
  // effekt-zajszűrés elé: az „AI”/„neurális” szó dönt)
  // (a „ki” csak a német „KI”-ként — a magyar „kapcsold ki a zajszűrést” NEM AI-parancs)
  const aiWord = /\b(ai|mi|neuralis\w*|neural\w*)\b/.test(t) || (/\bki\b/.test(t) && /\b(rausch\w*|entrausch\w*)\b/.test(t));
  if (aiWord && /\b(zaj\w*|noise|denoise\w*|rausch\w*|entrausch\w*|tisztit\w*|clean\w*)\b/.test(t)) {
    const sel = ctx.selectedClipId ? ctx.project.tracks.find((tr) => tr.clips.some((c) => c.id === ctx.selectedClipId))?.type : undefined;
    const target = tracks.length > 0 ? tracks : sel ? [sel] : ['voiceover' as TrackType];
    return out.actions.push({ kind: 'aiDenoise', tracks: target }) > 0;
  }
  // 🥁 V8: AI-dob — „tegyél alá 4 ütem AI-dobot”, „generálj dobot”, „make an AI drum beat”
  if (/\b(dob\w*|drum\w*|schlagzeug\w*|beat)\b/.test(t) && /\b(ai|mi|general\w*|irj|keszits\w*|tegyel|rakj|adj|add|make|create|erstell\w*|generier\w*)\b/.test(t)) {
    const m = t.match(/\b(\d)\s*(?:utem\w*|bars?|takt\w*)\b/);
    const bars = m ? Math.max(1, Math.min(4, Number(m[1]))) : 4;
    return out.actions.push({ kind: 'aiDrums', bars }) > 0;
  }

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

/** 🧪 Füstteszt — hangfájlok: formátum, címkék, hullámforma, szintmérő, mix-mérés. (Áthelyezve: phases12, phases15; viselkedés-változás nélkül.) */
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache, readFileTags, probeAudioDuration } from '@/lib/media';
import { runDevAction } from '@/lib/devActions';
import { extractVideoAudio } from '@/lib/videoAudioImport';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { smokeFileHost, cloudInThisBuild } from '../../helpers/env';
import type { ReactNode } from 'react';
import { tagLabel } from '@/lib/audioTags';
import { exportAudioFile, isRenderCancelledError, exportAudioToFile } from '@/lib/render';
import { audioExportFileName, audioExportSettings } from '@/lib/audioExportOptions';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { AudioExportSheet } from '@/components/studio/audio/AudioExportSheet';
import { analyzeMixOnDevice } from '@/lib/mixAssistClient';
import { trackLevelAt, levelDb, CLIP_LEVEL } from '@/lib/levelMeter';
import { offlineMixPlan } from '@/lib/offlineMix';
import { type WaveformData, getWaveform, clearWaveformMemory, clipWindowPeaks, WAVEFORM_PPS } from '@/lib/waveform';
import { audioApiState, loadAudioApi, markAudioApi } from '@/lib/audioApiGuard';
import { mixForExport } from '@/lib/audioExportMix';
import { classifyAudioIntake } from '@/lib/audioIntake';
import { toneWav } from '../../helpers/audio';
import '@/lib/dspNativeClient';

/** 🎚️ S16: a hang-formátum a fájl fejlécéből valódi fájlokon (WAV 48 kHz/sztereó/24 bit, videóból kinyert M4A), és a klipszerkesztő mutatja. */
export async function smokeAudioFormat(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const { readFileFormat, assetFormatFields } = await import('@/lib/media');
  // 1) 48 kHz, sztereó, 24 bites WAV (1 s)
  const sr = 48000, ch = 2, n = sr;
  const b = new Uint8Array(44 + n * ch * 3);
  const v = new DataView(b.buffer);
  const txt = (at: number, x: string) => [...x].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 3, true); txt(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 3, true); v.setUint16(32, ch * 3, true); v.setUint16(34, 24, true); txt(36, 'data'); v.setUint32(40, n * ch * 3, true);
  const f = new File(Paths.cache, 'smoke_fmt48.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(b);
  const w = readFileFormat(f.uri);
  log(w.container === 'wav' && w.sampleRate === 48000 && w.channels === 2 && w.bitDepth === 24, 'WAV a fejlécből: 48 kHz, sztereó, 24 bit', JSON.stringify(w));
  // 2) a videóból kinyert M4A (natív kinyerés) — mintavétel és csatornák az mp4a leíróból
  const vid = await downloadToCache(`${smokeFileHost()}/vid_audio.mp4`, 'smoke_fmt_vid.mp4');
  const ex = vid ? await extractVideoAudio(vid, 'smoke_fmt.mp4') : null;
  const m = ex && ex.ok ? readFileFormat(ex.uri) : {};
  let headHex = '-';
  if (ex && ex.ok) {
    const h = new File(ex.uri).open();
    try { headHex = Array.from(h.readBytes(16)).map((x) => x.toString(16).padStart(2, '0')).join(' '); } finally { h.close(); }
  }
  // 2026-11-14: a videóból kinyert hang WAV (mintára pontos, 44,1 kHz, 16 bit) — az mp4a-leíró olvasását a
  // videófájl maga méri tovább
  log(m.container === 'wav' && m.sampleRate === 44100 && m.channels === 2 && m.bitDepth === 16, 'WAV (videóból kinyerve) a fejlécből: 44,1 kHz, sztereó, 16 bit', `${JSON.stringify(m)} · kinyerés ${vid ? (ex && ex.ok ? 'ok' : JSON.stringify(ex)) : 'nincs videó'} · fej ${headHex}`);
  const mv = vid ? readFileFormat(vid) : {};
  log(mv.container === 'm4a' && mv.sampleRate === 48000 && mv.channels === 2, 'a videófájl hangja (mp4a-leíró) a fejlécből: 48 kHz, sztereó', JSON.stringify(mv));
  // 3) a klipszerkesztő mutatja (az asset mezőiből)
  const id = 'prj_smoke_fmt';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fmt', caught));
  const base = createEmptyProject('smoke formátum', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'c', label: 'hang', uri: f.uri, assetId: 'a1', start: 0, duration: 1, trimIn: 0, sourceDuration: 1, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, assets: [{ id: 'a1', kind: 'audio', uri: f.uri, provider: 'local', name: 'hang', duration: 1, ...assetFormatFields(w) }], tracks: base.tracks.map((t) => (t.type === 'music' ? { ...t, clips: [clip] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1000);
  try {
    const a = st().project?.assets.find((x) => x.id === 'a1');
    log(a?.sampleRate === 48000 && a.channels === 2 && a.bitDepth === 24, 'a formátum az asseten megmarad (mentés + betöltés)', JSON.stringify({ sr: a?.sampleRate, ch: a?.channels, bit: a?.bitDepth }));
    st().selectClip('c');
    runDevAction('audio.editClip');
    await sleep(900);
    log(true, 'FOTÓZHATÓ', 'a klipszerkesztő fejlécében: 48 kHz · sztereó · 24 bit');
    await sleep(1500);
    runDevAction('clipEdit.done');
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:fmt-del', caught));
    if (f.exists) f.delete();
  }
}
/** PRO-AUDIO 17/8: élő szintmérő a valódi stúdióban (képernyőkép lejátszás közben). */
export async function smokeAudioMeter(log: Log) {
  const id = 'prj_smoke_audiometer';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:audioMeter', caught));
  const half = toneWav('smoke_meter_half.wav', 6);
  const loud = stereoRightWav('smoke_meter_loud.wav', 6, 0.99, 0);
  const base = createEmptyProject('smoke szintmérő', '9:16', undefined, 'audio');
  const mk = (cid: string, uri: string): AudioClip => ({ kind: 'audio', id: cid, uri, label: cid, start: 0, duration: 6, trimIn: 0, sourceDuration: 6, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' });
  await saveProject({ ...base, id, tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [mk('fel', half)] } : tr.type === 'sfx' ? { ...tr, clips: [mk('hangos1', loud), mk('hangos2', loud)] } : tr)) });
  router.push(`/studio/audio/${id}` as Href);
  for (let i = 0; i < 60 && useEditorStore.getState().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1500);
  useEditorStore.getState().setPlayhead(0);
  useEditorStore.getState().setPlaying(true);
  await sleep(2000);
  const p = useEditorStore.getState().project!;
  const plan = offlineMixPlan(p);
  const waves = new Map<string, WaveformData>();
  for (const u of [half, loud]) {
    const w = await getWaveform(u, { userInitiated: true });
    if (w) waves.set(u, w);
  }
  const t = useEditorStore.getState().playhead;
  const music = trackLevelAt(plan.clips.filter((c) => c.track === 'music'), (u) => waves.get(u), t);
  const sfx = trackLevelAt(plan.clips.filter((c) => c.track === 'sfx'), (u) => waves.get(u), t);
  log(Math.abs(levelDb(music) + 6.2) < 1, 'zene-sáv szintje', `${levelDb(music).toFixed(1)} dB`);
  log(sfx >= CLIP_LEVEL, 'effekt-sáv túlvezérelt', `${levelDb(sfx).toFixed(1)} dB`);
  log(true, 'FOTÓZHATÓ', 'a szintmérők lejátszás közben');
  await sleep(2500);
  useEditorStore.getState().setPlaying(false);
  router.back();
  await sleep(800);
  await deleteProject(id);
  new File(half).delete();
  new File(loud).delete();
}
/** PRO-AUDIO 17/1: a címke a fájl VÉGÉN (WAV LIST/INFO a data után) — a telefonos fájlolvasással. */
export async function smokeAudioTags(log: Log) {
  const uri = toneWav('smoke_tags.wav', 1);
  const enc = (str: string) => Array.from(unescape(encodeURIComponent(str)), (ch) => ch.charCodeAt(0));
  const sub = (id: string, text: string) => {
    const v = [...enc(text), 0];
    if (v.length % 2) v.push(0);
    const n = v.length;
    return [...enc(id), n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24, ...v];
  };
  const info = [...enc('INFO'), ...sub('INAM', 'Őszi éjszaka'), ...sub('IART', 'Kovács Béla')];
  const list = [...enc('LIST'), info.length & 255, (info.length >> 8) & 255, 0, 0, ...info];
  const file = new File(uri);
  const old = file.bytesSync();
  const out = new Uint8Array(old.length + list.length);
  out.set(old, 0);
  out.set(list, old.length);
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  file.write(out);
  const tags = readFileTags(uri);
  log(tags.title === 'Őszi éjszaka' && tags.artist === 'Kovács Béla', 'a fájl végén lévő címke a telefonon kiolvasva', JSON.stringify(tags));
  log(tagLabel(tags, 'smoke_tags.wav') === 'Kovács Béla – Őszi éjszaka', 'a klip neve a címkéből', tagLabel(tags, 'smoke_tags.wav'));
  file.delete();
}
/** 16 bites sztereó WAV: bal csatorna csend, jobb csatornán szinusz `amp` szinttel, `from` mp-től. */
function stereoRightWav(name: string, seconds: number, amp: number, from: number): string {
  const rate = 44100;
  const samples = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + samples * 4);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => [...value].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 4, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 4, true);
  for (let i = 0; i < samples; i++) {
    const v = i / rate >= from ? Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amp * 32767) : 0;
    view.setInt16(44 + i * 4 + 2, v, true);
  }
  const file = new File(Paths.document, name);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
  return file.uri;
}
/** A20: új munkamenetben a háttér-hullámforma a korábbi bizonyításon múlik (`reset` törli). */
export async function smokeWaveformBackground(log: Log, reset: boolean) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  if (reset) {
    for (const name of Paths.document.list().map((e) => e.name).filter((n) => n.startsWith('.audioapi-ok-'))) {
      new File(Paths.document, name).delete();
    }
    log(null, 'bizonyítás törölve', 'a következő indítás bizonyítás nélkül fut');
    return;
  }
  const uri = stereoRightWav(`smoke_wavebg_${Date.now().toString(36)}.wav`, 2, 0.5, 0);
  log(null, 'dekóder-állapot az új munkamenet elején', audioApiState());
  const wave = await getWaveform(uri);
  log(null, 'A20 háttér-hullámforma új munkamenetben', wave ? `${wave.peaks.length} csúcs, max ${Math.max(...wave.peaks)}` : 'nincs');
  const studio = await getWaveform(`${uri}`, { userInitiated: true });
  log(!!studio, 'A20 a Hang Stúdió hullámformája bizonyítás nélkül is megjön', studio ? `${studio.peaks.length} csúcs` : 'nincs');
  new File(uri).delete();
}
/** A20/A22/A24 a valódi natív dekóderrel: iOS-en is fut, a jobb csatorna és a vágás számít. */
export async function smokeWaveform(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  clearWaveformMemory();
  // 2 mp csend, majd 2 mp 0.5-ös szinusz CSAK a jobb csatornán
  const uri = stereoRightWav(`smoke_wave_${Date.now().toString(36)}.wav`, 4, 0.5, 2);
  log(null, 'dekóder-állapot indulás előtt', audioApiState());
  const background = await getWaveform(uri);
  log(null, 'háttér-hívás az első dekódolás előtt', background ? 'van hullámforma' : 'nincs (iOS-őr)');
  clearWaveformMemory();
  const started = Date.now();
  const api = await loadAudioApi();
  const decoded = api ? await api.decodeAudioData(uri, 8000) : null;
  log(!!decoded, 'A20 a natív dekóder iOS-en fut, összeomlás nélkül', decoded ? `${decoded.numberOfChannels} csatorna, ${decoded.duration.toFixed(2)} s, ${Date.now() - started} ms` : 'nincs modul');
  if (decoded) {
    markAudioApi(true);
  }
  const wave = await getWaveform(uri);
  log(!!wave, 'A20 a háttér-hívás a bizonyítás után hullámformát ad', wave ? `${wave.peaks.length} csúcs` : 'null');
  if (wave) {
    const head = clipWindowPeaks(wave, 0, 2);
    const tail = clipWindowPeaks(wave, 2, 2);
    const max = (xs: number[]) => Math.max(0, ...xs);
    log(max(head) < 0.02, 'A22 a csendes szakasz csendes', `max ${max(head)}`);
    log(Math.abs(max(tail) - 0.5) < 0.05, 'A24 a csak jobb csatornás jel is látszik, helyes szinten', `max ${max(tail)}`);
    log(tail.length === 2 * WAVEFORM_PPS && head.length === 2 * WAVEFORM_PPS, 'A22 a vágott ablak pontos hosszú', `${head.length} + ${tail.length} csúcs`);
  }
  new File(uri).delete();
}
/** A6 és A19 valódi fájlon: a sérült hang nem kerül be, a mérés a jelenlegi mixet adja. */
export async function smokeAudioMix(log: Log, setHarness: (n: ReactNode) => void) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const uri = toneWav('smoke_tone.wav', 3);
  const broken = new File(Paths.document, 'smoke_broken.mp3');
  if (broken.exists) {
    broken.delete();
  }
  broken.write(new Uint8Array(4096).fill(7));
  const good = await probeAudioDuration(uri);
  log(Math.abs(good - 3) < 0.1, 'A6 az ép hang hossza a fájlból jön', `${good.toFixed(2)} s`);
  const bad = await probeAudioDuration(broken.uri);
  const intake = classifyAudioIntake({ uri: broken.uri, name: 'smoke_broken.mp3', durationSec: bad });
  log(bad === 0 && !intake.ok, 'A6 a sérült fájl nem kerül be', `${bad} s, ok=${intake.ok}`);
  broken.delete();

  const base = createEmptyProject('smoke mix', '1:1', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'smoke-mix-clip', uri, label: 'tone', start: 0, duration: 3, trimIn: 0, sourceDuration: 3, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  const project: Project = {
    ...base,
    tracks: base.tracks.map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr)),
  };
  const measure = async (masterVolume: number) => {
    const mix = mixForExport(project, () => true, masterVolume);
    return mix ? analyzeMixOnDevice(mix) : null;
  };
  const full = await measure(1);
  const half = await measure(0.5);
  log(!!full && Number.isFinite(full.lufs), 'A19 a jelenlegi mix mérhető a telefonról', `${full?.lufs} LUFS`);
  const drop = (full?.lufs ?? 0) - (half?.lufs ?? 0);
  log(Math.abs(drop - 6) < 1, 'A19 a master-hangerő a mért értékben is látszik', `${drop.toFixed(1)} dB esés`);
  log(mixForExport(project, () => false, 1) === null, 'A15 némított projektből nincs export');

  if (!cloudInThisBuild()) {
    log(null, 'A28–A32 szerveres album-export: kimarad', 'ebben a buildben nincs felhő-cím');
    return;
  }
  // A32 album-út: veszteségmentes render, helyi fájlba letöltve (nem lejáró link)
  const url = await exportAudioFile(project, 'flac');
  const local = await downloadToCache(url, 'smoke_album.flac');
  const localDur = local ? await probeAudioDuration(local) : 0;
  log(!!local && local.startsWith('file:') && !local.includes('?t='), 'A32 a szám helyi fájlként marad meg', local?.split('/').pop());
  log(Math.abs(localDur - 3) < 0.1, 'A32 a letöltött FLAC teljes hosszú', `${localDur.toFixed(2)} s`);
  if (local) {
    new File(local).delete();
  }

  // A29: a ✕ a futó exportot leállítja, nem jön kész fájl
  const long: Project = {
    ...project,
    tracks: project.tracks.map((tr) =>
      tr.type === 'music' ? { ...tr, clips: Array.from({ length: 8 }, (_, i) => ({ ...clip, id: `smoke-long-${i}`, start: i * 3 })) } : tr
    ),
  };
  const controller = new AbortController();
  const started = Date.now();
  const pending = exportAudioFile(long, 'wav', undefined, controller.signal);
  setTimeout(() => controller.abort(), 1500);
  const outcome = await pending.then(() => 'kész fájl', (e: Error) => (isRenderCancelledError(e) ? 'megszakítva' : e.message));
  log(outcome === 'megszakítva', 'A29 a megszakítás leállítja az exportot', `${outcome}, ${Date.now() - started} ms`);

  // A28/A31: fájlba exportálás fejléces hitelesítéssel, a kért formátumban
  const target = new File(projectExportDir(), audioExportFileName('Smoke export', 'wav'));
  const saved = await exportAudioToFile(
    project,
    audioExportSettings('wav', { bitrateKbps: 0, bitDepth: 24, sampleRate: 48000, channels: 1 }),
    target
  );
  const size = new File(saved).size ?? 0;
  // 3 s × 48 000 minta × 3 bájt (24 bit, mono) + WAV-fejléc
  const expected = 3 * 48000 * 3;
  log(Math.abs(size - expected) < 2000, 'A31 24 bit 48 kHz mono WAV készült', `${size} bájt (várt ~${expected})`);
  log(saved.includes('/Export/') && saved.endsWith('Smoke_export.wav'), 'A28 a fájl a projekt Export-mappájában van', saved.split('/').slice(-2).join('/'));
  new File(saved).delete();
  new File(uri).delete();

  setHarness(<AudioExportSheet onClose={() => {}} onPreview={() => {}} onUseInVideo={() => {}} onDownload={() => {}} />);
  log(true, 'FOTÓZHATÓ', 'a hangexport-lap a kijelzőn');
  await sleep(5000);
  setHarness(null);
}

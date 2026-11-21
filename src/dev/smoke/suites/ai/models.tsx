/** 🧪 Füstteszt — telefonos AI-modellek: katalógus, letöltés, Whisper-szonda, TTS, dúdolás, AI-dob. (Áthelyezve: phases04, phases05, phases08, phases09, phases14; viselkedés-változás nélkül.) */
import * as Device from 'expo-device';
import { File, Paths } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { runDevAction } from '@/lib/devActions';
import { audioModelDownloads, ensureAudioModel, runAudioModelSmoke } from '@/lib/audioModels';
import { removeModel, catalogRuntime, downloadModel, listCachedModels } from '@/lib/modelRegistryClient';
import { catalogUsable, catalogEntry } from '@/lib/modelCatalog';
import { createEmptyProject } from '@/lib/projectUtils';
import { saveProject, deleteProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { encodeWav16 } from '@/lib/offlineMix';
import { devTypeAssistant } from '@/components/studio/audio/AudioAssistantBar';
import { runWhisperSmokeTest, bestUsableWhisperModelId, transcribeWordsOnDevice, lastRawTokens } from '@/lib/whisperClient';
import { canSpeakOnDevice } from '@/lib/ttsOnDevice';
import { integratedLoudness } from '@/lib/loudness';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { downloadToCache } from '@/lib/media';
import { whisperEngineAvailable } from '@/lib/nativeEngines';
import { decodeToMono16k } from '@/lib/audioDecode';
import { smokeFileHost } from '../../helpers/env';
import '@/lib/dspNativeClient';

/** 📸 V8 fotózható állapotok: a dobgép AI-sora (20 s), utána a klip-szerkesztő AI-zajszűrés része (20 s) */
export async function smokeAiShot(log: Log) {
  const st = useEditorStore.getState;
  const id = `prj_smoke_aishot_${Date.now().toString(36)}`;
  const f = new File(Paths.document, 'smoke_aidenoise_in.wav');
  const base = createEmptyProject('AI-próba', '9:16', undefined, 'audio');
  const clip: AudioClip = { kind: 'audio', id: 'v', uri: f.uri, label: 'beszéd', start: 0, duration: 20, trimIn: 0, sourceDuration: 20, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: f.exists ? [clip] : [] } : t)) });
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    runDevAction('audio.openDrums');
    await sleep(800);
    runDevAction('drums.demo');
    await runDevAction('drums.ai', { mode: 'continue', temp: 'creative', seed: 3 });
    log(true, 'FOTÓZHATÓ-1', 'a dobgép az AI-sorral');
    await sleep(20_000);
    runDevAction('audio.closeDrums');
    await sleep(600);
    st().selectClip('v');
    runDevAction('audio.editClip');
    log(true, 'FOTÓZHATÓ-2', 'a klip-szerkesztő AI-zajszűréssel');
    await sleep(20_000);
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:aishot', caught));
  }
}
/**
 * 🤖 V8: a telefonos hang-AI modellek a gyári katalógusból — törölve → letöltés (sha256) + önellenőrzés (PASS);
 * a második használat NEM tölt le (letöltés után hálózat nélkül, repülő módban is megy).
 */
export async function smokeAiModels(log: Log) {
  log(null, 'eszköz', `${Device.modelName ?? Platform.OS}`);
  const ids = ['rnnoise-v02', 'magenta-drums', 'spleeter-2stems'] as const;
  for (const id of ids) removeModel(id);
  const d0 = audioModelDownloads();
  for (const id of ids) {
    const t0 = Date.now();
    const ok = await ensureAudioModel(id);
    const rt = catalogRuntime();
    log(ok && rt.smoke?.[id] === 'pass' && catalogUsable(catalogEntry(id)!, rt), `${id}: letöltve (sha256), ellenőrizve, használható`, `${Date.now() - t0} ms`);
  }
  const d1 = audioModelDownloads();
  for (const id of ids) await ensureAudioModel(id);
  log(d1 - d0 === 3 && audioModelDownloads() === d1, 'a második használat letöltés nélkül (offline / repülő módban is)', `${d1 - d0} letöltés, utána ${audioModelDownloads() - d1}`);
  const card = await runAudioModelSmoke('rnnoise-v02');
  log(card, 'a Profil-kártya önellenőrzése (ugyanaz a függvény) PASS');
}
/**
 * 🥁 V8: AI-dob — a dobgépben (folytatás / variáció / új groove, a megtartott rész változatlan), a lejátszófejnél az
 * asszisztens („tegyél alá 2 ütem AI-dobot”): szerkeszthető dob-minta szabad sávon, egy undo.
 */
export async function smokeAiDrums(log: Log) {
  const id = `prj_smoke_aidr_${Date.now().toString(36)}`;
  await saveProject({ ...createEmptyProject('smoke AI-dob', '9:16', undefined, 'audio'), id, bpm: 100 });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    // a dobgépben
    runDevAction('audio.openDrums');
    await sleep(800);
    runDevAction('drums.demo');
    await sleep(200);
    const before = String(runDevAction('drums.hits'));
    const t0 = Date.now();
    const n1 = (await runDevAction('drums.ai', { mode: 'continue', temp: 'safe', seed: 3 })) as number;
    const ms = Date.now() - t0;
    await sleep(300);
    const after = String(runDevAction('drums.hits'));
    const firstBarSame = before.split(',').every((h) => after.split(',').includes(h));
    const second = after.split(',').filter((h) => Number(h.replace(/^[a-z]+/, '').split('v')[0]) >= 16);
    log(n1 > 0 && firstBarSame && second.length > 0, 'folytatás: az első ütem változatlan, a második a modellé', `${ms} ms, ${second.length} új ütés (pl. ${second.slice(0, 6).join(',')})`);
    const n2 = (await runDevAction('drums.ai', { mode: 'vary', temp: 'creative', seed: 5 })) as number;
    await sleep(300);
    const vary = String(runDevAction('drums.hits'));
    log(n2 > 0 && before.split(',').every((h) => vary.split(',').includes(h)), 'variáció: az első ütem marad');
    const n3 = (await runDevAction('drums.ai', { mode: 'groove', temp: 'bold', seed: 9 })) as number;
    await sleep(300);
    const groove = String(runDevAction('drums.hits'));
    log(n3 > 0 && groove.includes('kick0'), 'új groove: lábdobbal indul', groove.split(',').slice(0, 8).join(','));
    const undoBake = st().past?.length ?? 0;
    runDevAction('drums.bake');
    for (let i = 0; i < 40 && (st().past?.length ?? 0) === undoBake; i++) await sleep(200);
    log((st().past?.length ?? 0) - undoBake === 1, 'a „Sávra” egy undo-lépés');
    runDevAction('audio.closeDrums');
    await sleep(400);
    // az asszisztens: AI-dob a lejátszófejnél
    // a lejátszófej a projekt hosszán belül (az üres részre nem állítható) — a tényleges értékhez mérünk
    st().setPlayhead(2);
    const ph = st().playhead;
    const undo0 = st().past?.length ?? 0;
    runDevAction('audio.assistant');
    await sleep(400);
    devTypeAssistant('tegyél alá 2 ütem AI-dobot');
    await sleep(400);
    runDevAction('assistant.apply');
    for (let i = 0; i < 60 && (st().past?.length ?? 0) === undo0; i++) await sleep(200);
    const p = st().project!;
    const clip = p.tracks.flatMap((t) => t.clips.map((c) => ({ t, c: c as AudioClip }))).find((x) => Math.abs(x.c.start - ph) < 0.05 && x.c.label === 'AI-dob');
    const doc = clip ? p.instrumentDocs?.find((d) => d.id === clip.c.instrumentDocId) : undefined;
    log(!!doc?.drums && doc.bars === 2 && Math.abs((clip?.c.duration ?? 0) - 4.8) < 0.05 && (st().past?.length ?? 0) - undo0 === 1, 'asszisztens: 2 ütem AI-dob a lejátszófejnél (100 BPM = 4,8 s), szerkeszthető minta, egy undo', `${clip?.t.type} @ ${ph.toFixed(2)} s, ${clip?.c.duration.toFixed(2)} s, ${doc?.drums ? Object.values(doc.drums.pattern).reduce((s, r) => s + r.filter(Boolean).length, 0) : 0} ütés`);
    devTypeAssistant('');
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:aidrums', caught));
  }
}
/**
 * 🎵 V8: dúdolásból dallam — szintetikus „dúdolás” (felharmonikusok, vibrátó, kis szünetek: C4 E4 G4 C5, 120 BPM,
 * negyedenként) egy klipben a 2. mp-nél → a telefon hangjegyekre bontja: szinti-minta a dúdolás kezdeténél,
 * szabad sávon, a hangok és a rács pontosak; egy undo.
 */
export async function smokeHumMelody(log: Log) {
  const SR = 44100;
  const midis = [60, 64, 67, 72];
  const len = 2.2 * SR;
  const x = new Float32Array(len);
  // a vibrátós frekvencia FÁZISA összegezve (a sin(2π·f(t)·t) alak az idővel növekvő hamis eltolást adna)
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const tSec = i / SR;
    const k = Math.floor(tSec / 0.5);
    const inNote = tSec - k * 0.5;
    const f = 440 * Math.pow(2, (midis[Math.min(k, midis.length - 1)] - 69) / 12) * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * tSec));
    ph += (2 * Math.PI * f) / SR;
    if (k >= midis.length || inNote > 0.44) continue;
    const env = Math.min(1, inNote / 0.02, (0.44 - inNote) / 0.02);
    x[i] = env * 0.25 * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph));
  }
  const f = new File(Paths.document, 'smoke_hum.wav');
  if (f.exists) f.delete();
  f.create();
  f.write(encodeWav16([x, x], SR, () => 0.5));
  const id = `prj_smoke_hum_${Date.now().toString(36)}`;
  const base = createEmptyProject('smoke dúdolás', '9:16', undefined, 'audio');
  const hum: AudioClip = { kind: 'audio', id: 'hum', uri: f.uri, label: 'dúdolás', start: 2, duration: 2.2, trimIn: 0, sourceDuration: 2.2, volume: 1, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...base, id, bpm: 120, tracks: base.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [hum] } : t)) });
  const st = useEditorStore.getState;
  try {
    router.push(`/studio/audio/${id}` as Href);
    for (let i = 0; i < 150 && (st().project?.id !== id || runDevAction('audio.studioMode') === undefined); i++) await sleep(200);
    await sleep(800);
    const undoBefore = st().past?.length ?? 0;
    const t0 = Date.now();
    const cid = (await runDevAction('hum.melody', { clipId: 'hum', root: 0, minor: false })) as string | null;
    const ms = Date.now() - t0;
    const p = st().project!;
    const tr = p.tracks.find((t) => t.clips.some((c) => c.id === cid));
    const c = tr?.clips.find((x2) => x2.id === cid) as AudioClip | undefined;
    const doc = c ? p.instrumentDocs?.find((d) => d.id === c.instrumentDocId) : undefined;
    const notes = doc?.synth?.notes ?? [];
    log(!!c && Math.abs(c.start - 2) < 0.02 && tr?.type === 'music', 'a dallam a dúdolás kezdeténél, a szabad zene-sávon', `${tr?.type}, ${c?.start.toFixed(2)} s, ${ms} ms`);
    log(notes.map((n) => n.midi).join(',') === midis.join(',') && notes.map((n) => n.startBeat).join(',') === '0,1,2,3', 'a hangok és a rács pontosak (C4 E4 G4 C5, negyedenként)', notes.map((n) => `${n.midi}@${n.startBeat}/${n.lengthBeats}`).join(' '));
    log((st().past?.length ?? 0) - undoBefore === 1, 'egy undo-lépés');
    router.back();
    await sleep(500);
  } finally {
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:hum', caught));
  }
}
/** ⬇️ Modell-letöltés fájlba (nem memóriába): a 181 MB-os Whisper small újratöltve, ellenőrizve; hibás checksum → elutasítva, nincs maradék. */
export async function smokeModelDownload(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const entry = catalogEntry('whisper-small-q5')!.manifest!;
  removeModel('whisper-small-q5');
  const t0 = Date.now();
  const res = await downloadModel(entry);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  log(res.ok && res.sizeBytes === entry.sizeBytes && !!res.uri && new File(res.uri).exists, 'a 181 MB-os modell fájlba töltve, a mérete pontos, a checksum egyezik', res.ok ? `${res.sizeBytes} B, ${dt} s` : `${res.reason}`);
  const smoke = res.ok ? await runWhisperSmokeTest('whisper-small-q5') : false;
  log(smoke && bestUsableWhisperModelId() === 'whisper-small-q5', 'a letöltött modell fut (próba) és ez lett a legjobb', `${bestUsableWhisperModelId()}`);
  // hibás checksum: elutasítva, a félkész fájl sem marad
  const tiny = catalogEntry('whisper-tiny-q8')!.manifest!;
  const bad = await downloadModel({ ...tiny, id: 'smoke-bad', sha256: '0'.repeat(64) });
  const leftovers = (listCachedModels().some((m) => m.id === 'smoke-bad') ? 1 : 0) + (new File(Paths.document, 'models', 'smoke-bad-1.0.0.bin.part').exists ? 1 : 0);
  log(!bad.ok && bad.reason === 'checksum' && leftovers === 0, 'hibás checksum: elutasítva, nincs maradék fájl', `${bad.ok ? 'ok?!' : bad.reason}, maradék ${leftovers}`);
}
/** 🗣️ AP5: az AI-hang a telefonon készül (offline, szerver nélkül): WAV a voiceover sávon, valódi beszéd, egy undo. */
export async function smokeTtsDevice(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const id = 'prj_smoke_tts';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tts', caught));
  await saveProject({ ...createEmptyProject('smoke tts', '9:16', undefined, 'audio'), id });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) await sleep(200);
  await sleep(1200);
  const voice = () => st().project!.tracks.find((t) => t.type === 'voiceover')!.clips as AudioClip[];
  try {
    runDevAction('audio.openTts');
    let info: { device: string[] | null; server: number } = { device: null, server: 0 };
    for (let i = 0; i < 50 && !info.device; i++) {
      await sleep(200);
      info = (runDevAction('tts.voices') as typeof info) ?? info;
    }
    log(canSpeakOnDevice() && (info.device?.length ?? 0) > 0, 'a telefon beszédhangjai elérhetők (szerver nélkül)', `${info.device?.length ?? 0} nyelv: ${(info.device ?? []).slice(0, 6).join(', ')}`);
    log(true, 'FOTÓZHATÓ', 'az AI-hang lap a telefon hangjaival');
    await sleep(1500);
    runDevAction('tts.text', 'Szia! Ez a ReMix telefonos hangja. Egy, kettő, három, négy.');
    await sleep(300);
    const head = st().playhead;
    const t0 = Date.now();
    const ok = (await runDevAction('tts.generate')) as boolean;
    const ms = Date.now() - t0;
    const clip = voice()[0];
    const api = (await loadAudioApi())!;
    const buf = clip ? await api.decodeAudioData(clip.uri, 44100) : null;
    const l = buf?.getChannelData(0);
    const lufs = l ? integratedLoudness(l, l, 44100) : -Infinity;
    log(ok && !!clip && clip.uri.startsWith('file:') && clip.uri.endsWith('.wav') && Math.abs(clip.start - head) < 0.05 && clip.duration > 1.5, 'a beszéd a telefonon készült (WAV a projekt-mappában), klipként a lejátszófejnél a voiceover sávon', clip ? `${ms} ms, ${clip.duration.toFixed(2)} s, kezdet ${clip.start}` : 'nincs klip');
    log(lufs > -40, 'a fájlban valódi beszéd szól (nem csend)', `${lufs.toFixed(1)} LUFS`);
    st().undo();
    log(voice().length === 0, 'egy visszavonás: a klip eltűnik', `${voice().length} klip`);
  } finally {
    router.back();
    await sleep(500);
    await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:tts-del', caught));
  }
}
/** 🧪 Whisper szó-szintű szonda: motor, modell, és a felismert szavak egy ismert szövegű felvételen. */
export async function smokeWhisperProbe(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  log(null, 'motor', `${whisperEngineAvailable()} · modellek: ${listCachedModels().map((m) => m.id).join(', ') || '-'} · legjobb: ${bestUsableWhisperModelId() ?? '-'}`);
  if (!bestUsableWhisperModelId()) {
    const entry = catalogEntry('whisper-base-q5');
    const t0 = Date.now();
    const res = entry?.manifest ? await downloadModel(entry.manifest) : null;
    const smoke = res?.ok ? await runWhisperSmokeTest('whisper-base-q5') : false;
    log(!!res?.ok && smoke, 'a Whisper base letöltése + próbája (az app saját útja)', `${res?.ok} / ${smoke}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  for (const name of ['speech_en.wav', 'speech_hu.wav']) {
    const local = await downloadToCache(`${smokeFileHost()}/${name}`, `probe_${name}`);
    const pcm = local ? await decodeToMono16k(local) : null;
    log(null, 'forrás', `${name}: ${pcm ? (pcm.length / 16000).toFixed(2) : '-'} s`);
    if (!pcm) continue;
    const t0 = Date.now();
    const r = await transcribeWordsOnDevice(pcm, 0);
    log(null, 'nyelv (auto)', r?.language ?? '-');
    log(null, 'tokenek', lastRawTokens.map((k) => `[${k.text}]${k.start.toFixed(2)}-${k.end.toFixed(2)}`).join(' '));
    log(!!r && r.words.length > 0, `szavak (${name}, ${Date.now() - t0} ms)`, r ? r.words.map((w) => `${w.text}@${w.start.toFixed(2)}-${w.end.toFixed(2)}`).join(' ') : 'null');
  }
}

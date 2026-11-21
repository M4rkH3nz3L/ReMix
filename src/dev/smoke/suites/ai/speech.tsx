/** 🧪 Füstteszt — beszédvágás szöveggel és magyar beszéd. (Áthelyezve: phases14; viselkedés-változás nélkül.) */
import { File } from 'expo-file-system';
import { Platform, Dimensions } from 'react-native';
import { router, type Href } from 'expo-router';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import { projectExportDir } from '@/lib/model3dRenderClient';
import { runDevAction } from '@/lib/devActions';
import { editGridRate } from '@/lib/frames';
import { exportOfflineWav } from '@/lib/offlineMixClient';
import { useSpeechEdit } from '@/store/speechEditStore';
import { currentSpeechWords } from '@/components/studio/audio/SpeechEditBar';
import { clearSpeechWordCache } from '@/lib/speechEditClient';
import { wordCutRanges } from '@/lib/speechEdit';
import { catalogRuntime } from '@/lib/modelRegistryClient';
import { transcribeWordsOnDevice, bestUsableWhisperModelId } from '@/lib/whisperClient';
import { catalogEntry, catalogAvailability } from '@/lib/modelCatalog';
import { decodeToMono16k } from '@/lib/audioDecode';
import { loadAudioApi } from '@/lib/audioApiGuard';
import { createEmptyProject } from '@/lib/projectUtils';
import { deleteProject, saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project } from '@/types/project';
import { type Log, sleep } from '../../helpers/core';
import { smokeFileHost } from '../../helpers/env';
import { toneWav } from '../../helpers/audio';
import '@/lib/dspNativeClient';

/** 🇭🇺 Magyar beszédvágás: az alap modell szóhibái, a pontosabb (small) modell letöltése az átirat-sávból, újra-mérés, egy szó kivágása. */
export async function smokeSpeechHu(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = await downloadToCache(`${smokeFileHost()}/speech_hu.wav`, 'smoke_speech_hu.wav');
  if (!src) {
    log(false, 'a próbahang letöltése', '-');
    return;
  }
  clearSpeechWordCache();
  const norm = (ws: { text: string }[]) => ws.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).join(' ');
  const expected = 'sziasztok és üdv a műsorban ma arról beszélünk hogyan lehet szöveggel hangot vágni ha törölsz egy szót a hang is kivágódik';
  const wordDiff = (a: string, b: string) => {
    const x = a.split(' ');
    const y = b.split(' ');
    const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  };
  const pcm = await decodeToMono16k(src);
  // viszonyítás: az eszközön meglévő kisebb modell (base, ennek hiányában tiny)
  const smallerId = ['whisper-base-q5', 'whisper-tiny-q8'].find((m) => {
    const e = catalogEntry(m);
    return e && catalogAvailability(e, catalogRuntime()) === 'validated';
  });
  const base = pcm && smallerId ? await transcribeWordsOnDevice(pcm, 0, { modelId: smallerId }) : null;
  const baseHeard = base ? norm(base.words) : 'null';
  const baseErr = wordDiff(baseHeard, expected);
  log(!!base, `a kisebb modell (${smallerId ?? '-'})`, `${baseHeard} — ${baseErr} szóhiba / 20`);
  const id = 'prj_smoke_speech_hu';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:speechhu', caught));
  const p0 = createEmptyProject('smoke magyar beszédvágás', '9:16', undefined, 'audio');
  const vo: AudioClip = { kind: 'audio', id: 'vo', label: 'beszéd', uri: src, start: 0, duration: 9.3, trimIn: 0, sourceDuration: 9.3, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported' };
  await saveProject({ ...p0, id, tracks: p0.tracks.map((t) => (t.type === 'voiceover' ? { ...t, clips: [vo] } : t)) });
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  st().selectClip('vo');
  await runDevAction('audio.speechStart');
  const t0 = Date.now();
  const n = (await runDevAction('audio.speechUpgrade')) as number | null;
  const small = norm(currentSpeechWords());
  const smallErr = wordDiff(small, expected);
  log(bestUsableWhisperModelId() === 'whisper-small-q5' && n !== null, '„Pontosabb felismerés”: a small letöltve (sha256 + próba), a sáv újra átírva', `${bestUsableWhisperModelId()}, ${n} szó, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(!!base && smallErr < baseErr, 'a small magyarul pontosabb, mint a kisebb modell', `${small} — ${smallErr} szóhiba / 20 (${smallerId}: ${baseErr})`);
  log(true, 'FOTÓZHATÓ', 'a magyar átirat a small modellel');
  await sleep(2500);
  // egy magyar szó kivágása, az eredmény újra-átírva
  const ws = currentSpeechWords();
  const target = ws.find((w) => norm([w]) === 'hangot') ?? ws[0];
  useSpeechEdit.setState({ selected: new Set([target.key]), mode: 'track' });
  runDevAction('audio.speechApply');
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_hu_out.wav'));
  const p2 = await decodeToMono16k(out);
  new File(out).delete();
  const re = p2 ? await transcribeWordsOnDevice(p2, 0) : null;
  const got = re ? norm(re.words) : 'null';
  const want = small.split(' ').filter((x) => x !== norm([target])).join(' ');
  log(!!re && !got.split(' ').includes(norm([target])) && wordDiff(got, want) <= 3, `„${target.text}” kivágva (folyamatos beszédből): az újra-átírásban nincs, a többi megvan (≤ 3 szó eltérés — a felismerő futásonként ennyit ingadozik)`, `${got} — ${wordDiff(got, want)} szó`);
  st().undo();
  await sleep(1000);
  router.back();
}
/** ✂️💬 Beszédvágás szöveggel: átirat, töltelékek kijelölése, kivágás, az eredmény újra-átírva, undo, minden sáv. */
export async function smokeSpeechEdit(log: Log) {
  log(null, 'eszköz', `${Platform.OS} ${Dimensions.get('screen').width}×${Dimensions.get('screen').height}`);
  const src = await downloadToCache(`${smokeFileHost()}/speech_en.wav`, 'smoke_speech_en.wav');
  if (!src) {
    log(false, 'a próbahang letöltése', '-');
    return;
  }
  clearSpeechWordCache();
  const norm = (ws: { text: string }[]) => ws.map((w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')).filter(Boolean).join(' ');
  const expected = 'hello and welcome to the show um today we talk about uh editing audio with text delete a word and the sound is cut';
  const id = 'prj_smoke_speech';
  await deleteProject(id).catch((caught) => logCaught('lib/imageSmoke.tsx:speech', caught));
  const base = createEmptyProject('smoke beszédvágás', '9:16', undefined, 'audio');
  const bed = toneWav('smoke_speech_bed.wav', 9);
  const ac = (over: Partial<AudioClip>): AudioClip => ({ kind: 'audio', label: 'x', trimIn: 0, volume: 0.9, fadeIn: 0, fadeOut: 0, source: 'imported', uri: src, start: 0, duration: 8.2, sourceDuration: 8.2, id: 'x', ...over });
  const project: Project = {
    ...base,
    id,
    tracks: base.tracks.map((t) =>
      t.type === 'voiceover'
        ? { ...t, clips: [ac({ id: 'vo', label: 'beszéd' })] }
        : t.type === 'sfx'
          ? { ...t, clips: [ac({ id: 'fx', label: 'hang', uri: bed, start: 7.5, duration: 0.5, sourceDuration: 9, volume: 0.2 })] }
          : t.type === 'music'
            ? { ...t, clips: [ac({ id: 'bed', label: 'zene', uri: bed, duration: 8.2, sourceDuration: 9, volume: 0.1 })] }
            : t
    ),
  };
  await saveProject(project);
  router.push(`/studio/audio/${id}` as Href);
  const st = useEditorStore.getState;
  for (let i = 0; i < 60 && st().project?.id !== id; i++) {
    await sleep(200);
  }
  await sleep(1200);
  runDevAction('audio.fit');
  const track = (type: string) => (st().project?.tracks.find((t) => t.type === type)?.clips ?? []).slice().sort((a, b) => a.start - b.start);
  st().selectClip('vo');
  const t0 = Date.now();
  const count = (await runDevAction('audio.speechStart')) as number | null;
  const words = currentSpeechWords();
  // szó-szintű eltérés (Levenshtein a szavakon)
  const wordDiff = (a: string, b: string) => {
    const x = a.split(' ');
    const y = b.split(' ');
    const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    return d[x.length][y.length];
  };
  const heard = norm(words);
  // a modellek a töltelékeket eltérően írják (uh/ah), és egy-egy szót félrehallhatnak
  log(wordDiff(heard, expected) <= 2, `az átirat a telefonon (${bestUsableWhisperModelId()}, ${Date.now() - t0} ms, ${count} szó) ≈ a felolvasott szöveg (≤ 2 szó eltérés)`, `${heard} — eltérés ${wordDiff(heard, expected)}`);
  const fillers = runDevAction('audio.speechFillers') as number;
  const picked = words.filter((w) => useSpeechEdit.getState().selected.has(w.key)).map((w) => w.text).join(' ');
  const pickedNorm = words.filter((w) => useSpeechEdit.getState().selected.has(w.key)).map((w) => norm([w]));
  const minus = words.filter((w) => !useSpeechEdit.getState().selected.has(w.key)).map((w) => norm([w])).join(' ');
  log(fillers === 2 && pickedNorm.every((x) => ['um', 'uh', 'ah', 'er', 'erm', 'umm', 'uhh'].includes(x)), 'Töltelékek: a két töltelék („um”, „uh”) kijelölve', picked);
  log(true, 'FOTÓZHATÓ', 'az átirat-sáv két áthúzott töltelékkel, a sávon pirosan');
  await sleep(2500);
  // a stúdió rácsa (V6: hang-projektben a minta) — ugyanúgy, mint a szövegvágó sáv
  const plannedCuts = wordCutRanges(currentSpeechWords(), useSpeechEdit.getState().selected, editGridRate(st().project));
  const beforeCut = st().project!;
  const cuts = runDevAction('audio.speechApply') as number;
  const vo = track('voiceover');
  const kept = vo.reduce((s, c) => s + c.duration, 0);
  log(cuts === 2 && vo.length === 3, 'Kivágás: 2 tartomány, a beszéd 3 darabban', `${vo.map((c) => `${c.start.toFixed(2)}+${c.duration.toFixed(2)}`).join(' · ')} (−${(8.2 - kept).toFixed(2)} s)`);
  const after = currentSpeechWords();
  log(norm(after) === minus && after.every((w, i) => i === 0 || w.start >= after[i - 1].start), 'az átirat magától frissül: a töltelékek eltűntek, a többi a helyén', norm(after));
  log(track('sfx')[0]?.start === 7.5 && track('music').length === 1, 'csak ez a sáv: a többi érintetlen', `effekt ${track('sfx')[0]?.start}, zene ${track('music').length}`);
  // a valódi bizonyíték: az eredmény hangját újra átírjuk
  const voOnly = (p: Project): Project => ({ ...p, tracks: p.tracks.map((t) => (t.type === 'voiceover' ? t : { ...t, clips: [] })) });
  const { uri: out } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_out.wav'));
  const pcm = await decodeToMono16k(out);
  new File(out).delete();
  const re = pcm ? await transcribeWordsOnDevice(pcm, 0) : null;
  // betű-szintű eltérés (a szóközök nélkül — a tiny modell néha összevon két szót)
  const charDiff = (a: string, b: string) => wordDiff(a.replace(/ /g, '').split('').join(' '), b.replace(/ /g, '').split('').join(' '));
  const reHeard = re ? norm(re.words) : 'null';
  log(!!re && charDiff(reHeard, minus) <= 3 && !/\b(um|uh|ah)\b/.test(reHeard), 'az export újra-átírva ≈ az eredeti átirat a két töltelék nélkül (nincs „um”/„uh”, ≤ 3 betű eltérés)', `${reHeard} — ${charDiff(reHeard, minus)} betű (${pcm ? (pcm.length / 16000).toFixed(2) : '-'} s)`);
  // a hang mintára: a vágások közti szakaszok = az eredeti, a kivágott idővel eltolva
  const SR = 44100;
  const render = async (p: Project, name: string) => {
    const { uri: o } = await exportOfflineWav(voOnly(p), new File(projectExportDir(), name), undefined, undefined, 'float32');
    const y = (await (await loadAudioApi())!.decodeAudioData(o, SR)).getChannelData(0);
    new File(o).delete();
    return y;
  };
  const yA = await render(beforeCut, 'smoke_sp_a.wav');
  const yB = await render(st().project!, 'smoke_sp_b.wav');
  let shift = 0;
  let maxD = 0;
  let from = 0;
  for (const r of [...plannedCuts, { start: 8.2, end: 8.2 }]) {
    // a szakasz belseje (a vágás-varratok 10 ms-os mikro-fade-je nélkül)
    for (let i = Math.round((from + 0.012) * SR); i < Math.round((r.start - 0.012) * SR); i++) maxD = Math.max(maxD, Math.abs(yA[i] - (yB[i - shift] ?? 0)));
    shift += Math.round((r.end - r.start) * SR);
    from = r.end;
  }
  log(maxD < 1e-6 && plannedCuts.length === 2, 'a hang mintára: a megmaradt beszéd = az eredeti, a kivágott idővel előbb', `max eltérés ${maxD.toExponential(1)}, vágások ${plannedCuts.map((r) => `${r.start.toFixed(3)}–${r.end.toFixed(3)}`).join(', ')}`);
  st().undo();
  log(track('voiceover').length === 1 && norm(currentSpeechWords()) === heard, 'egy visszavonás: az egész klip és a teljes átirat vissza (újra-átírás nélkül)', `${track('voiceover').length} klip`);
  // minden sáv: az effekt is a kivágott idővel előbb jön
  runDevAction('audio.speechFillers');
  runDevAction('audio.speechModeAll');
  runDevAction('audio.speechApply');
  const removed = 8.2 - track('voiceover').reduce((s, c) => s + c.duration, 0);
  log(Math.abs((track('sfx')[0]?.start ?? 0) - (7.5 - removed)) < 1e-4 && track('music').length === 1 && track('music')[0].start === 0, 'minden sáv: az effekt előbb jön, a zene nem vágódik', `effekt ${track('sfx')[0]?.start.toFixed(6)} (7,5 − ${removed.toFixed(6)}), zene ${track('music').map((c) => `${c.start}+${c.duration}`).join(',')}`);
  st().undo();
  // szón belüli vágás folyamatos beszédben: az „audio” az „editing audio” közepéről
  const reCut = async (word: string) => {
    const ws = currentSpeechWords();
    const w = ws.find((x) => norm([x]) === word);
    if (!w) return null;
    useSpeechEdit.setState({ selected: new Set([w.key]), mode: 'track' });
    runDevAction('audio.speechApply');
    const { uri: o } = await exportOfflineWav(voOnly(st().project!), new File(projectExportDir(), 'smoke_speech_w.wav'));
    const p16 = await decodeToMono16k(o);
    new File(o).delete();
    const r2 = p16 ? await transcribeWordsOnDevice(p16, 0) : null;
    const base0 = norm(ws);
    st().undo();
    return { want: base0.split(' ').filter((x, i, arr) => !(x === word && arr.indexOf(word) === i)).join(' '), got: r2 ? norm(r2.words) : 'null' };
  };
  const inner = await reCut('audio');
  // folyamatos beszédben a vágásnak nincs szünete: a felismerő a varratnál egy szót félrehallhat
  log(!!inner && wordDiff(inner.got, inner.want) <= 1 && !/\baudio\b/.test(inner.got), 'szón belüli vágás („editing audio” → „editing”): az újra-átírásban nincs „audio”, a többi megvan (≤ 1 szó eltérés)', inner ? `${inner.got} — ${wordDiff(inner.got, inner.want)} szó` : '-');
  await sleep(1500);
  router.back();
}

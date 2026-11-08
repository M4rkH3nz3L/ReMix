import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioRecorder } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

import { loadAudioApi } from '@/lib/audioApiGuard';
import type { Meter } from '@/lib/audioTransport';
import { canSegment, isLongSource, LongSource } from '@/lib/longSource';
import { alignTake, ALIGN_MIN_RHO } from '@/lib/takeAlign';
import type { AudioClip, Project, TrackType } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { encodeWav16 } from '@/lib/offlineMix';
import { countInClicks, countInSeconds, recordingStartFrom, type PunchWindow } from '@/lib/punchRecord';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🎙️⏱️ Count-in és punch-in a telefonon (a `punchRecord` tiszta magjára).
 *
 * Count-in: a felvevő a kattanásokkal EGYÜTT indul, és a take eleje (az előszámlálás) `trimIn`-nel
 * kimarad — így a vágás a felvevő saját idején múlik, nem a JS-időzítésen. A kattanás-lejátszó és a
 * felvevő közti indulási különbséget a két óra páros mintáiból mérjük (medián), és a vágás ezzel
 * igazodik: a take ott kezdődik, ahol a következő (ki nem hangzó) ütés lenne.
 */

const SR = 44100;

/** a kattanás-sáv (WAV a cache-ben, paraméterenként egyszer): hangsúlyos 1,5 kHz, a többi 1 kHz */
export function countInClickUri(bars: number, bpm: number | undefined, meter: Meter): string {
  const sec = countInSeconds(bars, bpm, meter);
  const f = new File(Paths.cache, `countin_${bars}_${Math.round((bpm ?? 120) * 100)}_${meter.beatsPerBar}_${meter.beatUnit}.wav`);
  if (f.exists) return f.uri;
  const x = new Float32Array(Math.ceil(sec * SR));
  for (const c of countInClicks(bars, bpm, meter)) {
    const at = Math.round(c.t * SR);
    const hz = c.accent ? 1500 : 1000;
    const amp = c.accent ? 0.8 : 0.55;
    for (let i = 0; i < 0.04 * SR && at + i < x.length; i++) x[at + i] = amp * Math.sin((2 * Math.PI * hz * i) / SR) * Math.exp(-i / (0.008 * SR));
  }
  f.create();
  f.write(encodeWav16([x], SR, () => 0.5));
  return f.uri;
}

/**
 * az előszámlálás lejátszása a már FUTÓ felvétel mellett; a visszatérési érték a take-ből levágandó
 * eleje (mp): az előszámlálás hossza + a lejátszó késése a felvevőhöz képest. `alive` hamis → megszakítva.
 */
export async function runCountIn(recorder: AudioRecorder, bars: number, bpm: number | undefined, meter: Meter, alive: () => boolean): Promise<number> {
  const sec = countInSeconds(bars, bpm, meter);
  const player = createAudioPlayer(countInClickUri(bars, bpm, meter));
  const offsets: number[] = [];
  try {
    player.play();
    const t0 = Date.now();
    while (alive() && Date.now() - t0 < sec * 1000 + 300) {
      await new Promise((r) => setTimeout(r, 15));
      const ct = player.currentTime;
      const rec = recorder.getStatus().durationMillis / 1000;
      // a lejátszó késése: (felvevő ideje − lejátszó ideje), amíg mindkettő halad
      if (ct > 0.05 && rec > 0.05 && ct < sec) offsets.push(rec - ct);
    }
  } finally {
    try {
      player.remove();
    } catch (caught) {
      logCaught('lib/recordTakeClient.ts:countInPlayer', caught);
    }
  }
  offsets.sort((a, b) => a - b);
  const lag = offsets.length > 0 ? offsets[offsets.length >> 1] : 0;
  return sec + lag;
}

/**
 * 🎯 Punch-in futtatása: lejátszás `playFrom`-tól (a hurok kikapcsolva), a felvevő `recordAt`-nél
 * indul, közben (lejátszófej, felvett idő) párok; `stopAt`-nél / a lejátszás leállásakor / kézi
 * leállításnál `onEnd`. A `startAt()` a felvétel 0. mintájának helye a projekt idejében.
 */
export class PunchSession {
  private samples: { playhead: number; recordedMs: number }[] = [];
  private started = false;
  private ended = false;
  private loopWas = false;

  constructor(
    private readonly recorder: AudioRecorder,
    readonly win: PunchWindow,
    private readonly onEnd: () => void
  ) {}

  start(): void {
    const st = useEditorStore.getState();
    this.loopWas = st.loop;
    if (st.loop) st.setLoop(false);
    st.setPlayhead(this.win.playFrom);
    st.setPlaying(true);
    const tick = () => {
      if (this.ended) return;
      const s = useEditorStore.getState();
      if (!this.started && s.playhead >= this.win.recordAt) {
        this.started = true;
        this.recorder.record();
      } else if (this.started) {
        this.samples.push({ playhead: s.playhead, recordedMs: this.recorder.getStatus().durationMillis });
      }
      if (s.playhead >= this.win.stopAt || !s.isPlaying) {
        this.end();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** a lejátszás megáll, a hurok visszaáll — visszahívás nélkül (a kézi leállítás ezt hívja) */
  halt(): void {
    if (this.ended) return;
    this.ended = true;
    const st = useEditorStore.getState();
    st.setPlaying(false);
    if (this.loopWas) st.setLoop(true);
  }

  /** a magától bekövetkező vég (Out, vagy a lejátszás leállt): megállás + `onEnd` */
  private end(): void {
    if (this.ended) return;
    this.halt();
    this.onEnd();
  }

  get recording(): boolean {
    return this.started;
  }

  startAt(): number | null {
    return recordingStartFrom(this.samples);
  }

  sampleCount(): number {
    return this.samples.length;
  }
}

// ── 🎯 a take igazítása a ténylegesen hallotthoz (áthallás), tartalékként a tárolt kalibráció ──

const CALIB_KEY = 'remix.recLatency.v1';
type Calib = { countIn?: number; punch?: number };

async function readCalib(): Promise<Calib> {
  try {
    const raw = await AsyncStorage.getItem(CALIB_KEY);
    return raw ? (JSON.parse(raw) as Calib) : {};
  } catch (caught) {
    logCaught('lib/recordTakeClient.ts:readCalib', caught);
    return {};
  }
}

async function writeCalib(patch: Calib): Promise<void> {
  try {
    await AsyncStorage.setItem(CALIB_KEY, JSON.stringify({ ...(await readCalib()), ...patch }));
  } catch (caught) {
    logCaught('lib/recordTakeClient.ts:writeCalib', caught);
  }
}

/** 🧪 füstteszt: az áthallás-illesztés kikapcsolható (így a tárolt kalibráció útja külön mérhető) */
let bleedAlign = true;
export function setTakeAlignForTest(on: boolean): void {
  bleedAlign = on;
}

/** az utolsó igazítás (mérés / felület) */
export interface TakeAlignInfo {
  mode: 'countIn' | 'punch';
  /** igaz: az áthallásból mérve; hamis: a tárolt kalibrációból */
  measured: boolean;
  /** mp: a felvevő órájához képesti eltolás */
  shift: number;
  rho: number | null;
}
let lastAlign: TakeAlignInfo | null = null;
export function lastTakeAlign(): TakeAlignInfo | null {
  return lastAlign;
}

async function decodeMono(uri: string): Promise<Float32Array | null> {
  const api = await loadAudioApi();
  if (!api) return null;
  // a frissen a projekt-mappába másolt take néha egy pillanatig még nem látszik (mérve: 0–100 ms)
  if (uri.startsWith('file:') && !new File(uri).exists) {
    const f = new File(uri);
    for (let waited = 0; !f.exists && waited < 2000; waited += 100) await new Promise((r) => setTimeout(r, 100));
    if (!f.exists) {
      logCaught('lib/recordTakeClient.ts:decodeMono', new Error(`hiányzó fájl: ${uri.split('/').slice(-2).join('/')}`));
      return null;
    }
  }
  try {
    return (await api.decodeAudioData(uri, SR)).getChannelData(0).slice();
  } catch (caught) {
    logCaught('lib/recordTakeClient.ts:decodeMono', caught);
    return null;
  }
}

/**
 * ⏱️ count-in: a take-ben a saját kattanás-sávunkat keressük; a levágás = a ténylegesen hallott
 * első kattanás + az előszámlálás hossza (a lejátszó puffere, a hangszóró és a mikrofon késése
 * benne van). Nincs áthallás → az órákból számolt + a legutóbb mért késés.
 */
export async function alignCountInTake(uri: string, bars: number, bpm: number | undefined, meter: Meter, clockTrim: number): Promise<number> {
  const countIn = countInSeconds(bars, bpm, meter);
  const calib = await readCalib();
  let tried: number | null = null;
  if (bleedAlign) {
    const [take, clicks] = await Promise.all([decodeMono(uri), decodeMono(countInClickUri(bars, bpm, meter))]);
    if (take && clicks) {
      const refAt = (t: number) => {
        const k = Math.round(t * SR);
        return k >= 0 && k < clicks.length ? clicks[k] : 0;
      };
      // a take 0. mintája a kattanás-sáv (countIn − clockTrim) idejénél (az órák szerint)
      const r = alignTake(take, SR, refAt, countIn - clockTrim, [0, Math.min(clockTrim + 0.1, take.length / SR)], 0.25);
      tried = r?.rho ?? null;
      if (r && r.rho >= ALIGN_MIN_RHO) {
        lastAlign = { mode: 'countIn', measured: true, shift: -r.shift, rho: r.rho };
        await writeCalib({ countIn: -r.shift });
        return clockTrim - r.shift;
      }
    }
  }
  const lat = calib.countIn ?? 0;
  lastAlign = { mode: 'countIn', measured: false, shift: lat, rho: tried };
  return clockTrim + lat;
}

/** a punch alatt hallható (más sávon szóló, egyszerű) klip, a legnagyobb átfedéssel */
function referenceClip(project: Project, target: TrackType, from: number, to: number, audible: (t: TrackType) => boolean): AudioClip | null {
  let best: AudioClip | null = null;
  let bestOv = 0;
  for (const track of project.tracks) {
    if (track.type === target || !audible(track.type)) continue;
    for (const c of track.clips) {
      if (c.kind !== 'audio' || c.reversed || (c.speed ?? 1) !== 1 || c.loopLength || !(c.volume > 0)) continue;
      const ov = Math.min(to, c.start + c.duration) - Math.max(from, c.start);
      if (ov > bestOv) {
        bestOv = ov;
        best = c;
      }
    }
  }
  return bestOv >= 0.3 ? best : null;
}

/**
 * 🎯 punch: a take-et a közben szóló klip áthallásához igazítjuk (a felhasználó ehhez énekelt);
 * nincs hallható klip vagy áthallás → az órákból számolt + a legutóbb mért késés.
 */
export async function alignPunchTake(
  project: Project,
  target: TrackType,
  uri: string,
  clockStart: number,
  win: PunchWindow,
  audible: (t: TrackType) => boolean
): Promise<number> {
  const calib = await readCalib();
  let tried: number | null = null;
  const ref = bleedAlign ? referenceClip(project, target, win.recordAt, win.stopAt, audible) : null;
  if (ref) {
    const take = await decodeMono(uri);
    let src: ((sec: number) => number) | null = null;
    const a = Math.max(ref.start, win.recordAt - 0.5);
    const b = Math.min(ref.start + ref.duration, win.stopAt + 0.5);
    const s0 = (ref.trimIn ?? 0) + (a - ref.start);
    const s1 = (ref.trimIn ?? 0) + (b - ref.start);
    // csak a kellő ablak (a natív ablak-dekóderrel) — egy több perces dal egészét fölösleges dekódolni
    if (canSegment() || isLongSource(ref.sourceDuration)) {
      const long = new LongSource(ref.uri);
      await long.ensure(Math.floor(s0 * SR), Math.ceil(s1 * SR));
      const w = long.read(Math.floor(s0 * SR), Math.ceil(s1 * SR));
      if (w) src = (sec) => w[0][Math.round((sec - s0) * SR)] ?? 0;
    } else {
      const whole = await decodeMono(ref.uri);
      if (whole) src = (sec) => whole[Math.round(sec * SR)] ?? 0;
    }
    if (take && src) {
      const read = src;
      const refAt = (t: number) => (t >= ref.start && t < ref.start + ref.duration ? read((ref.trimIn ?? 0) + (t - ref.start)) : 0);
      // az ablak: a take azon része, ami alatt a klip szólt (legfeljebb 1,5 s)
      const w0 = Math.max(0.05, a - clockStart);
      const w1 = Math.min(take.length / SR - 0.05, b - clockStart, w0 + 1.5);
      const r = alignTake(take, SR, refAt, clockStart, [w0, w1], 0.25);
      tried = r?.rho ?? null;
      if (r && r.rho >= ALIGN_MIN_RHO) {
        lastAlign = { mode: 'punch', measured: true, shift: r.shift, rho: r.rho };
        await writeCalib({ punch: r.shift });
        return clockStart + r.shift;
      }
    }
  }
  const lat = calib.punch ?? 0;
  lastAlign = { mode: 'punch', measured: false, shift: lat, rho: tried };
  return clockStart + lat;
}

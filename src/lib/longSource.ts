import { File, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { logCaught } from '@/lib/logCaught';

/**
 * 🎧 Hosszú forrás (20 percnél hosszabb is) szakaszosan: a natív modul a fájlnak CSAK egy ablakát
 * dekódolja (`decodeWindow`, iOS AVAssetReader → 44,1 kHz float32), a keverő pedig a lejátszófej
 * körüli szakaszokat kéri. A memóriában legfeljebb `MAX_SEGMENTS` szakasz él (8 × 20 s ≈ 2,7 perc,
 * sztereóban ~56 MB) — egy 60 perces teljes dekódolás ~1,3 GB lenne.
 *
 * A szakaszok illesztésénél nincs kattanás: minden ablak ±0,1 s ráhagyással dekódolódik, és a
 * ráhagyás levágódik (a mintavétel-átalakító szélei nem esnek a hallható részbe).
 */

interface DecodeWindowModule {
  decodeWindow(uri: string, start: number, duration: number, outputPath: string): Promise<{ frames: number; channels: number }>;
  readonly supportsDecodeWindow?: boolean;
}

const Native = requireOptionalNativeModule<DecodeWindowModule>('RemixRender');

/** ennél hosszabb forrás szakaszosan szól (rövidebbnél a teljes dekódolás gyorsabb) */
export const LONG_SOURCE_SEC = 10 * 60;
let threshold = LONG_SOURCE_SEC;

/** 🧪 füstteszt: a határ rövid fájlon is kipróbálható */
export function setLongThresholdForTest(sec: number | null): void {
  threshold = sec ?? LONG_SOURCE_SEC;
}

/** hosszú-e a forrás (a teljes hossza szerint) */
export function isLongSource(sourceDurationSec: number | undefined): boolean {
  return (sourceDurationSec ?? 0) > threshold;
}

/** a hosszú forrás-uri-k egy tervből (a forrás leghosszabb ismert hossza szerint) */
export function longUris(clips: { uri: string; sourceDuration?: number }[]): Set<string> {
  const out = new Set<string>();
  for (const c of clips) {
    if (canSegment() && isLongSource(c.sourceDuration)) out.add(c.uri);
  }
  return out;
}
const SR = 44100;
const SEG_SEC = 20;
const SEG = SEG_SEC * SR;
const PAD_SEC = 0.1;
const MAX_SEGMENTS = 8;

/** tud-e a build szakaszosan dekódolni (az új natív modul) */
export function canSegment(): boolean {
  return Native?.supportsDecodeWindow === true;
}

export class LongSource {
  private segs = new Map<number, Float32Array[]>();
  private order: number[] = [];
  private loading = new Map<number, Promise<void>>();
  private channels = 0;

  constructor(readonly uri: string) {}

  /** a `[from, to)` mintatartományhoz kellő szakaszok betöltése (a régiek kiesnek) */
  async ensure(from: number, to: number): Promise<void> {
    const first = Math.max(0, Math.floor(from / SEG));
    const last = Math.max(first, Math.floor((Math.max(from, to) - 1) / SEG));
    const tasks: Promise<void>[] = [];
    for (let k = first; k <= last; k++) {
      tasks.push(this.load(k));
    }
    await Promise.all(tasks);
  }

  private load(k: number): Promise<void> {
    if (this.segs.has(k)) {
      this.touch(k);
      return Promise.resolve();
    }
    const running = this.loading.get(k);
    if (running) {
      return running;
    }
    const task = (async () => {
      if (!Native) {
        return;
      }
      const start = k * SEG_SEC;
      const pad = k > 0 ? PAD_SEC : 0;
      const out = new File(Paths.cache, `seg_${k}_${Date.now()}_${Math.round(Math.random() * 1e6)}.f32`);
      try {
        const info = await Native.decodeWindow(this.uri, start - pad, SEG_SEC + pad + PAD_SEC, out.uri.replace('file://', ''));
        const handle = out.open();
        let bytes: Uint8Array;
        try {
          bytes = handle.readBytes(handle.size ?? 0);
        } finally {
          handle.close();
        }
        const all = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
        const ch = Math.max(1, info.channels);
        this.channels = ch;
        const skip = Math.round(pad * SR);
        const chans = Array.from({ length: ch }, () => new Float32Array(SEG));
        const frames = Math.max(0, Math.min(SEG, Math.floor(all.length / ch) - skip));
        if (ch === 1) {
          chans[0].set(all.subarray(skip, skip + frames));
        } else {
          // az átfésülés darabokban, átadásokkal: egy 20 s-os sztereó szakasz egyben ~0,3 s-ig fogná
          // a JS-szálat (mérve: a lejátszás közben szeletek késtek)
          for (let a = 0; a < frames; a += 32768) {
            const b = Math.min(frames, a + 32768);
            for (let i = a; i < b; i++) {
              for (let c = 0; c < ch; c++) chans[c][i] = all[(i + skip) * ch + c];
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        }
        this.segs.set(k, chans);
        this.touch(k);
      } catch (caught) {
        logCaught('lib/longSource.ts:load', caught);
      } finally {
        this.loading.delete(k);
        try {
          if (out.exists) out.delete();
        } catch (cleanup) {
          logCaught('lib/longSource.ts:cleanup', cleanup);
        }
      }
    })();
    this.loading.set(k, task);
    return task;
  }

  private touch(k: number): void {
    this.order = this.order.filter((x) => x !== k);
    this.order.push(k);
    while (this.order.length > MAX_SEGMENTS) {
      const old = this.order.shift();
      if (old !== undefined) this.segs.delete(old);
    }
  }

  /** a betöltött szakaszok száma (mérés) */
  loaded(): number {
    return this.segs.size;
  }

  /** a `[from, to)` minták csatornánként (a forráson kívül csend); null, ha egy szakasz hiányzik */
  read(from: number, to: number): Float32Array[] | null {
    const n = Math.max(0, to - from);
    if (this.channels === 0) {
      // még semmi nincs betöltve: a csatornaszám sem ismert
      return from < 0 && to <= 0 ? [new Float32Array(n)] : null;
    }
    const out = Array.from({ length: this.channels }, () => new Float32Array(n));
    let i = Math.max(from, 0);
    while (i < to) {
      const k = Math.floor(i / SEG);
      const seg = this.segs.get(k);
      if (!seg) {
        return null;
      }
      const segEnd = Math.min(to, (k + 1) * SEG);
      for (let c = 0; c < this.channels; c++) {
        out[c].set(seg[c].subarray(i - k * SEG, segEnd - k * SEG), i - from);
      }
      i = segEnd;
    }
    return out;
  }
}

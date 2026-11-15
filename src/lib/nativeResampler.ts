import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { resamplerTable, StreamResampler } from '@/lib/streamResampler';

/**
 * ⚡ A folyamatos átmintavételező natívan (`RemixRender.resampler*`, C — a JS `StreamResampler` bitre azonos
 * tükre: a fázistáblát a JS adja, az összegzés double-ben azonos sorrendben). Csatornánként egy natív állapot.
 * A natív függvények nélküli buildben (és weben) a JS-változat fut.
 */
export interface Resampler {
  process(chunk: Float32Array[]): Float32Array[];
  flush(): Float32Array[];
}

type Native = {
  resamplerCreate?: (up: number, down: number, half: number, table: Float32Array) => number;
  resamplerProcess?: (h: number, input: Float32Array, output: Float32Array) => number;
  resamplerFlush?: (h: number, output: Float32Array) => number;
  resamplerDestroy?: (h: number) => void;
};
const mod = Platform.OS === 'web' ? null : requireOptionalNativeModule<Native>('RemixRender');

export function nativeResamplerAvailable(): boolean {
  return typeof mod?.resamplerCreate === 'function' && typeof mod.resamplerProcess === 'function';
}

class NativeResampler implements Resampler {
  private readonly handles: number[];
  private readonly up: number;
  private readonly down: number;
  private readonly half: number;
  constructor(inRate: number, outRate: number, channels: number, halfTaps?: number) {
    const t = resamplerTable(inRate, outRate, halfTaps);
    this.up = t.up;
    this.down = t.down;
    this.half = t.half;
    const flat = new Float32Array(t.up * 2 * t.half);
    t.table.forEach((w, p) => flat.set(w, p * 2 * t.half));
    this.handles = Array.from({ length: channels }, () => mod!.resamplerCreate!(t.up, t.down, t.half, flat));
  }
  private cap(n: number): number {
    return Math.ceil(((n + 4 * this.half + this.down) * this.up) / this.down) + 64;
  }
  process(chunk: Float32Array[]): Float32Array[] {
    return this.handles.map((h, c) => {
      const input = chunk[c] ?? chunk[0];
      const out = new Float32Array(this.cap(input.length));
      const w = mod!.resamplerProcess!(h, input, out);
      return out.slice(0, Math.max(0, w));
    });
  }
  flush(): Float32Array[] {
    const out = this.handles.map((h) => {
      const buf = new Float32Array(this.cap(0) + 8192);
      const w = mod!.resamplerFlush!(h, buf);
      return buf.slice(0, Math.max(0, w));
    });
    for (const h of this.handles) mod!.resamplerDestroy?.(h);
    return out;
  }
}

/** átmintavételező: natív, ha a build tudja; különben a JS */
export function makeResampler(inRate: number, outRate: number, channels: number, halfTaps?: number): Resampler {
  return nativeResamplerAvailable() ? new NativeResampler(inRate, outRate, channels, halfTaps) : new StreamResampler(inRate, outRate, channels, halfTaps);
}

/** 🧪 a JS-változat (a füstteszt összeveti vele a natívat) */
export function jsResampler(inRate: number, outRate: number, channels: number): Resampler {
  return new StreamResampler(inRate, outRate, channels);
}

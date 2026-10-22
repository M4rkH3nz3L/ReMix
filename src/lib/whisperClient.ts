import { decodeToMono16k } from '@/lib/audioDecode';
import type { TimeRange } from '@/lib/autoedit';
import { catalogAvailability, catalogEntry } from '@/lib/modelCatalog';
import {
  catalogRuntime,
  markModelUsed,
  modelFileUri,
  setModelSmokeResult,
} from '@/lib/modelRegistryClient';
import { whisperEngineAvailable } from '@/lib/nativeEngines';
import type { TranscriptLine } from '@/lib/transcripts';
import { bytesToBase64, floatPcmToBytes, makeTestTone } from '@/lib/wav';

/**
 * 🎙️ On-device Whisper kliens (local-ai Fázis A) — a whisper.rn natív motor
 * vékony rétege. A modell a registry-cache-ből jön (checksum-ellenőrzött
 * letöltés után), és a BP-1 szerint EGYSZERRE EGY kontextus él: új modell
 * betöltése elengedi az előzőt, háttérbe lépéskor/riasztáskor `releaseWhisper()`.
 * A kimenet a meglévő `TranscriptLine` formátum (idővonal-mp) — ugyanaz, mint a
 * worker-átirat útja, így a felirat/csend-vágás fogyasztók nem különböztetnek.
 *
 * A smoke-test (local-ai 5.3) determinista teszt-hangon ellenőrzi, hogy a
 * motor+modell páros tényleg fut — PASS-ig a katalógus nem adja használhatónak.
 */

interface WhisperContextLike {
  transcribe(
    filePathOrBase64: string,
    options?: Record<string, unknown>,
  ): { stop: () => Promise<void>; promise: Promise<WhisperResultLike> };
  transcribeData(
    data: string,
    options?: Record<string, unknown>,
  ): { stop: () => Promise<void>; promise: Promise<WhisperResultLike> };
  release(): Promise<void>;
}

interface WhisperResultLike {
  result: string;
  language?: string;
  segments: { text: string; t0: number; t1: number }[];
  isAborted?: boolean;
}

/** egyszerre EGY betöltött modell (BP-1) */
let active: { modelId: string; ctx: WhisperContextLike } | null = null;

/** A betöltött whisper-kontextus elengedése (háttérbe lépés / memory-warning). */
export async function releaseWhisper(): Promise<void> {
  const current = active;
  active = null;
  if (current) {
    try {
      await current.ctx.release();
    } catch {
      // a natív oldal már elengedhette — nem hiba
    }
  }
}

async function getContext(modelId: string): Promise<WhisperContextLike | null> {
  if (!whisperEngineAvailable()) {
    return null;
  }
  if (active?.modelId === modelId) {
    markModelUsed(modelId);
    return active.ctx;
  }
  const uri = modelFileUri(modelId);
  if (!uri) {
    return null;
  }
  await releaseWhisper();
  try {
    // dinamikus import: a jest/web környezet sosem tölti be a natív csomagot.
    // Az '/index' alútvonal kell: a csomag `exports`-ából hiányzik a gyökér-
    // bejegyzés, így bundler-felbontás alatt a puszta 'whisper.rn' nem oldódik fel.
    const whisper = await import('whisper.rn/index');
    const ctx = (await whisper.initWhisper({
      filePath: uri.replace(/^file:\/\//, ''),
    })) as unknown as WhisperContextLike;
    active = { modelId, ctx };
    markModelUsed(modelId);
    return ctx;
  } catch {
    return null;
  }
}

function toLines(result: WhisperResultLike): TranscriptLine[] {
  // a whisper.cpp t0/t1 egysége 10 ms (centisec) → mp
  return (result.segments ?? [])
    .map((s) => ({ start: s.t0 / 100, end: s.t1 / 100, text: s.text.trim() }))
    .filter((l) => l.text.length > 0 && l.end > l.start);
}

export interface OnDeviceTranscript {
  lines: TranscriptLine[];
  /** nyers beszéd-sávok a sorokból (a csend-vágás bemenete) */
  speech: TimeRange[];
  language?: string;
}

/**
 * WAV-fájl átirata az eszközön. `null`, ha nincs motor/modell vagy a futás
 * elbukik — a hívó a worker-útra (vagy heurisztikára) esik vissza (BP-4).
 */
export async function transcribeWavOnDevice(
  modelId: string,
  wavUri: string,
  opts: { language?: string; onProgress?: (pct: number) => void } = {},
): Promise<OnDeviceTranscript | null> {
  const ctx = await getContext(modelId);
  if (!ctx) {
    return null;
  }
  try {
    const { promise } = ctx.transcribe(wavUri.replace(/^file:\/\//, ''), {
      language: opts.language,
      onProgress: opts.onProgress,
    });
    const result = await promise;
    if (result.isAborted) {
      return null;
    }
    const lines = toLines(result);
    return {
      lines,
      speech: lines.map((l) => ({ start: l.start, end: l.end })),
      language: result.language,
    };
  } catch {
    return null;
  }
}

/** a legjobb HASZNÁLHATÓ (letöltött + smoke-PASS) whisper-modell; base > tiny */
export function bestUsableWhisperModelId(): string | null {
  const rt = catalogRuntime();
  for (const id of ['whisper-base-q5', 'whisper-tiny-q8']) {
    const entry = catalogEntry(id);
    if (entry && catalogAvailability(entry, rt) === 'validated') {
      return id;
    }
  }
  return null;
}

/**
 * Tetszőleges média (mp4/m4a/mp3/wav) átirata az eszközön: natív dekódolás
 * 16 kHz mono PCM-re (`audioDecode`), majd whisper a nyers PCM-en. `null`, ha
 * nincs használható modell / a dekódolás vagy a futás elbukik (→ worker-út).
 */
export async function transcribeMediaOnDevice(
  uri: string,
  opts: { modelId?: string; language?: string } = {},
): Promise<OnDeviceTranscript | null> {
  const modelId = opts.modelId ?? bestUsableWhisperModelId();
  if (!modelId) {
    return null;
  }
  const pcm = await decodeToMono16k(uri);
  if (!pcm || pcm.length === 0) {
    return null;
  }
  const ctx = await getContext(modelId);
  if (!ctx) {
    return null;
  }
  try {
    const { promise } = ctx.transcribeData(bytesToBase64(floatPcmToBytes(pcm)), {
      language: opts.language,
    });
    const result = await promise;
    if (result.isAborted) {
      return null;
    }
    const lines = toLines(result);
    return {
      lines,
      speech: lines.map((l) => ({ start: l.start, end: l.end })),
      language: result.language,
    };
  } catch {
    return null;
  }
}

/**
 * 🧪 Használat-előtti smoke-test (local-ai 5.3): determinista 1 mp-es teszt-hang
 * megy át a motor+modell pároson. Siker → 'pass' (a katalógus 'validated'),
 * futási hiba → 'fail' (nem választható). Ha a MOTOR hiányzik, nem minősítünk
 * (false, jelölés nélkül) — az nem a modell hibája.
 */
export async function runWhisperSmokeTest(modelId: string): Promise<boolean> {
  if (!whisperEngineAvailable()) {
    return false;
  }
  const ctx = await getContext(modelId);
  if (!ctx) {
    setModelSmokeResult(modelId, 'fail');
    return false;
  }
  try {
    const pcm = bytesToBase64(floatPcmToBytes(makeTestTone(1)));
    const { promise } = ctx.transcribeData(pcm, {});
    const result = await promise;
    const ok = Array.isArray(result.segments);
    setModelSmokeResult(modelId, ok ? 'pass' : 'fail');
    return ok;
  } catch {
    setModelSmokeResult(modelId, 'fail');
    return false;
  }
}

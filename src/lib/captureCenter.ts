/**
 * 🎮 Capture Center modell (S-GAMER — MASTER §8) — a felvétel-terv: screen/game/
 * webcam/mic/system-audio/party-audio KÜLÖN sávokra, replay-buffer (instant-
 * replay) és felvétel közbeni hotkey-markerek. A tényleges rögzítés natív
 * (ReplayKit / MediaProjection — `screenRecord` capability, `local`/ingyen); ez a
 * modul a TISZTA, tesztelhető terv-modell + validáció.
 */

export type CaptureSourceKind = 'screen' | 'game' | 'webcam' | 'mic' | 'systemAudio' | 'partyAudio';

export const CAPTURE_SOURCE_KINDS: CaptureSourceKind[] = [
  'screen',
  'game',
  'webcam',
  'mic',
  'systemAudio',
  'partyAudio',
];

interface CaptureKindMeta {
  media: 'video' | 'audio';
  /** alap sáv-címke (a külön sávokhoz) */
  track: string;
}

export const CAPTURE_KIND_META: Record<CaptureSourceKind, CaptureKindMeta> = {
  screen: { media: 'video', track: 'screen' },
  game: { media: 'video', track: 'game' },
  webcam: { media: 'video', track: 'facecam' },
  mic: { media: 'audio', track: 'mic' },
  systemAudio: { media: 'audio', track: 'system' },
  partyAudio: { media: 'audio', track: 'party' },
};

export interface CaptureSource {
  kind: CaptureSourceKind;
  enabled: boolean;
  /** melyik (külön) sávra kerül a forrás */
  track: string;
}

export interface CaptureMarker {
  time: number;
  label?: string;
}

export interface CapturePlan {
  sources: CaptureSource[];
  /** replay-buffer / instant-replay hossza mp-ben (0 = kikapcsolva) */
  replayBufferSec: number;
  markers: CaptureMarker[];
}

/** Alap-terv: képernyő + mikrofon felvéve, 30 mp replay-buffer. */
export function defaultCapturePlan(): CapturePlan {
  return {
    sources: CAPTURE_SOURCE_KINDS.map((kind) => ({
      kind,
      enabled: kind === 'screen' || kind === 'mic',
      track: CAPTURE_KIND_META[kind].track,
    })),
    replayBufferSec: 30,
    markers: [],
  };
}

function mapSource(plan: CapturePlan, kind: CaptureSourceKind, fn: (s: CaptureSource) => CaptureSource): CapturePlan {
  return { ...plan, sources: plan.sources.map((s) => (s.kind === kind ? fn(s) : s)) };
}

export function toggleSource(plan: CapturePlan, kind: CaptureSourceKind): CapturePlan {
  return mapSource(plan, kind, (s) => ({ ...s, enabled: !s.enabled }));
}

export function setSourceTrack(plan: CapturePlan, kind: CaptureSourceKind, track: string): CapturePlan {
  return mapSource(plan, kind, (s) => ({ ...s, track: track.trim() || s.track }));
}

export function setReplayBuffer(plan: CapturePlan, seconds: number): CapturePlan {
  return { ...plan, replayBufferSec: Math.max(0, Math.round(seconds)) };
}

/** Hotkey/clip-marker felvétel közben (idő szerint rendezve tartva). */
export function addMarker(plan: CapturePlan, time: number, label?: string): CapturePlan {
  const marker: CaptureMarker = { time: Math.max(0, time), ...(label ? { label } : {}) };
  const markers = [...plan.markers, marker].sort((a, b) => a.time - b.time);
  return { ...plan, markers };
}

export function enabledSources(plan: CapturePlan): CaptureSource[] {
  return plan.sources.filter((s) => s.enabled);
}

export type CaptureErrorCode = 'no_source' | 'no_video' | 'duplicate_track';

export interface CaptureError {
  code: CaptureErrorCode;
  detail?: string;
}

/**
 * Terv-validáció: legyen legalább egy engedélyezett forrás, legyen legalább egy
 * VIDEÓ-forrás, és az engedélyezett források KÜLÖN sávokra kerüljenek (nincs
 * ütköző sáv-címke).
 */
export function validateCapturePlan(plan: CapturePlan): { ok: boolean; errors: CaptureError[] } {
  const errors: CaptureError[] = [];
  const on = enabledSources(plan);
  if (on.length === 0) {
    errors.push({ code: 'no_source' });
  }
  if (on.length > 0 && !on.some((s) => CAPTURE_KIND_META[s.kind].media === 'video')) {
    errors.push({ code: 'no_video' });
  }
  const seen = new Set<string>();
  for (const s of on) {
    if (seen.has(s.track)) {
      errors.push({ code: 'duplicate_track', detail: s.track });
    }
    seen.add(s.track);
  }
  return { ok: errors.length === 0, errors };
}

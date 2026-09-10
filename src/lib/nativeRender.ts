import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';

import type { RenderSettings } from '@/lib/render';
import type { Project } from '@/types/project';

/**
 * 📱 Eszközön futó render — a #1 termék-blokkoló feloldása.
 *
 * Az ALAP MP4-export a TELEFONON készül, szerver nélkül → valós felhasználónál
 * is működik, ingyen. A tényleges kompozitálás/enkódolás natív modul dolga:
 *   • iOS: AVFoundation (AVMutableComposition + AVAssetExportSession)
 *   • Android: MediaCodec + MediaMuxer
 * (lásd `modules/remix-render/`). Ez a natív kód CSAK dev/EAS buildben él —
 * Expo Go-ban a `requireOptionalNativeModule` `null`-t ad, és a router a
 * felhő-renderre esik vissza (Pro), vagy beszédes hibát mutat.
 *
 * Ez a fájl a JS-híd: futásidejű detektálás + a projekt → natív render-terv
 * fordítása. A natív oldal a terv EGY jól definiált részhalmazát valósítja meg
 * (videó-vágás/összefűzés/sebesség + hang-mix + kimeneti méret); a fejlett
 * effektek (fejlett átmenetek, 3D, AI) továbbra is a felhő-render sajátjai.
 */

interface NativeProgressEvent {
  progress: number; // 0–1
}

interface RemixRenderModule {
  /** A render-tervet (JSON) MP4-re rendereli; a kész fájl URI-ját adja vissza. */
  exportPlan(planJson: string, outputPath: string): Promise<string>;
  addListener(
    event: 'onProgress',
    listener: (e: NativeProgressEvent) => void
  ): { remove: () => void };
}

const Native = requireOptionalNativeModule<RemixRenderModule>('RemixRender');

/** Elérhető-e az eszközön-render ezen a buildon? (Expo Go-ban nem.) */
export function isNativeRenderAvailable(): boolean {
  return Native != null;
}

/** Az eszközön-render nem elérhető ezen a buildon (pl. Expo Go). */
export class LocalRenderUnavailableError extends Error {
  constructor() {
    super(
      'Az eszközön-render ehhez a buildhez nem érhető el (Expo Go). Használd a ' +
        'felhő-rendert (Pro), vagy készíts natív buildet (npx expo run:ios).'
    );
    this.name = 'LocalRenderUnavailableError';
  }
}

// ── projekt → natív render-terv ──────────────────────────────────────────

interface PlanVideoSegment {
  uri: string;
  /** idővonal-kezdet (mp) */
  atSec: number;
  /** forrás-vágás kezdete (mp) */
  inSec: number;
  /** idővonal-hossz (mp) — a forrásból fogyasztott = durationSec * speed */
  durationSec: number;
  speed: number;
  volume: number;
  filter: string;
}

interface PlanAudioSegment {
  uri: string;
  atSec: number;
  inSec: number;
  durationSec: number;
  volume: number;
}

interface RenderPlan {
  width: number;
  height: number;
  fps: number;
  /** háttérszín (letterbox / üres hely) */
  background: string;
  video: PlanVideoSegment[];
  audio: PlanAudioSegment[];
}

const AUDIO_TRACKS = new Set(['music', 'voiceover', 'sfx']);

function evenDim(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

/** Kimeneti méret a képarányból + a rövidebb oldalból (settings.resolution). */
function outputSize(project: Project, shortSide: number): { width: number; height: number } {
  switch (project.aspectRatio) {
    case '16:9':
      return { width: evenDim((shortSide * 16) / 9), height: evenDim(shortSide) };
    case '1:1':
      return { width: evenDim(shortSide), height: evenDim(shortSide) };
    case '9:16':
    default:
      return { width: evenDim(shortSide), height: evenDim((shortSide * 16) / 9) };
  }
}

/**
 * A projektből a natív oldal által értelmezett render-tervet épít. Csak a helyi
 * fájl-alapú (nem http-stream) videó/hang-klipeket veszi — a felhő-forrásokat
 * (URL-import stream) az eszközön-render kihagyja, azok a felhő-render sajátjai.
 */
export function buildRenderPlan(project: Project, settings: RenderSettings): RenderPlan {
  const { width, height } = outputSize(project, settings.resolution);
  const video: PlanVideoSegment[] = [];
  const audio: PlanAudioSegment[] = [];

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.kind === 'video' && !clip.uri.startsWith('http')) {
        video.push({
          uri: clip.uri,
          atSec: clip.start,
          inSec: clip.trimIn ?? 0,
          durationSec: clip.duration,
          speed: clip.speed ?? 1,
          volume: clip.volume ?? 1,
          filter: clip.filterId ?? 'none',
        });
      } else if (clip.kind === 'audio' && AUDIO_TRACKS.has(track.type) && !clip.uri.startsWith('http')) {
        audio.push({
          uri: clip.uri,
          atSec: clip.start,
          inSec: (clip as { trimIn?: number }).trimIn ?? 0,
          durationSec: clip.duration,
          volume: clip.volume ?? 1,
        });
      }
    }
  }

  // idővonal-sorrend, hogy a natív összefűzés determinisztikus legyen
  video.sort((a, b) => a.atSec - b.atSec);
  audio.sort((a, b) => a.atSec - b.atSec);

  return { width, height, fps: settings.fps, background: '#000000', video, audio };
}

/** Igaz, ha a projekt eszközön is renderelhető (van legalább egy helyi videó). */
export function canRenderLocally(project: Project, settings: RenderSettings): boolean {
  return buildRenderPlan(project, settings).video.length > 0;
}

/**
 * Eszközön-render: a projekt → MP4 a telefonon, szerver nélkül. A kész fájl
 * `File`-ját adja vissza (a cache-ben). Nincs natív modul → dob.
 */
export async function renderLocal(
  project: Project,
  settings: RenderSettings,
  onProgress?: (progress: number) => void
): Promise<File> {
  if (!Native) {
    throw new LocalRenderUnavailableError();
  }
  const plan = buildRenderPlan(project, settings);

  const dir = new Directory(Paths.cache, 'render');
  if (!dir.exists) {
    dir.create();
  }
  const safe = project.name.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'video';
  const target = new File(dir, `${safe}.mp4`);
  try {
    if (target.exists) {
      target.delete();
    }
  } catch {
    // ha nem törölhető, az export úgyis hibát ad
  }

  const sub = onProgress
    ? Native.addListener('onProgress', (e) => onProgress(e.progress))
    : null;
  try {
    const outUri = await Native.exportPlan(JSON.stringify(plan), target.uri);
    return new File(outUri);
  } finally {
    sub?.remove();
  }
}

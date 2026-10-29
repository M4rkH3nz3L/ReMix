import { requireOptionalNativeModule } from 'expo';
import { Directory, File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';
import { PixelRatio, Platform } from 'react-native';

import { resolveClipUri } from '@/lib/assetResolve';
import { deviceTextClips, deviceTextOverlaySpecs } from '@/lib/overlayPlan';
import { hasOverlayRasterHost, rasterTextOverlays } from '@/lib/overlayRasterBridge';
import type { RenderSettings } from '@/lib/render';
import { localRenderMatchesPreview } from '@/lib/renderParity';
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
  /** A futó render megszakítása — a natív loop kilép + a részfájlt törli. */
  cancel(): Promise<void>;
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

/**
 * Megszakítási hiba a `render.ts` `RenderCancelledError`-ével AZONOS néven.
 * Szándékosan nem importáljuk az osztályt: a `render.ts` behúzza ezt a modult,
 * tehát körkörös import lenne. Az `isRenderCancelledError()` NÉV alapján is
 * felismeri, ezért a hívók egységesen kezelik.
 */
function cancelledError(): Error {
  const err = new Error(tr('lib.render.cancelled'));
  err.name = 'RenderCancelledError';
  return err;
}

/** Az eszközön-render nem elérhető ezen a buildon (pl. Expo Go). */
export class LocalRenderUnavailableError extends Error {
  constructor() {
    super(tr('lib.nativeRender.unavailable'));
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
  /** 🏷️ ReMix-vízjel a kimenetre (ingyen on-device, nem-fizető tier — `exportPolicy`) */
  watermark?: boolean;
  /** 🖼️ szöveg/felirat-overlay-k (Android): teljes-vásznas PNG + idő-ablak +
   *  belépő animáció paraméterei (a natív OverlayRender játssza újra) */
  overlays?: {
    png: string;
    clipId: string;
    atSec: number;
    durationSec: number;
    opacity: number;
    anim: 'none' | 'fade' | 'slide' | 'pop' | 'pulse' | 'shake';
    ampNorm: number;
    anchorX: number;
    anchorY: number;
  }[];
  /** 🎞️ cél-kodek (Fázis E): 'hevc' → kisebb fájl, ha az eszköz bírja; alap h264 */
  codec?: string;
  /** cél-bitráta bit/s-ben (0/hiányzó = automatikus a felbontásból) */
  bitRate?: number;
}

const AUDIO_TRACKS = new Set(['music', 'voiceover', 'sfx']);

function evenDim(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r + 1;
}

/** Kimeneti méret a képarányból + a rövidebb oldalból (settings.resolution). */
export function outputSize(project: Pick<Project, 'aspectRatio'>, shortSide: number): { width: number; height: number } {
  // a batch-export platform-presetje (Instagram) 4:5-öt is kér — a projekt-típuson
  // kívüli érték, ezért string-ként vizsgáljuk (B14: eddig csendben 9:16 lett)
  switch (project.aspectRatio as string) {
    case '16:9':
      return { width: evenDim((shortSide * 16) / 9), height: evenDim(shortSide) };
    case '1:1':
      return { width: evenDim(shortSide), height: evenDim(shortSide) };
    case '4:5':
      return { width: evenDim(shortSide), height: evenDim((shortSide * 5) / 4) };
    case '9:16':
      return { width: evenDim(shortSide), height: evenDim((shortSide * 16) / 9) };
    default:
      throw new Error(`Ismeretlen képarány: ${String(project.aspectRatio)}`);
  }
}

/**
 * A projektből a natív oldal által értelmezett render-tervet épít. Csak a helyi
 * fájl-alapú (nem http-stream) videó/hang-klipeket veszi — a felhő-forrásokat
 * (URL-import stream) az eszközön-render kihagyja, azok a felhő-render sajátjai.
 */
export function buildRenderPlan(
  project: Project,
  settings: RenderSettings,
  watermark = false
): RenderPlan {
  const { width, height } = outputSize(project, settings.resolution);
  const video: PlanVideoSegment[] = [];
  const audio: PlanAudioSegment[] = [];

  for (const track of project.tracks) {
    for (const clip of track.clips) {
      // 🔗 az asset a forrás-igazság (ADR-012): a feloldott URI-t vesszük (a
      // http-guard is ezt nézi). Ma megegyezik a klip uri-cache-ével, relink
      // után (Fázis 3) viszont az asset frissebb uri-ja érvényesül itt is.
      const uri = resolveClipUri(project, clip);
      // csak a FŐ videósáv fűzhető egymás után — a PiP/overlay-sáv videója a
      // paritás-kapun át a felhőre megy (B10: eddig vágásként került a kimenetbe)
      if (clip.kind === 'video' && track.type === 'video' && uri && !uri.startsWith('http')) {
        video.push({
          uri,
          atSec: clip.start,
          inSec: clip.trimIn ?? 0,
          durationSec: clip.duration,
          speed: clip.speed ?? 1,
          volume: clip.volume ?? 1,
          filter: clip.filterId ?? 'none',
        });
      } else if (clip.kind === 'audio' && AUDIO_TRACKS.has(track.type) && uri && !uri.startsWith('http')) {
        audio.push({
          uri,
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

  return {
    width,
    height,
    fps: settings.fps,
    background: '#000000',
    video,
    audio,
    ...(watermark ? { watermark: true } : {}),
    ...(settings.codec === 'hevc' ? { codec: 'hevc' } : {}),
    ...(settings.bitrateMbps && settings.bitrateMbps > 0
      ? { bitRate: Math.round(settings.bitrateMbps * 1_000_000) }
      : {}),
  };
}

/**
 * Igaz, ha a projekt eszközön is renderelhető: van legalább egy helyi videó, ÉS
 * 🎯 a PARITÁS-KAPU szerint az eszköz-motor a LÁTOTT tartalmat hiánytalanul
 * vissza tudja adni (szöveg/effekt/átmenet/kulcskocka stb. → felhő-út). Eddig a
 * plan-builder ezeket némán eldobta, és a kész videóból hiányzott a felirat meg
 * az effekt — a WYSIWYG-szabály miatt ilyenkor NEM választható az eszköz-motor.
 */
export function canRenderLocally(project: Project, settings: RenderSettings): boolean {
  if (buildRenderPlan(project, settings).video.length === 0) {
    return false;
  }
  const platform = Platform.OS === 'android' ? 'android' : 'ios';
  if (!localRenderMatchesPreview(project, platform)) {
    return false;
  }
  // 🖼️ szöveg-overlay kell → csak raszter-hosttal megy (a szerkesztő adja); host
  // nélkül (pl. feed-posztolás háttérből) a felhő-út a helyes
  if (deviceTextClips(project).length > 0 && !hasOverlayRasterHost()) {
    return false;
  }
  return true;
}

/**
 * Eszközön-render: a projekt → MP4 a telefonon, szerver nélkül. A kész fájl
 * `File`-ját adja vissza (a cache-ben). Nincs natív modul → dob.
 *
 * MEGSZAKÍTÁS (Fázis D): a natív modulnak van `cancel()`-je — az `AbortSignal`
 * abortjára meghívjuk, mire a natív decode/encode loop a következő iterációnál
 * kilép és a részfájlt törli (nem csak a JS-hívást engedjük el). Az iOS-oldal
 * valódi `cancelExport`-ja külön, követő lépés.
 */
export async function renderLocal(
  project: Project,
  settings: RenderSettings,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
  watermark = false
): Promise<File> {
  if (!Native) {
    throw new LocalRenderUnavailableError();
  }
  const plan = buildRenderPlan(project, settings, watermark);

  // 🖼️ szöveg/felirat-overlay-k (Android): a preview-komponens snapshotjából
  // raszterizált PNG-k + a belépő animáció paraméterei a natív újrajátszáshoz.
  // A raszter-vászon dp-mérete úgy van megválasztva, hogy a capture pixel-mérete
  // a kimenettel egyezzen (dp × pixelRatio ≈ plan px).
  if (Platform.OS === 'android') {
    const specs = deviceTextOverlaySpecs(project, plan.height / PixelRatio.get());
    if (specs.length > 0) {
      const pngByClip = await rasterTextOverlays({
        project,
        width: plan.width / PixelRatio.get(),
        height: plan.height / PixelRatio.get(),
        clipIds: specs.map((sp) => sp.clipId),
      });
      const overlays = specs
        .filter((sp) => pngByClip.has(sp.clipId))
        .map((sp) => ({ ...sp, png: pngByClip.get(sp.clipId)! }));
      if (overlays.length < specs.length) {
        // 🎯 WYSIWYG: ha egy felirat rasztere elbukott, NEM adunk hiányos videót
        throw new Error(tr('lib.render.overlayRasterFailed'));
      }
      (plan as { overlays?: unknown }).overlays = overlays;
    }
  }

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
    const exporting = Native.exportPlan(JSON.stringify(plan), target.uri);
    if (!signal) {
      return new File(await exporting);
    }
    if (signal.aborted) {
      Native.cancel().catch(() => {});
      throw cancelledError();
    }
    // versenyeztetés: amelyik előbb — a kész render vagy a megszakítás.
    // Abortkor a natív `cancel()` ténylegesen leállítja a kódolást. A listener
    // a render VÉGÉN lekerül a signalról — különben egy befejezés utáni abort
    // (pl. az overlay cleanup-ja) a KÖVETKEZŐ render natív exportját lőné le.
    let onAbort: (() => void) | null = null;
    try {
      const outUri = await new Promise<string>((resolve, reject) => {
        onAbort = () => {
          Native.cancel().catch(() => {});
          reject(cancelledError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
        exporting.then(resolve, reject);
      });
      return new File(outUri);
    } finally {
      if (onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  } finally {
    sub?.remove();
  }
}

import { Directory, File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';

import { makeId } from '@/lib/id';
import type { ProgressUpdate } from '@/lib/progress';
import type { YtImport, YtKind } from '@/lib/youtube';

/**
 * 🆓 ON-DEVICE YouTube-import (worker és Pro NÉLKÜL).
 *
 * A worker (yt-dlp + ffmpeg) helyett közvetlenül a YouTube belső InnerTube
 * `player` végpontját kérdezzük egy MOBIL-KLIENS (iOS/Android) kontextussal —
 * ezek historikusan DIREKT (deciphered) progresszív stream-URL-eket adnak,
 * signature-fejtés (JS-eval) NÉLKÜL, ami eszközön (fetch-csel) reális.
 *
 * Csak azt választjuk, ami eszközön ffmpeg NÉLKÜL is működik:
 *   • videó → progresszív, muxed H.264/AAC MP4 (itag 22 = 720p, 18 = 360p) —
 *     egyetlen fájl, iOS AVPlayer/expo-video egyből lejátssza,
 *   • hang  → AAC m4a (itag 140).
 *
 * BEST-EFFORT: a YouTube aktívan küzd a kinyerés ellen (ezért frissül a yt-dlp
 * folyamatosan), ezért ha nincs direkt stream / nem YouTube-URL / képkocka kell,
 * `null`-t adunk — a hívó ilyenkor a fizetős worker-útra esik vissza (Pro).
 *
 * A modul szándékosan függőség-mentes (csak `fetch` + `expo-file-system`), így
 * nem destabilizálja a buildet; a belseje később `youtubei.js`-re cserélhető
 * ugyanezzel a `importYouTubeLocal` interfésszel.
 */

/** YouTube videó-azonosító a gyakori URL-formákból (11 karakteres id). */
export function parseYouTubeId(raw: string): string | null {
  const s = raw.trim();
  // youtu.be/<id>
  let m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) {
    return m[1];
  }
  // youtube.com/watch?v=<id>
  m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) {
    return m[1];
  }
  // youtube.com/shorts|embed|v|live/<id>
  m = s.match(/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/);
  if (m) {
    return m[1];
  }
  return null;
}

/** InnerTube `format`/`adaptiveFormat` — csak a nekünk kellő mezők. */
interface YtFormat {
  itag: number;
  url?: string;
  mimeType: string;
  width?: number;
  height?: number;
  bitrate?: number;
  approxDurationMs?: string;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string };
  streamingData?: { formats?: YtFormat[]; adaptiveFormats?: YtFormat[] };
  videoDetails?: { lengthSeconds?: string };
}

/**
 * Mobil-InnerTube kliensek — sorban próbáljuk, amíg valamelyik OK + van
 * streamingData. Az iOS/Android app-kliens direkt progresszív URL-t ad
 * (nem web → nincs Origin/po_token akadály).
 */
const CLIENTS = [
  {
    name: 'IOS',
    version: '19.45.4',
    key: 'AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc',
    userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
    context: { deviceModel: 'iPhone16,2' } as Record<string, unknown>,
  },
  {
    name: 'ANDROID',
    version: '19.44.38',
    key: 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w',
    userAgent: 'com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip',
    context: { androidSdkVersion: 34 } as Record<string, unknown>,
  },
] as const;

async function fetchPlayer(videoId: string): Promise<PlayerResponse | null> {
  for (const client of CLIENTS) {
    try {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${client.key}&prettyPrint=false`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': client.userAgent,
            'X-YouTube-Client-Name': client.name === 'IOS' ? '5' : '3',
            'X-YouTube-Client-Version': client.version,
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: client.name,
                clientVersion: client.version,
                hl: 'en',
                gl: 'US',
                ...client.context,
              },
            },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
          }),
        }
      );
      if (!res.ok) {
        continue;
      }
      const body = (await res.json()) as PlayerResponse;
      if (body.playabilityStatus?.status === 'OK' && body.streamingData) {
        return body;
      }
    } catch {
      // hálózati/parse hiba → következő kliens
    }
  }
  return null;
}

/** progresszív, muxed H.264/AAC MP4 (itag 22 > 18 > bármely avc1+mp4a) — direkt URL-lel. */
function pickVideo(formats: YtFormat[]): YtFormat | null {
  const muxed = formats.filter(
    (f) => f.url && /mp4/.test(f.mimeType) && /avc1/.test(f.mimeType) && /mp4a/.test(f.mimeType)
  );
  return (
    muxed.find((f) => f.itag === 22) ??
    muxed.find((f) => f.itag === 18) ??
    muxed[0] ??
    null
  );
}

/** AAC m4a hang (itag 140 > legjobb bitráta) — direkt URL-lel. */
function pickAudio(adaptive: YtFormat[]): YtFormat | null {
  const aac = adaptive.filter((f) => f.url && /mp4/.test(f.mimeType) && /mp4a/.test(f.mimeType));
  return (
    aac.find((f) => f.itag === 140) ??
    [...aac].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0] ??
    null
  );
}

/**
 * On-device YouTube-import. Sikeres esetben `{ uri, kind, duration, … }`; ha
 * eszközön nem oldható meg (nem YouTube-URL, képkocka, HD-only vagy csak
 * signatureCipher, letöltési hiba), `null` — a hívó a workerre esik vissza.
 */
export async function importYouTubeLocal(
  url: string,
  kind: YtKind,
  onProgress?: (update: ProgressUpdate) => void
): Promise<YtImport | null> {
  // képkockához eszközön ffmpeg kellene (-ss) → marad a worker
  if (kind === 'image') {
    return null;
  }
  // nem YouTube-URL (TikTok stb.) → a yt-dlp több oldalt tud, marad a worker
  const videoId = parseYouTubeId(url);
  if (!videoId) {
    return null;
  }

  onProgress?.({ phase: tr('lib.youtube.phaseExtract') });
  const player = await fetchPlayer(videoId);
  if (!player?.streamingData) {
    return null;
  }

  const format =
    kind === 'audio'
      ? pickAudio(player.streamingData.adaptiveFormats ?? [])
      : pickVideo(player.streamingData.formats ?? []);
  // nincs direkt URL (csak signatureCipher / nincs progresszív) → worker
  if (!format?.url) {
    return null;
  }

  const ext = kind === 'audio' ? 'm4a' : 'mp4';
  const dir = new Directory(Paths.document, 'media');
  try {
    dir.create();
  } catch {
    /* már létezik */
  }
  const target = new File(dir, `yt_${makeId('m')}.${ext}`);
  onProgress?.({ phase: tr('lib.youtube.phaseDownload') });
  try {
    await File.downloadFileAsync(format.url, target);
  } catch {
    return null;
  }
  if (!target.exists) {
    return null;
  }

  const duration =
    (player.videoDetails?.lengthSeconds ? Number(player.videoDetails.lengthSeconds) : 0) ||
    (format.approxDurationMs ? Number(format.approxDurationMs) / 1000 : 0);

  onProgress?.({ phase: tr('lib.youtube.phaseDone'), ratio: 1 });
  return {
    uri: target.uri,
    kind,
    duration,
    width: kind === 'video' ? format.width : undefined,
    height: kind === 'video' ? format.height : undefined,
  };
}

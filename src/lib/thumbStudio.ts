import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { aiConfigForTask } from '@/lib/aiProviders';
import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';
import type { Project, VideoClip } from '@/types/project';

/**
 * Thumbnail Studio (Creative Canvas): a worker kiválasztja a projekt első
 * videójának legjobb borítókép-kockáit — a jelöltek data-URI-ként jönnek,
 * mentés/megosztás koppintásra.
 */

export interface ThumbCandidate {
  /** forrás-mp */
  t: number;
  score: number;
  /** data URI az azonnali megjelenítéshez */
  uri: string;
  jpegBase64: string;
}

export async function suggestThumbnails(
  project: Project,
  count = 4
): Promise<ThumbCandidate[] | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const video = project.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .filter((c): c is VideoClip => c.kind === 'video')
    .sort((a, b) => a.start - b.start)[0];
  if (!video) {
    return null;
  }
  const base = renderServerUrl();
  try {
    const form = new FormData();
    form.append('media', new File(video.uri) as unknown as Blob, video.uri.split('/').pop() ?? 'media');
    form.append('count', String(count));
    const res = await uploadFetch(`${base}/thumbnails`, { method: 'POST', body: form });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      thumbs: { t: number; score: number; jpegBase64: string }[];
    };
    if (!Array.isArray(body.thumbs) || body.thumbs.length === 0) {
      return null;
    }
    return body.thumbs.map((t) => ({
      t: t.t,
      score: t.score,
      jpegBase64: t.jpegBase64,
      uri: `data:image/jpeg;base64,${t.jpegBase64}`,
    }));
  } catch {
    return null;
  }
}

/** 🎬 AI-címjavaslatok a borítóra (lokális AI vagy Claude a workeren) */
export async function fetchThumbHeadlines(summary: string): Promise<string[] | null> {
  try {
    const aiConfig = await aiConfigForTask('thumbHeadlines');
    const res = await uploadFetch(`${renderServerUrl()}/ai/thumbheadlines`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary, aiConfig }),
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { headlines: string[] };
    const list = (body.headlines ?? [])
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .slice(0, 3);
    return list.length > 0 ? list : null;
  } catch {
    return null;
  }
}

/** 🎬 a headline ráégetése a kiválasztott borítóra (worker Chromium-raszter) */
export async function composeThumbnail(
  thumb: ThumbCandidate,
  headline: string
): Promise<ThumbCandidate | null> {
  try {
    // a jelölt base64-e helyi fájlba kerül, mert a natív FormData fájl-uri-t vár
    const dir = new Directory(Paths.cache, 'thumbs');
    if (!dir.exists) {
      dir.create();
    }
    const src = new File(dir, `compose-src-${thumb.t.toFixed(1)}.jpg`);
    try {
      if (src.exists) {
        src.delete();
      }
    } catch {
      // felülírja a write
    }
    src.write(Uint8Array.from(atob(thumb.jpegBase64), (c) => c.charCodeAt(0)));
    const form = new FormData();
    form.append('media', new File(src.uri) as unknown as Blob, 'thumb.jpg');
    form.append('headline', headline);
    const res = await uploadFetch(`${renderServerUrl()}/thumbnails/compose`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { jpegBase64: string };
    if (!body.jpegBase64) {
      return null;
    }
    return {
      ...thumb,
      jpegBase64: body.jpegBase64,
      uri: `data:image/jpeg;base64,${body.jpegBase64}`,
    };
  } catch {
    return null;
  }
}

/** a kiválasztott borító mentése a Fotókba (ha engedélyezett) + megosztás */
export async function saveAndShareThumbnail(
  thumb: ThumbCandidate,
  projectName: string
): Promise<void> {
  const dir = new Directory(Paths.cache, 'thumbs');
  if (!dir.exists) {
    dir.create();
  }
  const safe = projectName.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'borito';
  const target = new File(dir, `${safe}-${thumb.t.toFixed(0)}s.jpg`);
  try {
    if (target.exists) {
      target.delete();
    }
  } catch {
    // ha nem törölhető, a write úgyis hibát ad
  }
  target.write(Uint8Array.from(atob(thumb.jpegBase64), (c) => c.charCodeAt(0)));

  try {
    const MediaLibrary = await import('expo-media-library');
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (permission.granted) {
      await MediaLibrary.saveToLibraryAsync(target.uri);
    }
  } catch {
    // engedély nélkül a megosztó is felajánlja a mentést
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(target.uri, {
      mimeType: 'image/jpeg',
      dialogTitle: tr('lib.thumbStudio.shareDialogTitle', { projectName }),
    });
  }
}

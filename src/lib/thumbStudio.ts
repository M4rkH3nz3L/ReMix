import { File } from 'expo-file-system';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Platform } from 'react-native';

import { aiConfigForTask } from '@/lib/aiProviders';
import { localThumbHeadlines } from '@/lib/localTasks';
import { uploadFetch } from '@/lib/upload';
import { renderServerUrl } from '@/lib/render';
import { workerAuthHeaders } from '@/lib/workerAuth';
import { makeId } from '@/lib/id';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { thumbnailFrameTimes } from '@/lib/thumbnailDoc';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 🖼️ Thumbnail Studio (CORE K5): a képkocka-jelöltek a TELEFONON készülnek a videó első klipjéből
 * (nincs szerveres kiválasztás, offline is megy); a választott kockából a videó-projekt
 * szerkeszthető thumbnail-lapja lesz (`thumbnailDoc`), amelyet a Kép Stúdió nyit meg.
 */

export interface ThumbFrame {
  /** forrás-mp */
  t: number;
  /** a kocka képe a projekt média-mappájában */
  uri: string;
}

export async function thumbnailFramesOnDevice(project: Project, count = 4): Promise<ThumbFrame[] | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  const plan = thumbnailFrameTimes(project, count);
  if (!plan) {
    return null;
  }
  const dir = projectMediaDir();
  if (!dir.exists) {
    dir.create();
  }
  const out: ThumbFrame[] = [];
  for (const t of plan.times) {
    try {
      const { uri } = await VideoThumbnails.getThumbnailAsync(plan.clip.uri, { time: Math.max(0, Math.round(t * 1000)), quality: 1 });
      // tartós helyre — a thumbnail-cache ideiglenes, a választott kocka a lap rétege lesz
      const target = new File(dir, `thumbframe_${makeId('img')}.jpg`);
      new File(uri).copy(target);
      out.push({ t, uri: target.uri });
    } catch (caught) {
      logCaught('lib/thumbStudio.ts:thumbnailFramesOnDevice', caught);
    }
  }
  return out.length > 0 ? out : null;
}

/** a nem választott jelöltek törlése (a választott a lap rétege marad) */
export function discardThumbFrames(frames: ThumbFrame[], keepUri?: string): void {
  for (const f of frames) {
    if (f.uri === keepUri) continue;
    try {
      const file = new File(f.uri);
      if (file.exists) file.delete();
    } catch (caught) {
      logCaught('lib/thumbStudio.ts:discardThumbFrames', caught);
    }
  }
}

/** 🎬 AI-címjavaslatok a borítóra (lokális AI vagy Claude a workeren).
 *  🧩 Worker/AI nélkül a LOKÁL sablon-út ad címeket (ingyen, offline). */
export async function fetchThumbHeadlines(summary: string): Promise<string[] | null> {
  try {
    const aiConfig = await aiConfigForTask('thumbHeadlines');
    const res = await uploadFetch(`${renderServerUrl()}/ai/thumbheadlines`, {
      method: 'POST',
      // 🔐 06: a /ai/thumbheadlines mostantól authenticated — a bejelentkezett
      // felhasználó Supabase-tokenje (a többi AI-hívás az aiFetch-en át már küldi)
      headers: { 'Content-Type': 'application/json', ...(await workerAuthHeaders()) },
      body: JSON.stringify({ summary, aiConfig }),
    });
    if (!res.ok) {
      return localThumbHeadlines(summary);
    }
    const body = (await res.json()) as { headlines: string[] };
    const list = (body.headlines ?? [])
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
      .slice(0, 3);
    return list.length > 0 ? list : localThumbHeadlines(summary);
  } catch (caught) {
    logCaught('lib/thumbStudio.ts:fetchThumbHeadlines', caught);
    return localThumbHeadlines(summary);
  }
}

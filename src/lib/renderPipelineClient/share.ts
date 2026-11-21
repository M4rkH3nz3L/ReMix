// 📲 A kész videó megosztása / mentése a Fotókba / posztolása platformra.
import { t as tr } from 'i18next';
import * as Sharing from 'expo-sharing';
import { Linking, Platform } from 'react-native';

import type { ProgressUpdate } from '@/lib/progress';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { logCswcr, studioKindOf } from '@/lib/cswcrClient';
import type { RenderOptions, RenderSettings } from '@/lib/renderPipeline/settings';
import { renderAndDownloadWeb } from './cloudExport';
import { renderMp4 } from './orchestrate';

/**
 * Render → mentés a Fotókba (engedéllyel, nem-fatális) → rendszer-megosztó.
 * A creator-flow vége: a kész videó a galériából azonnal tölthető TikTokra.
 */
export async function renderAndShareMp4(
  project: Project,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  opts?: RenderOptions
): Promise<void> {
  // 🌐 weben nincs on-device render / natív megosztó → a SZERVER renderel, és a
  // böngésző letölti a kész MP4-et (a `mode` itt nem értelmezett — csak felhő van)
  if (Platform.OS === 'web') {
    await renderAndDownloadWeb(project, onProgress, settings, opts?.signal);
    return;
  }
  const file = await renderMp4(project, onProgress, settings, opts);
  // 📊 CSWCR (CORE K4): a kész videó befejezi a láncot
  logCswcr({ type: 'export', projectId: project.id, kind: studioKindOf(project.kind) });

  // ide már csak NATÍVON jutunk (weben fentebb visszatértünk) → mentés a Fotókba
  let savedToPhotos = false;
  try {
    const MediaLibrary = await import('expo-media-library');
    const permission = await MediaLibrary.requestPermissionsAsync(true);
    if (permission.granted) {
      onProgress?.({ phase: tr('lib.render.phaseSavingToPhotos'), ratio: 1 });
      await MediaLibrary.saveToLibraryAsync(file.uri);
      savedToPhotos = true;
    }
  } catch (caught) {
    logCaught('lib/render.ts:renderAndShareMp4', caught);
    // engedély-megtagadás vagy hiba — a megosztó így is felajánlja a mentést
  }

  onProgress?.({
    phase: savedToPhotos
      ? tr('lib.render.phaseSavedToPhotosShare')
      : tr('lib.render.phaseShare'),
    ratio: 1,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'video/mp4',
      dialogTitle: `${project.name}.mp4`,
    });
  }
}

/** Posztolási célplatformok — a kész videó közvetlen megosztásához. */
export type PostTarget = 'tiktok' | 'reels' | 'youtube' | 'other';

/**
 * A kész videó posztolása egy platformra: render → Fotókba mentés (a TikTok/
 * Reels/YouTube innen, a galériából importál) → a platform megnyitása.
 * - Reels (iOS): az Instagram közvetlenül a Reels-szerkesztőbe nyílik a mentett
 *   videóval (`instagram://library?LocalIdentifier=…`).
 * - TikTok / YouTube / egyéb: az OS megosztó-lapja, ahol a platform megosztó-
 *   bővítménye a videót a saját feltöltőjébe/szerkesztőjébe tölti.
 * A feliratot/hangot a platform szerkesztőjében adod hozzá, egy koppintással
 * posztolsz. (A teljesen automatikus, appból induló feltöltéshez a platformok
 * hivatalos API-ja + saját fejlesztői kulcsaid kellenének — az külön réteg.)
 */
export async function renderAndPost(
  project: Project,
  target: PostTarget,
  onProgress?: (update: ProgressUpdate) => void,
  settings?: RenderSettings,
  opts?: RenderOptions
): Promise<void> {
  const file = await renderMp4(project, onProgress, settings, opts);
  // 📊 CSWCR (CORE K4): a kész videó befejezi a láncot
  logCswcr({ type: 'export', projectId: project.id, kind: studioKindOf(project.kind) });

  // Fotókba mentés — minden platform a galériából tudja betölteni a videót
  let assetId: string | null = null;
  if (Platform.OS !== 'web') {
    try {
      const MediaLibrary = await import('expo-media-library');
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (permission.granted) {
        onProgress?.({ phase: tr('lib.render.phaseSavingToPhotos'), ratio: 1 });
        const asset = await MediaLibrary.createAssetAsync(file.uri);
        assetId = asset?.id ?? null;
      }
    } catch (caught) {
      logCaught('lib/render.ts:renderAndPost', caught);
      // engedély-megtagadás vagy hiba — a megosztó így is felajánlja a mentést
    }
  }

  // Instagram Reels: iOS-en közvetlenül a szerkesztőbe nyílik a mentett videóval
  if (target === 'reels' && Platform.OS === 'ios' && assetId) {
    const igUrl = `instagram://library?LocalIdentifier=${encodeURIComponent(assetId)}`;
    try {
      if (await Linking.canOpenURL(igUrl)) {
        onProgress?.({ phase: tr('lib.render.phaseOpeningInstagramReels'), ratio: 1 });
        await Linking.openURL(igUrl);
        return;
      }
    } catch (caught) {
      logCaught('lib/render.ts:renderAndPost', caught);
      // az Instagram nincs telepítve / nem nyílt — a megosztó-lap a fallback
    }
  }

  // TikTok / YouTube / egyéb: OS megosztó-lap (a platform share-bővítménye viszi)
  onProgress?.({
    phase:
      target === 'tiktok'
        ? tr('lib.render.phaseChooseTikTok')
        : target === 'youtube'
          ? tr('lib.render.phaseChooseYouTube')
          : tr('lib.render.phaseShare'),
    ratio: 1,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'video/mp4',
      dialogTitle: `${project.name}.mp4`,
      UTI: 'public.mpeg-4',
    });
  }
}

import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Alert } from 'react-native';

import { setActiveSong, setSongRender, songNeedsRender, songRenderKey } from '@/lib/albumDoc';
import { buildAlbumVideoProject } from '@/lib/albumShare';
import { mixForExport } from '@/lib/audioExportMix';
import { publishRenderedProject } from '@/lib/feed';
import { logCaught } from '@/lib/logCaught';
import { downloadToCache } from '@/lib/media';
import type { ProgressUpdate } from '@/lib/progress';
import { projectDuration } from '@/lib/projectUtils';
import { exportAudioFile, isRenderCancelledError } from '@/lib/render';
import { useEditorStore } from '@/store/editorStore';
import { guardPro } from '@/store/paywallStore';
import { withCancellableProgress } from '@/store/progressStore';
import { useSeoGate } from '@/store/seoGateStore';
import type { PostVisibility } from '@/types/social';

/**
 * 🎧💿➡️📲 Album megosztása a feedbe: a még nem renderelt (szerkesztőben épített) számokat
 * a workeren renderelem (swap az adott számra → audio-export → renderedUri), majd a borító +
 * a számok ALBUM-VIDEÓvá állnak össze (`buildAlbumVideoProject`) és a megszokott videó-úton
 * posztolódnak. Az IMPORTÁLT számok már „renderelt"-ek (a fájl maga), így azonnal mennek.
 * A32: a render óta szerkesztett szám újra renderelődik, a hang veszteségmentes és helyi
 * fájlként marad meg (nem lejáró linkként), hiba után is az eredeti szám aktív.
 */
export function useAlbumShare(t: TFunction) {
  const [albumSharing, setAlbumSharing] = useState(false);

  const renderAlbumSongs = async (report: (u: ProgressUpdate) => void, signal: AbortSignal) => {
    const store = useEditorStore.getState();
    const album0 = store.project!.album!;
    const originalActive = album0.activeSongId;
    try {
      for (const s of album0.songs) {
        // váltás a számra → a project.tracks ezt tükrözi → audio-render
        store.dispatch({ type: 'APPLY_ALBUM', album: setActiveSong(useEditorStore.getState().project!.album!, s.id) });
        const p = useEditorStore.getState().project!;
        const key = songRenderKey(p.tracks, p);
        const song = p.album!.songs.find((x) => x.id === s.id)!;
        if (!songNeedsRender(song, key)) {
          continue;
        }
        const st = useEditorStore.getState();
        const mix = mixForExport(p, st.isTrackAudible, st.masterVolume);
        if (!mix) {
          throw new Error(t('studio.audio.album.silentSong', { name: s.name }));
        }
        const url = await exportAudioFile(mix, 'flac', report, signal, { notify: false });
        const local = await downloadToCache(url, `album_${s.id}.flac`);
        if (!local) {
          throw new Error(t('studio.audio.album.downloadFailed', { name: s.name }));
        }
        store.dispatch({
          type: 'APPLY_ALBUM',
          album: setSongRender(useEditorStore.getState().project!.album!, s.id, local, projectDuration(p), key),
        });
      }
    } finally {
      // vissza az eredeti aktív számra — hibánál és megszakításnál is
      store.dispatch({ type: 'APPLY_ALBUM', album: setActiveSong(useEditorStore.getState().project!.album!, originalActive) });
    }
  };

  const shareAlbum = async (visibility: PostVisibility) => {
    if (!useEditorStore.getState().project?.album || albumSharing) {
      return;
    }
    // 📣 S22: a SEO a megosztáskor kell — hiányzik → bekéri (az album-poszt a projektéből örököl)
    if (!(await useSeoGate.getState().ensureSeo(useEditorStore.getState().project!))) {
      return;
    }
    setAlbumSharing(true);
    try {
      await guardPro(
        () =>
          withCancellableProgress(t('studio.audio.album.rendering'), async (report, signal) => {
            await renderAlbumSongs(report, signal);
            const albumProject = buildAlbumVideoProject(useEditorStore.getState().project!);
            if (!albumProject) {
              Alert.alert(t('common.error', { defaultValue: 'Hiba' }), t('studio.audio.album.needCover', { defaultValue: 'Az albumhoz borító és legalább egy renderelt szám kell.' }));
              return;
            }
            await publishRenderedProject(albumProject, report, { visibility });
            Alert.alert(t('studio.audio.album.doneTitle', { defaultValue: 'Megosztva' }), t('studio.audio.album.doneBody', { defaultValue: 'Az album felkerült a feedbe.' }));
          }),
        (e) => {
          logCaught('components/studio/audio/AudioStudioBody.tsx:shareAlbum', e);
          if (!isRenderCancelledError(e)) {
            Alert.alert(t('common.error', { defaultValue: 'Hiba' }), e.message);
          }
        }
      );
    } finally {
      setAlbumSharing(false);
    }
  };

  // A32: a közzététel nem indul megerősítés nélkül, és a láthatóság választható
  const confirmShareAlbum = () =>
    Alert.alert(t('studio.audio.album.confirmTitle'), t('studio.audio.album.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('studio.audio.album.shareFollowers'), onPress: () => void shareAlbum('followers') },
      { text: t('studio.audio.album.sharePublic'), onPress: () => void shareAlbum('public') },
    ]);

  return { albumSharing, confirmShareAlbum };
}

import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { isLoopbackUrl } from '@/lib/mediaUrl';
import type { ProgressUpdate } from '@/lib/progress';
import { needsPoster, posterFrameTime } from '@/lib/feedMedia';
import { stillVersion } from '@/lib/linkedAsset';
import { renderOnDevice } from '@/lib/renderStageRegistry';
import { posterNeedsRefresh, thumbnailDocOf } from '@/lib/thumbnailDoc';
import {
  buildSlideshowProject,
  carouselImageUris,
  type ImageShareMode,
  type SlideshowBuildOptions,
} from '@/lib/imageShare';
import { renderAndUploadWeb, renderProjectVersion, uploadMedia } from '@/lib/render';
import type { RenderMode } from '@/lib/render';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { saveProject } from '@/lib/storage';
import type { Project } from '@/types/project';
import type { FeedPost, PostVisibility } from '@/types/social';
import { logCaught } from '@/lib/logCaught';
import { buildRemixManifest, remixUploadUris, type RemixTracksManifest } from '@/lib/remixTracks';
import { publishPost } from '@/lib/feedClient/publish';

/**
 * 🎞️ A projekt RENDERELT videójának megosztása a feedbe. Ha még nincs renderelt
 * változat → renderel + a projektre menti; ha még nincs feltöltve → feltölti a
 * publikus Storage-ba; majd posztol a valódi `video_url`-lel. Az így elkészült
 * renderelt változat (uri + url) a projekten marad (újramegosztáshoz).
 * Visszaadja a posztot + a frissített projektet.
 */
export async function publishRenderedProject(
  project: Project,
  onProgress?: (u: ProgressUpdate) => void,
  opts?: {
    visibility?: PostVisibility;
    /** Pro: a render-motor választása (eszköz/felhő); hiányzó = auto */
    renderMode?: RenderMode;
    /** 🔀 remixelhető-e (az alkotó dönt — B27) */
    remixable?: boolean;
    /** 🔀 C3: a remix a sávokat kapja — a hang-sávok fájljai feltöltődnek (a kvótát terhelik) */
    remixTracks?: boolean;
  }
): Promise<{ post: FeedPost; project: Project }> {
  let updated = project;
  let rendered = project.rendered;

  if (!rendered?.uri) {
    // 🌐 weben nincs on-device render → a SZERVER renderel + a kész MP4 a Storage-ba
    // kerül (a visszakapott `rendered` már url-lel). Natívan: eszköz/felhő render.
    rendered =
      Platform.OS === 'web'
        ? await renderAndUploadWeb(project, onProgress)
        : await renderProjectVersion(
            project,
            onProgress,
            undefined,
            opts?.renderMode ? { mode: opts.renderMode } : undefined
          );
    updated = { ...updated, rendered };
    await saveProject(updated);
  }
  // ⚠️ A cache-elt `rendered.url` SZÁRMAZHAT egy korábbi (lokális) munkamenetből —
  // az a JELENLEGI (prod) kliensnek 404. Ezért ha nincs url VAGY loopback/lokális,
  // a videót ÚJRA feltöltjük a mostani (prod) tárba, projekt-mappába (<id>/video/…).
  if (!rendered.url || isLoopbackUrl(rendered.url)) {
    const url = await uploadMedia(rendered.uri, {
      projectId: project.id,
      kind: 'video',
      name: `${project.id}.mp4`,
    });
    rendered = { ...rendered, url };
    updated = { ...updated, rendered };
    await saveProject(updated);
  }

  // 🖼️ §2.8: borítókép a feed-rácshoz — ha nincs poster, a kész videó egy
  // reprezentatív kockájából generálunk egyet és feltöltjük (<id>/poster/…).
  // Best-effort: a getFilmstrip weben null-t ad, hibánál csendesen kimarad — a
  // publikálást SOHA nem buktatja. (A ffmpeg-transcoding + több-thumbnail a worker/infra.)
  // 🖼️ CORE K5: ha a projektnek szerkeszthető thumbnail-lapja van, a poszter abból készül (a
  // telefonon), és ha a lap azóta változott, újra — különben a videó egy kockája, mint eddig.
  const thumb = thumbnailDocOf(updated);
  if (thumb ? posterNeedsRefresh(rendered, thumb) : needsPoster(rendered)) {
    try {
      const poster = thumb
        ? await renderOnDevice(thumb, 720, { format: 'jpg', quality: 0.9 })
        : (await getFilmstrip(rendered.uri, [snapThumbTime(posterFrameTime(rendered.durationSec))]))[0];
      if (poster) {
        const posterUrl = await uploadMedia(poster, {
          projectId: project.id,
          kind: 'poster',
          name: thumb ? `${project.id}_${stillVersion(thumb)}.jpg` : `${project.id}.jpg`,
        });
        rendered = { ...rendered, posterUrl, ...(thumb ? { posterKey: stillVersion(thumb) } : {}) };
        updated = { ...updated, rendered };
        await saveProject(updated);
      }
    } catch (caught) {
      logCaught('lib/feed.ts:publishRenderedProject', caught);
      // best-effort — poster nélkül is publikálható
    }
  }

  // 🔀 C3: a hang-sávok fájljai fel (egyszer fájlonként), a sáv-leírás a posztba
  let remixTracks: RemixTracksManifest | undefined;
  if (opts?.remixTracks && updated.kind === 'audio' && opts.remixable !== false) {
    const remote = new Map<string, string>();
    for (const uri of remixUploadUris(updated)) {
      const url = await uploadMedia(uri, { projectId: project.id, kind: 'media', name: uri.split('/').pop() || 'track.wav' });
      remote.set(uri, url);
    }
    remixTracks = buildRemixManifest(updated, remote);
  }
  const post = await publishPost(updated, {
    remixTracks,
    visibility: opts?.visibility ?? 'public',
    videoUrl: rendered.url ?? null,
    posterUrl: rendered.posterUrl ?? null,
    // ha ez remix-projekt, csatoljuk a forrás-poszthoz (remix_of_post_id → lineage)
    remixOfPostId: updated.remixOf?.postId,
    remixOfCreator: updated.remixOf?.name,
    remixable: opts?.remixable ?? true,
  });
  return { post, project: updated };
}

/**
 * 🖼️➡️📲 Egy KÉP-projekt (galéria) megosztása a feedbe — kétféle módon:
 *  - `'slideshow'`: a lapokból DIAVETÍTÉS-VIDEÓ (`buildSlideshowProject` → a megszokott
 *    `publishRenderedProject` renderel+feltölt+posztol). A feedben sima lejátszható poszt.
 *  - `'carousel'`: a lapok renderelt PNG-jei feltöltődnek, és egy LAPOZHATÓ kép-poszt lesz
 *    (nincs videó; a `project_snapshot.carousel` hordozza a kép-URL-eket, a feed-kártya pagerrel).
 *
 * ELŐFELTÉTEL: minden megosztandó lapnak legyen renderelt PNG-je (`imageDoc.renderedUri`) — a
 * Kép Stúdió a megosztás előtt rasterizál. Csak a renderelt lapok kerülnek a posztba.
 */
export async function publishImageProject(
  project: Project,
  mode: ImageShareMode,
  opts?: { visibility?: PostVisibility; onProgress?: (u: ProgressUpdate) => void } & SlideshowBuildOptions
): Promise<{ post: FeedPost; project: Project }> {
  if (mode === 'slideshow') {
    const slideshow = buildSlideshowProject(project, opts ?? {});
    if (!slideshow) {
      throw new Error(tr('studio.image.shareFeed.noSlides'));
    }
    // a diavetítés-projekt a megszokott videó-úton megy (render + feltöltés + poszt)
    const { post } = await publishRenderedProject(slideshow, opts?.onProgress, {
      visibility: opts?.visibility,
    });
    return { post, project };
  }

  // carousel: a renderelt lapok PNG-jeinek feltöltése → lapozható kép-poszt
  const uris = carouselImageUris(project);
  if (uris.length === 0) {
    throw new Error(tr('studio.image.shareFeed.noCarousel'));
  }
  const urls: string[] = [];
  for (let i = 0; i < uris.length; i++) {
    const url = await uploadMedia(uris[i], {
      projectId: project.id,
      kind: 'image',
      name: `${project.id}-page-${i}.png`,
    });
    urls.push(url);
  }
  const post = await publishPost(project, {
    visibility: opts?.visibility ?? 'public',
    videoUrl: null,
    posterUrl: urls[0] ?? null, // a feed-rács borítója az első lap
    carouselUrls: urls,
    remixOfPostId: project.remixOf?.postId,
    remixOfCreator: project.remixOf?.name,
  });
  return { post, project };
}

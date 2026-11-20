import { Image } from 'expo-image';
import { useEffect, useMemo, useRef } from 'react';

import { resolveClipUri } from '@/lib/assetResolve';
import { logCaught } from '@/lib/logCaught';
import { upcomingVisualClip } from '@/lib/projectUtils';
import { ensureProxy } from '@/lib/proxy';
import type { ImageClip, Project, VideoClip } from '@/types/project';

/**
 * 🔗 Az aktív vizuális klip feloldott forrás-uri-ja + a következő klip
 * gapless-előtöltése. A PreviewSurface-ből kiemelve (a hook-sorrend változatlan);
 * a logCaught-helyek szándékosan a régi fájlnevet viszik (hiba-ujjlenyomat).
 */
export function usePreviewSources(
  project: Project | null,
  videoClip: VideoClip | null,
  imageClip: ImageClip | null,
  playhead: number
): { videoSrcUri: string | null; imageSrcUri: string | null } {
  // 🔗 ADR-012: az asset a forrás-igazság → a feloldott (asseten át) uri-t vesszük.
  // Memoizált: csak a projekt/aktív-klip váltásakor old fel (nem kockánként →
  // nincs per-frame `assets.find`). Ma értékazonos a klip uri-cache-ével.
  const videoSrcUri = useMemo(
    () => (videoClip && project ? (resolveClipUri(project, videoClip) ?? videoClip.uri) : null),
    [project, videoClip]
  );
  const imageSrcUri = useMemo(
    () => (imageClip && project ? (resolveClipUri(project, imageClip) ?? imageClip.uri) : null),
    [project, imageClip]
  );

  // 🎬 Gapless-előtöltés (CORE §2.6): a KÖVETKEZŐ vizuális klip forrását a
  // klip-határ ELŐTT bemelegítjük (a tesztelt `upcomingVisualClip`, 1 mp előre-
  // tekintés) — videónál a vágási proxy generálása indul, képnél az expo-image
  // cache. Így a váltáskor a fő lejátszó kész forrást kap (nincs „kattanás").
  // Additív: a fő lejátszó-logikát NEM érinti; per-uri EGYSZER fut (ref-guard).
  const upcoming = useMemo(() => {
    if (!project) {
      return null;
    }
    const next = upcomingVisualClip(project, playhead, 1);
    if (!next) {
      return null;
    }
    return { uri: resolveClipUri(project, next) ?? next.uri, isVideo: next.kind === 'video' };
  }, [project, playhead]);
  const preloadedRef = useRef<string | null>(null);
  useEffect(() => {
    const uri = upcoming?.uri ?? null;
    if (!uri || preloadedRef.current === uri) {
      return;
    }
    preloadedRef.current = uri;
    if (upcoming?.isVideo) {
      ensureProxy(uri).catch((caught) => { logCaught('components/preview/PreviewSurface.tsx:PreviewSurface', caught); });
    } else {
      Image.prefetch(uri).catch((caught) => { logCaught('components/preview/PreviewSurface.tsx:PreviewSurface', caught); });
    }
  }, [upcoming?.uri, upcoming?.isVideo]);

  return { videoSrcUri, imageSrcUri };
}

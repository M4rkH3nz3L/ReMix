import { Ionicons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { ALL_PROJECT_KINDS, PROJECT_KINDS } from '@/lib/projectKinds';
import { projectPreviewSource } from '@/lib/projectPreview';
import { loadProject } from '@/lib/storage';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import type { ProjectKind } from '@/types/project';

/** a projekt-fajta ikonja a lista-kártyákhoz (a videó a bélyegkép alá esik vissza) —
 *  MINDEN fajtára (a CreativeDocument-bővítésre is), a katalógusból származtatva. */
const KIND_ICON = Object.fromEntries(
  ALL_PROJECT_KINDS.map((k) => [k, PROJECT_KINDS[k].icon as keyof typeof Ionicons.glyphMap])
) as Record<ProjectKind, keyof typeof Ionicons.glyphMap>;

/** projekt-bélyegkép a lista-sorokhoz (cache-elve) — MINDEN fajtánál a közös
 *  `projectPreviewSource`: a választott borító (hangnál album-borító), különben a fajta
 *  saját képe (3D-poszter, kép-lap, videó-kocka). Kép híján a fajta-ikon. */
const thumbCache = new Map<string, string | null>();

/** helyi (`file://`) kép, ami már nincs a lemezen */
function localFileMissing(uri: string): boolean {
  if (!uri.startsWith('file://')) return false;
  try {
    return !new File(uri).exists;
  } catch {
    return true;
  }
}

export function ProjectThumb({
  id,
  kind,
  version = '',
}: {
  id: string;
  kind: ProjectKind;
  /** a projekt `updatedAt`-je — a cache-kulcs része, így a tartalom változása után frissül */
  version?: string;
}) {
  const cacheKey = `${id}@${version}`;
  const [uri, setUri] = useState<string | null>(thumbCache.get(cacheKey) ?? null);
  useEffect(() => {
    if (thumbCache.has(cacheKey)) {
      return;
    }
    let alive = true;
    loadProject(id)
      .then(async (p) => {
        const source = p ? projectPreviewSource(p) : null;
        if (!source) {
          return null;
        }
        if (source.type === 'image') {
          // a helyi kép (pl. 3D-poszter) eltűnhetett (régi szken, takarítás, konténer-váltás)
          // → ikon, ne üres kártya
          return localFileMissing(source.uri) ? null : source.uri;
        }
        const [thumb] = await getFilmstrip(source.uri, [snapThumbTime(source.time)]);
        return thumb;
      })
      .then((thumb) => {
        thumbCache.set(cacheKey, thumb ?? null);
        if (alive) {
          setUri(thumb ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, kind, cacheKey]);
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={styles.cardThumb}
        contentFit="cover"
        onError={() => {
          // betölthetetlen kép → a fajta-ikon (eddig üres szürke kártya maradt)
          thumbCache.set(cacheKey, null);
          setUri(null);
        }}
      />
    );
  }
  return (
    <View style={styles.cardIcon}>
      <Ionicons name={KIND_ICON[kind]} size={20} color={palette.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  cardThumb: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: palette.surfaceHigh,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

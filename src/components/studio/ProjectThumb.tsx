import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { ALL_PROJECT_KINDS, PROJECT_KINDS } from '@/lib/projectKinds';
import { loadProject } from '@/lib/storage';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import type { ProjectKind } from '@/types/project';

/** a projekt-fajta ikonja a lista-kártyákhoz (a videó a bélyegkép alá esik vissza) —
 *  MINDEN fajtára (a CreativeDocument-bővítésre is), a katalógusból származtatva. */
const KIND_ICON = Object.fromEntries(
  ALL_PROJECT_KINDS.map((k) => [k, PROJECT_KINDS[k].icon as keyof typeof Ionicons.glyphMap])
) as Record<ProjectKind, keyof typeof Ionicons.glyphMap>;

/** projekt-bélyegkép a lista-sorokhoz (videónál az első klip kockája, cache-elve;
 *  kép/hang projektnél a fajta-ikon — nincs videó-bélyegkép, amit kirakni) */
const thumbCache = new Map<string, string | null>();

export function ProjectThumb({ id, kind }: { id: string; kind: ProjectKind }) {
  const [uri, setUri] = useState<string | null>(thumbCache.get(id) ?? null);
  useEffect(() => {
    // csak videó-projektnél van értelme filmstrip-kockát keresni
    if (kind !== 'video' || thumbCache.has(id)) {
      return;
    }
    let alive = true;
    loadProject(id)
      .then(async (p) => {
        const clip = p?.tracks
          .find((t) => t.type === 'video')
          ?.clips.find((c) => c.kind === 'video');
        if (!clip || clip.kind !== 'video') {
          return null;
        }
        const [thumb] = await getFilmstrip(clip.uri, [snapThumbTime(clip.trimIn + 0.5)]);
        return thumb;
      })
      .then((thumb) => {
        thumbCache.set(id, thumb ?? null);
        if (alive) {
          setUri(thumb ?? null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, kind]);
  if (kind === 'video' && uri) {
    return <Image source={{ uri }} style={styles.cardThumb} contentFit="cover" />;
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

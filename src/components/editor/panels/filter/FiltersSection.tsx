import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PanelSection, Stepper } from '@/components/ui/controls';
import { filters, palette } from '@/constants/editor';
import { getFilmstrip, snapThumbTime } from '@/lib/thumbnails';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

/**
 * 🎨 Szűrő-kártyák + erősség. Önálló szekció: a reprezentatív kocka
 * előnézetét (videón filmstrip-ből) magában tölti, mint korábban a panel.
 */
export function FiltersSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const intensity = clip.filterIntensity ?? 1;

  // 🖼️ a szűrő-kártyák fotó-előnézete: a klip egy reprezentatív kockája,
  // kártyánként a szűrő színes tintjével — web/hiba esetén szín-minta marad
  const [videoThumb, setVideoThumb] = useState<string | null>(null);
  const midSnapped =
    clip.kind === 'video'
      ? snapThumbTime(clip.trimIn + (clip.duration * clip.speed) / 2)
      : 0;

  useEffect(() => {
    if (clip.kind !== 'video') {
      return;
    }
    let alive = true;
    getFilmstrip(clip.uri, [midSnapped]).then(([uri]) => {
      if (alive) {
        setVideoThumb(uri);
      }
    });
    return () => {
      alive = false;
    };
  }, [clip.kind, clip.uri, midSnapped]);

  const cardThumb = clip.kind === 'image' ? clip.uri : videoThumb;

  return (
    <PanelSection title={t('panels.filter.sectionFilters')}>
      <View style={styles.grid}>
        {filters.map((filter) => (
          <Pressable
            key={filter.id}
            style={styles.filterCard}
            onPress={() => updateClip(clip.id, { filterId: filter.id })}
          >
            <View
              style={[
                styles.filterSwatch,
                {
                  backgroundColor:
                    filter.overlay && filter.overlay !== 'transparent'
                      ? filter.overlay
                      : palette.surfaceHigh,
                },
                clip.filterId === filter.id ? styles.filterSwatchActive : null,
              ]}
            >
              {cardThumb ? (
                <>
                  <Image
                    source={{ uri: cardThumb }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                  />
                  {filter.overlay ? (
                    <View
                      style={[
                        StyleSheet.absoluteFill,
                        {
                          backgroundColor: filter.overlay,
                          // a kis kártyán kissé erősített tint, hogy látsszon
                          opacity: clamp(filter.opacity * 1.5, 0.15, 0.6),
                        },
                      ]}
                    />
                  ) : null}
                </>
              ) : null}
              {filter.id === 'none' ? (
                <Ionicons name="ban-outline" size={18} color={palette.textDim} />
              ) : null}
            </View>
            <Text
              style={[
                styles.filterName,
                clip.filterId === filter.id ? styles.filterNameActive : null,
              ]}
              numberOfLines={1}
            >
              {t(filter.label)}
            </Text>
          </Pressable>
        ))}
      </View>
      {clip.filterId !== 'none' ? (
        <Stepper
          label={t('panels.filter.strength')}
          value={`${Math.round(intensity * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { filterIntensity: clamp(intensity - 0.1, 0.1, 1) })
          }
          onInc={() =>
            updateClip(clip.id, { filterIntensity: clamp(intensity + 0.1, 0.1, 1) })
          }
        />
      ) : null}
      <Text style={styles.note}>
        {t('panels.filter.noteFilters')}
      </Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterCard: {
    width: 76,
    alignItems: 'center',
    gap: 5,
  },
  filterSwatchActive: {
    borderColor: palette.accent,
  },
  filterSwatch: {
    width: 76,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  filterName: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  filterNameActive: {
    color: palette.accent,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
});

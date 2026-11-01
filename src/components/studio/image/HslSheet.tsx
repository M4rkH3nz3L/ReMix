import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { HSL_BANDS, isNeutralHsl } from '@/lib/hslBands';
import { updateLayer } from '@/lib/imageDoc';
import type { HslBand, ImageDoc, PhotoLayer } from '@/types/project';

const HistogramView = lazy(() => import('@/components/studio/image/HistogramView').then((m) => ({ default: m.HistogramView })));

const FIELDS = ['h', 's', 'l'] as const;
const percent = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;

/** 🎨 Színenkénti HSL: sávot választasz, és csak az a szín mozdul. A hisztogram élőben követi. */
export function HslSheet({ doc, layer, commit, onClose }: { doc: ImageDoc; layer: PhotoLayer; commit: (next: ImageDoc, label?: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [band, setBand] = useState<HslBand>('red');
  const set = (field: (typeof FIELDS)[number], value: number) =>
    commit(updateLayer<PhotoLayer>(doc, layer.id, { hsl: { ...layer.hsl, [band]: { ...layer.hsl?.[band], [field]: value } } }), 'hsl-bands');

  return (
    <StudioSheet
      title={t('studio.image.hsl.title')}
      icon="color-palette-outline"
      onClose={onClose}
      footer={
        isNeutralHsl(layer.hsl) ? undefined : (
          <Pressable onPress={() => commit(updateLayer<PhotoLayer>(doc, layer.id, { hsl: undefined }), 'hsl-bands')} style={styles.reset} accessibilityRole="button">
            <Text style={styles.resetText}>{t('studio.image.hsl.reset')}</Text>
          </Pressable>
        )
      }
    >
      <Suspense fallback={null}>
        <HistogramView layer={layer} uri={layer.uri} />
      </Suspense>
      <View style={styles.bands}>
        {HSL_BANDS.map(({ key, color }) => {
          const changed = !isNeutralHsl({ [key]: layer.hsl?.[key] });
          return (
            <Pressable key={key} onPress={() => setBand(key)} style={styles.hit} accessibilityRole="button" accessibilityLabel={t(`studio.image.hsl.band.${key}`)} accessibilityState={{ selected: band === key }}>
              <View style={[styles.dot, { backgroundColor: color }, band === key && styles.dotActive]} />
              {changed ? <View style={styles.mark} /> : null}
            </Pressable>
          );
        })}
      </View>
      {FIELDS.map((f) => (
        <Slider key={f} label={t(`studio.image.hsl.${f}`)} value={layer.hsl?.[band]?.[f] ?? 0} min={-1} max={1} onChange={(v) => set(f, v)} format={percent} />
      ))}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  bands: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 10 },
  hit: { padding: 6, alignItems: 'center' },
  dot: { width: 26, height: 26, borderRadius: 13 },
  dotActive: { borderWidth: 3, borderColor: '#ffffff' },
  mark: { width: 4, height: 4, borderRadius: 2, marginTop: 3, backgroundColor: palette.accent },
  reset: { alignSelf: 'flex-start', paddingVertical: 8 },
  resetText: { color: palette.accent, fontWeight: '700', fontSize: 13 },
});

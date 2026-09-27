import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider } from '@/components/studio/audio/primitives';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { updateLayer } from '@/lib/imageDoc';
import type { ClipAdjust, FilterId, ImageDoc, PhotoLayer } from '@/types/project';

const FILTERS: FilterId[] = [
  'none',
  'warm',
  'cool',
  'mono',
  'vivid',
  'fade',
  'night',
  'retro',
  'sunset',
  'forest',
];

/**
 * 🎚️ Korrekció-lap — a kijelölt FOTÓ-réteg szűrője + alap képjavítása
 * (fényerő/kontraszt/szaturáció/hőmérséklet). Az előnézet tint-rétegekkel
 * közelít (lásd `adjustTintLayers`), a render pontosan égeti be.
 */
export function AdjustSheet({
  doc,
  layer,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  layer: PhotoLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const adjust = layer.adjust ?? {};

  const setAdjust = (patch: Partial<ClipAdjust>) =>
    commit(updateLayer<PhotoLayer>(doc, layer.id, { adjust: { ...adjust, ...patch } }), 'adjust');

  return (
    <StudioSheet
      title={t('studio.image.correctionsTitle')}
      icon="contrast"
      onClose={onClose}
      footer={
        <Pressable
          style={styles.reset}
          onPress={() =>
            commit(
              updateLayer<PhotoLayer>(doc, layer.id, { adjust: undefined, filterId: 'none' }),
              'adjust-reset'
            )
          }
        >
          <Text style={styles.resetText}>{t('studio.image.reset')}</Text>
        </Pressable>
      }
    >
      <Text style={styles.section}>{t('studio.image.filter')}</Text>
      <View style={styles.chipRow}>
        {FILTERS.map((f) => (
          <Chip
            key={f}
            label={t(`editor.filter.${f}`)}
            active={(layer.filterId ?? 'none') === f}
            onPress={() =>
              commit(
                updateLayer<PhotoLayer>(doc, layer.id, {
                  filterId: f,
                  filterIntensity: layer.filterIntensity ?? 1,
                }),
                'filter'
              )
            }
          />
        ))}
      </View>

      <Text style={styles.section}>{t('studio.image.adjustTitle')}</Text>
      <Slider
        label={t('panels.adjust.adjust_brightness')}
        value={adjust.brightness ?? 0}
        min={-0.3}
        max={0.3}
        onChange={(v) => setAdjust({ brightness: v })}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label={t('panels.adjust.adjust_contrast')}
        value={adjust.contrast ?? 0}
        min={-0.4}
        max={0.4}
        onChange={(v) => setAdjust({ contrast: v })}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label={t('panels.adjust.adjust_saturation')}
        value={adjust.saturation ?? 0}
        min={-1}
        max={1}
        onChange={(v) => setAdjust({ saturation: v })}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label={t('panels.adjust.adjust_temperature')}
        value={adjust.temperature ?? 0}
        min={-0.3}
        max={0.3}
        onChange={(v) => setAdjust({ temperature: v })}
        format={(v) => v.toFixed(2)}
      />
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  section: { color: palette.textDim, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  reset: {
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  resetText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});

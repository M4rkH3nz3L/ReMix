import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { updateLayer } from '@/lib/imageDoc';
import { createShapePattern, PATTERN_PRESETS } from '@/lib/shapePattern';
import type { ImageDoc, ShapeLayer, ShapePattern } from '@/types/project';

/**
 * 🧩 „Minta" lap — a kijelölt FORMA réteg geometrikus csempe-kitöltése, érintő-first:
 * preset (pöttyök/rács/csíkok/sakktábla) + szín + háttér + méret + forgatás + opacity.
 * A `pattern` FELÜLÍRJA a sima `fill`-t. Minden a [shapePattern](../../../lib/shapePattern.ts)
 * magra épül → az előnézet ([ShapeOverlay](../../preview/ShapeOverlay.tsx) react-native-svg)
 * és a worker-render (Chromium SVG) SZÓ SZERINT egyezik (contract-tesztelt).
 */
export function PatternSheet({
  doc,
  layer,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  layer: ShapeLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const pat = layer.pattern;
  const setPattern = (p: ShapePattern | undefined) =>
    commit(updateLayer<ShapeLayer>(doc, layer.id, { pattern: p }), t('studio.image.pattern.title'));
  // meglévő minta módosítása, vagy új az alapokból (a réteg színére építve)
  const update = (over: Partial<ShapePattern>) =>
    setPattern({ ...(pat ?? createShapePattern({ fg: layer.fill })), ...over });

  return (
    <StudioSheet title={t('studio.image.pattern.title')} icon="grid-outline" onClose={onClose}>
      <Text style={styles.section}>{t('studio.image.pattern.preset')}</Text>
      <View style={styles.chipRow}>
        <Chip label={t('studio.image.pattern.none')} active={!pat} onPress={() => setPattern(undefined)} />
        {PATTERN_PRESETS.map((preset) => (
          <Chip
            key={preset}
            label={t(`studio.image.pattern.kind.${preset}`)}
            active={pat?.preset === preset}
            onPress={() => update({ preset })}
          />
        ))}
      </View>

      {pat ? (
        <>
          <ColorField
            label={t('studio.image.pattern.fg')}
            value={pat.fg}
            onChange={(fg) => update({ fg })}
          />
          <ToggleRow
            icon="square"
            label={t('studio.image.pattern.bgOn')}
            value={pat.bg != null}
            onValueChange={(v) => update({ bg: v ? pat.bg ?? '#0b0b18' : undefined })}
          />
          {pat.bg != null ? (
            <ColorField
              label={t('studio.image.pattern.bg')}
              value={pat.bg}
              onChange={(bg) => update({ bg })}
            />
          ) : null}
          <Slider
            label={t('studio.image.pattern.size')}
            value={pat.size}
            min={1}
            max={25}
            onChange={(size) => update({ size })}
            format={(v) => `${v.toFixed(1)}%`}
          />
          <Slider
            label={t('studio.image.pattern.rotation')}
            value={pat.rotation ?? 0}
            min={0}
            max={180}
            onChange={(rotation) => update({ rotation })}
            format={(v) => `${Math.round(v)}°`}
          />
          <Slider
            label={t('studio.image.pattern.opacity')}
            value={pat.opacity ?? 1}
            min={0.1}
            max={1}
            onChange={(opacity) => update({ opacity })}
            format={(v) => v.toFixed(2)}
          />
        </>
      ) : null}
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  section: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 6,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});

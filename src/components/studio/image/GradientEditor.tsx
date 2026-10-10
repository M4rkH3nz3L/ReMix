import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/controls';
import { Slider, ToggleRow } from '@/components/studio/audio/primitives';
import { ColorField } from '@/components/studio/image/ColorField';
import { palette } from '@/constants/editor';
import { sortedStops } from '@/lib/gradient';
import type { ShapeGradient } from '@/types/project';

/** gyors-alkalmazható gradiens-presetek (multi-stop) */
const PRESETS: ShapeGradient[] = [
  { type: 'linear', angle: 135, stops: [{ color: '#7c5cff', at: 0 }, { color: '#ff2ea6', at: 1 }] },
  { type: 'linear', angle: 135, stops: [{ color: '#00e5ff', at: 0 }, { color: '#4d9dff', at: 1 }] },
  { type: 'linear', angle: 135, stops: [{ color: '#ff9d4d', at: 0 }, { color: '#ff2d95', at: 1 }] },
  { type: 'linear', angle: 135, stops: [{ color: '#39d98a', at: 0 }, { color: '#00e5ff', at: 1 }] },
  {
    type: 'linear',
    angle: 135,
    stops: [{ color: '#ffd166', at: 0 }, { color: '#ff6b6b', at: 0.5 }, { color: '#7c5cff', at: 1 }],
  },
  { type: 'radial', stops: [{ color: '#ffffff', at: 0 }, { color: '#0b0b18', at: 1 }] },
];

const TYPES: ShapeGradient['type'][] = ['linear', 'radial', 'conic'];

/**
 * 🌈 Gradiens-kitöltés szerkesztő (forma / háttér réteg) — be/ki, típus
 * (lineáris/radiális/konikus), szög, gyors-presetek és a kezdő/záró stop színe.
 * A `gradient` felülírja a tömör `fill`-t; kikapcsolva `undefined`-et ad vissza
 * (vissza a tömör színhez). Az előnézet AZONOS a renderrel (ShapeOverlay/FillLayerView).
 */
export function GradientEditor({
  gradient,
  baseColor,
  onChange,
}: {
  gradient?: ShapeGradient;
  baseColor: string;
  onChange: (gradient: ShapeGradient | undefined) => void;
}) {
  const { t } = useTranslation();
  const g = gradient;

  const patch = (next: Partial<ShapeGradient>) => {
    if (!g) return;
    onChange({ ...g, ...next });
  };
  const setStopColor = (index: number, color: string) => {
    if (!g) return;
    onChange({ ...g, stops: g.stops.map((s, i) => (i === index ? { ...s, color } : s)) });
  };

  const stops = g ? sortedStops(g.stops) : [];
  const first = stops[0];
  const lastIdx = g ? g.stops.length - 1 : 0;

  return (
    <View style={{ gap: 10 }}>
      <ToggleRow
        icon="color-filter-outline"
        label={t('studio.image.gradient.title')}
        value={!!g}
        onValueChange={(v) =>
          onChange(
            v
              ? { type: 'linear', angle: 135, stops: [{ color: baseColor, at: 0 }, { color: '#ffffff', at: 1 }] }
              : undefined
          )
        }
      />

      {g ? (
        <>
          {/* preset-ek */}
          <View style={styles.presetRow}>
            {PRESETS.map((p, i) => (
              <Pressable key={i} onPress={() => onChange(p)} style={styles.presetWrap}>
                <LinearGradient
                  colors={sortedStops(p.stops).map((s) => s.color) as [string, string, ...string[]]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.preset}
                />
              </Pressable>
            ))}
          </View>

          {/* típus */}
          <View style={styles.chipRow}>
            {TYPES.map((ty) => (
              <Chip
                key={ty}
                label={t(`studio.image.gradient.${ty}`)}
                active={(g.type ?? 'linear') === ty}
                onPress={() => patch({ type: ty })}
              />
            ))}
          </View>

          {/* szög (nem radiálisnál) */}
          {g.type !== 'radial' ? (
            <Slider
              label={t('studio.image.gradient.angle')}
              value={g.angle ?? 135}
              min={0}
              max={360}
              onChange={(v) => patch({ angle: Math.round(v) })}
              format={(v) => `${Math.round(v)}°`}
            />
          ) : null}

          {/* kezdő / záró szín */}
          {first ? (
            <ColorField
              label={t('studio.image.gradient.start')}
              value={g.stops[0].color}
              onChange={(c) => setStopColor(0, c)}
            />
          ) : null}
          <ColorField
            label={t('studio.image.gradient.end')}
            value={g.stops[lastIdx].color}
            onChange={(c) => setStopColor(lastIdx, c)}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetWrap: { borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: palette.border },
  preset: { width: 44, height: 28 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
});

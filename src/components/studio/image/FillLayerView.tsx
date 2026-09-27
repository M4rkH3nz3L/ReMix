import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient as SvgRadial, Rect, Stop } from 'react-native-svg';

import { angleToLinearPoints, sortedStops } from '@/lib/gradient';
import type { FillLayer } from '@/types/project';

/**
 * 🎨 Háttér-réteg a vásznon — tömör szín / két-színű vagy multi-stop gradient.
 * A teljes vásznot kitölti; koppintásra kijelölhető (a réteg-panelben szerkeszthető).
 */
export function FillLayerView({
  layer,
  box,
  onSelect,
}: {
  layer: FillLayer;
  box: { w: number; h: number };
  onSelect?: () => void;
}) {
  const opacity = layer.opacity ?? 1;
  const g = layer.gradient;

  let content;
  if (g && g.type === 'radial') {
    content = (
      <Svg width={box.w} height={box.h}>
        <Defs>
          <SvgRadial id={`fill-${layer.id}`} cx="0.5" cy="0.5" r="0.5">
            {sortedStops(g.stops).map((s, i) => (
              <Stop key={i} offset={s.at} stopColor={s.color} />
            ))}
          </SvgRadial>
        </Defs>
        <Rect x="0" y="0" width={box.w} height={box.h} fill={`url(#fill-${layer.id})`} />
      </Svg>
    );
  } else if (g) {
    const stops = sortedStops(g.stops);
    content = (
      <LinearGradient
        colors={stops.map((s) => s.color) as [string, string, ...string[]]}
        locations={stops.map((s) => s.at) as [number, number, ...number[]]}
        start={angleToLinearPoints(g.angle).start}
        end={angleToLinearPoints(g.angle).end}
        style={StyleSheet.absoluteFill}
      />
    );
  } else if (layer.fillGradient) {
    content = (
      <LinearGradient
        colors={[layer.fillGradient.from, layer.fillGradient.to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    );
  }

  return (
    <Pressable
      onPress={onSelect}
      style={[StyleSheet.absoluteFill, { backgroundColor: g ? undefined : layer.fill, opacity }]}
    >
      {content}
    </Pressable>
  );
}

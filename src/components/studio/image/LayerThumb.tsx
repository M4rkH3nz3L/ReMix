import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { ImageLayer } from '@/types/project';

const SHAPE_ICONS: Partial<Record<string, keyof typeof Ionicons.glyphMap>> = {
  star: 'star',
  arrow: 'arrow-forward',
  line: 'remove',
  path: 'pencil',
};

/** a kitöltés fő színei (gradiensnél a szélső megállók) */
function fillColors(layer: { fill?: string; gradient?: { stops: { color: string }[] }; fillGradient?: { from: string; to: string } }): string[] {
  const stops = layer.gradient?.stops;
  if (stops && stops.length >= 2) {
    return [stops[0].color, stops[stops.length - 1].color];
  }
  if (layer.fillGradient) {
    return [layer.fillGradient.from, layer.fillGradient.to];
  }
  return [layer.fill ?? '#000000'];
}

/**
 * 🖼️ Kis előnézet a réteg-sorban: a fotó maga a kép, a szöveg a saját betűivel és színével, a
 * forma a saját alakjával és színével — így látszik, melyik sor melyik elem.
 */
export function LayerThumb({ layer }: { layer: ImageLayer }) {
  return <View style={[styles.box, layer.hidden ? styles.hidden : null]}>{content(layer)}</View>;
}

function content(layer: ImageLayer) {
  switch (layer.kind) {
    case 'photo':
      return <Image source={{ uri: layer.uri }} style={StyleSheet.absoluteFill} contentFit={layer.fit === 'contain' ? 'contain' : 'cover'} recyclingKey={layer.uri} />;
    case 'text':
      return (
        <Text style={[styles.text, { color: layer.color, fontFamily: layer.fontFamily }]} numberOfLines={1}>
          {layer.text.trim().slice(0, 2) || 'T'}
        </Text>
      );
    case 'fill': {
      const colors = fillColors(layer);
      return colors.length > 1 ? (
        <LinearGradient colors={colors as [string, string]} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors[0] }]} />
      );
    }
    case 'shape': {
      if (layer.imageUri) {
        return <Image source={{ uri: layer.imageUri }} style={StyleSheet.absoluteFill} contentFit="contain" />;
      }
      const color = fillColors(layer)[0];
      const icon = SHAPE_ICONS[layer.shape];
      return icon ? (
        <Ionicons name={icon} size={20} color={color} />
      ) : (
        <View style={[styles.shape, { backgroundColor: color }, layer.shape === 'ellipse' ? styles.round : null]} />
      );
    }
    default:
      return <Ionicons name="contrast-outline" size={18} color={palette.textDim} />;
  }
}

const styles = StyleSheet.create({
  box: {
    width: 36,
    height: 36,
    borderRadius: 6,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2a2d38',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
  },
  hidden: { opacity: 0.35 },
  text: { fontSize: 15, fontWeight: '800' },
  shape: { width: 22, height: 16, borderRadius: 2 },
  round: { width: 20, height: 20, borderRadius: 10 },
});

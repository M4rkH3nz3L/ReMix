import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';

/**
 * 🎚️ Függőleges fader (keverőpult széles képernyőn): húzás vagy koppintás a sávon; a szint a
 * hüvelyk helyéből (lent 0, fent `max`). Akadálymentes: VoiceOver/TalkBack alatt „adjustable”,
 * fel/le ±1 dB-nyi lépés. Egy húzás egy érték-sorozat — a hívó a parancs-buszon dolgozik.
 */
export function VerticalFader({
  value,
  max,
  height = 180,
  color,
  onChange,
  label,
  valueText,
  testID,
}: {
  value: number;
  max: number;
  height?: number;
  color: string;
  onChange: (v: number) => void;
  label: string;
  valueText: string;
  testID?: string;
}) {
  const [h, setH] = useState(height);
  const at = (y: number) => Math.max(0, Math.min(max, (1 - y / h) * max));
  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => onChange(at(e.y)))
    .onUpdate((e) => onChange(at(e.y)));
  const ratio = max > 0 ? value / max : 0;
  const step = (dir: 1 | -1) => {
    // ±1 dB a jelenlegi szinthez képest (0-ról felfelé −40 dB-ről indul)
    const db = value > 0 ? 20 * Math.log10(value) : -40;
    onChange(Math.max(0, Math.min(max, Math.pow(10, (db + dir) / 20))));
  };
  return (
    <GestureDetector gesture={pan}>
      <View
        testID={testID}
        style={[styles.track, { height }]}
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: valueText }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      >
        <View style={[styles.fill, { height: `${ratio * 100}%`, backgroundColor: `${color}55` }]} />
        <View style={[styles.thumb, { bottom: `${ratio * 100}%`, borderColor: color }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  track: { width: 44, borderRadius: 10, backgroundColor: palette.surfaceHigh, borderWidth: 1, borderColor: palette.border, overflow: 'visible', justifyContent: 'flex-end' },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0, borderRadius: 10 },
  thumb: { position: 'absolute', left: -4, right: -4, height: 14, marginBottom: -7, borderRadius: 4, borderWidth: 2, backgroundColor: palette.text },
});

import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';

const SWATCHES = [
  '#ffffff', '#0b0b18', '#ff2d95', '#ff6b6b', '#ffd166',
  '#39d98a', '#00e5ff', '#4d9dff', '#7c5cff', '#ff9d4d',
];

/** #RGB / #RRGGBB validáció (a hex-mezőből csak érvényes színt engedünk tovább) */
function normalizeHex(raw: string): string | null {
  let s = raw.trim();
  if (!s.startsWith('#')) {
    s = '#' + s;
  }
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) {
    return s.toLowerCase();
  }
  return null;
}

/**
 * 🎨 Szín-mező — előre megadott minták + kézi HEX bevitel. A HEX-input `key`-e a
 * `value`, így külső változásra (minta-koppintás) újramountol és a friss értéket
 * mutatja — nincs setState-effekt (a lint tiltja). Egy helyen a szöveg-szín, a
 * forma-kitöltés, a háttér és a kontúr-szín szerkesztéséhez.
 */
export function ColorField({
  label,
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        {SWATCHES.map((c) => (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            style={[styles.swatch, { backgroundColor: c }, value.toLowerCase() === c ? styles.active : null]}
          />
        ))}
        <View style={styles.hexWrap}>
          <Text style={styles.hash}>#</Text>
          <TextInput
            key={value}
            defaultValue={value.replace('#', '')}
            onEndEditing={(e) => {
              const hex = normalizeHex(e.nativeEvent.text);
              if (hex) {
                onChange(hex);
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={7}
            placeholder="ffffff"
            placeholderTextColor={palette.textDim}
            style={styles.hexInput}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  swatch: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: palette.border },
  active: { borderColor: palette.text, borderWidth: 3 },
  hexWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    paddingLeft: 8,
  },
  hash: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  hexInput: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
    paddingVertical: 6,
    paddingHorizontal: 4,
    minWidth: 62,
    fontVariant: ['tabular-nums'],
  },
});

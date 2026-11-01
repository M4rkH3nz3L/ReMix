import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { LiveSource } from '@/types/live';

const ICONS: Partial<Record<LiveSource['kind'], keyof typeof Ionicons.glyphMap>> = {
  camera: 'videocam',
  screen: 'phone-portrait-outline',
  image: 'image',
  text: 'text',
  logo: 'ribbon',
  shape: 'shapes',
};

/** 🎛️ Adás alatti érintős gombrács: a jelenet forrásai ki-be, a mikrofon és a kameraváltás. */
export function LiveQuickGrid({
  sources,
  micMuted,
  onToggle,
  onMic,
  onFlip,
}: {
  sources: Pick<LiveSource, 'id' | 'kind' | 'label' | 'visible'>[];
  micMuted: boolean;
  onToggle: (sourceId: string) => void;
  onMic: () => void;
  onFlip: () => void;
}) {
  const { t } = useTranslation();
  const cell = (key: string, icon: keyof typeof Ionicons.glyphMap, label: string, on: boolean, onPress: () => void) => (
    <Pressable key={key} testID={`quick-${key}`} style={[styles.cell, on ? styles.on : null]} onPress={onPress} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <Ionicons name={icon} size={24} color="#fff" />
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.grid} testID="live-quick-grid">
      {cell('mic', micMuted ? 'mic-off' : 'mic', t('live.quick.mic'), !micMuted, onMic)}
      <Pressable testID="quick-flip" style={styles.cell} onPress={onFlip} accessibilityRole="button" accessibilityLabel={t('live.flipCamera')}>
        <Ionicons name="camera-reverse" size={24} color="#fff" />
        <Text style={styles.label} numberOfLines={1}>{t('live.flipCamera')}</Text>
      </Pressable>
      {sources.map((s) => cell(s.id, ICONS[s.kind] ?? 'square-outline', s.label || s.kind, s.visible, () => onToggle(s.id)))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 10, borderRadius: 14, backgroundColor: '#000000b3' },
  cell: { width: 76, height: 72, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, backgroundColor: '#ffffff1f', borderWidth: 2, borderColor: 'transparent' },
  on: { borderColor: palette.accent, backgroundColor: palette.accent + '55' },
  label: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

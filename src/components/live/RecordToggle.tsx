import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/** 📼 „Élő mentése videó-projektbe”: az egész sor koppintható, a kapcsoló az állapotot mutatja. */
export function RecordToggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      testID="live-record-row"
      onPress={onToggle}
      style={[styles.row, value && styles.rowOn]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <Ionicons name={value ? 'videocam' : 'videocam-off'} size={20} color={value ? palette.danger : palette.textDim} />
      <View style={styles.text}>
        <Text style={styles.label}>{t('live.studio.recordLabel', { defaultValue: 'Élő mentése videó-projektbe' })}</Text>
        <Text style={styles.sub}>
          {value
            ? t('live.studio.recordOn', { defaultValue: 'Az adás végén a teljes felvételből szerkeszthető projekt lesz.' })
            : t('live.studio.recordOff', { defaultValue: 'Nincs felvétel/projekt — csak élő adás.' })}
        </Text>
      </View>
      <Switch
        testID="live-record-switch"
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: palette.border, true: palette.danger }}
        thumbColor="#ffffff"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 60,
    backgroundColor: palette.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: palette.danger, backgroundColor: palette.danger + '18' },
  text: { flex: 1 },
  label: { color: palette.text, fontSize: 14, fontWeight: '700' },
  sub: { color: palette.textDim, fontSize: 11, lineHeight: 15, marginTop: 2 },
});

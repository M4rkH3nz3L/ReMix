import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';

/**
 * 🧰 Eszköz-sor — a hang-stúdió alsó eszköztára (hozzáadás / felvétel / vágás /
 * szerkesztés / törlés / mixer). VISELKEDÉS-MEGŐRZŐ kiemelés az `AudioStudioBody`-ból:
 * azonos gombok, render-sorrend, ikonok és UI; minden koppintás-handler, a `selClip`
 * létéből adódó letiltás és a felvétel-állapot PROPBÓL érkezik (a body adja át), a
 * command-/dispatch-minta változatlan.
 */
export function AudioStudioToolbar({
  hasSelection,
  isRecording,
  onAdd,
  onRecord,
  onSplit,
  onEdit,
  onDelete,
  onMixer,
}: {
  hasSelection: boolean;
  isRecording: boolean;
  onAdd: () => void;
  onRecord: () => void;
  onSplit: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMixer: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.toolBar}>
      <Tool icon="add-circle-outline" label={t('studio.audioTools.add')} onPress={onAdd} />
      <Tool
        icon={isRecording ? 'stop-circle' : 'mic-outline'}
        label={t('studio.audioTools.record')}
        onPress={onRecord}
        danger={isRecording}
      />
      <Tool icon="cut-outline" label={t('studio.audioTools.split')} onPress={onSplit} disabled={!hasSelection} />
      <Tool icon="options-outline" label={t('studio.audioTools.edit')} onPress={onEdit} disabled={!hasSelection} />
      <Tool icon="trash-outline" label={t('studio.audioTools.delete')} onPress={onDelete} disabled={!hasSelection} danger />
      <Tool icon="options" label={t('studio.audioTools.mixer', { defaultValue: 'Mixer' })} onPress={onMixer} />
    </View>
  );
}

function Tool({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const color = disabled ? palette.border : danger ? palette.danger : palette.textDim;
  return (
    <Pressable style={styles.tool} onPress={onPress} disabled={disabled}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.toolLabel, { color: disabled ? palette.border : palette.textDim }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, paddingTop: 10, paddingBottom: 6 },
  tool: { flex: 1, alignItems: 'center', gap: 4 },
  toolLabel: { fontSize: 10, fontWeight: '600' },
});

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
  onRecordLongPress,
  onSplit,
  onBeatSplit,
  onEdit,
  onDelete,
  onMixer,
  onCopy,
  onPaste,
  onDuplicate,
  canPaste,
}: {
  hasSelection: boolean;
  isRecording: boolean;
  onAdd: () => void;
  onRecord: () => void;
  /** 🎙️ hosszú nyomás: felvételi beállítások (előszámlálás, punch-in) */
  onRecordLongPress?: () => void;
  onSplit: () => void;
  /** ✂️🥁 hosszú nyomás: vágás az ütemrácson */
  onBeatSplit: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMixer: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
  canPaste: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.toolBar}>
      <Tool icon="add-circle-outline" label={t('studio.audioTools.add')} onPress={onAdd} />
      <Tool
        icon={isRecording ? 'stop-circle' : 'mic-outline'}
        label={t('studio.audioTools.record')}
        onPress={onRecord}
        onLongPress={onRecordLongPress}
        danger={isRecording}
      />
      <Tool icon="cut-outline" label={t('studio.audioTools.split')} onPress={onSplit} onLongPress={onBeatSplit} disabled={!hasSelection} />
      <Tool icon="copy-outline" label={t('studio.audioTools.copy')} onPress={onCopy} disabled={!hasSelection} />
      <Tool icon="clipboard-outline" label={t('studio.audioTools.paste')} onPress={onPaste} disabled={!canPaste} />
      <Tool icon="duplicate-outline" label={t('studio.audioTools.duplicate')} onPress={onDuplicate} disabled={!hasSelection} />
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
  onLongPress,
  disabled,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const color = disabled ? palette.border : danger ? palette.danger : palette.textDim;
  return (
    <Pressable style={styles.tool} onPress={onPress} onLongPress={onLongPress} disabled={disabled}>
      <Ionicons name={icon} size={22} color={color} />
      {/* Dynamic Type: a sűrű eszköztáron a felirat egy sorban marad (zsugorodik), legfeljebb 1,3× */}
      <Text style={[styles.toolLabel, { color: disabled ? palette.border : palette.textDim }]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.surface, paddingTop: 10, paddingBottom: 6 },
  tool: { flex: 1, alignItems: 'center', gap: 4 },
  toolLabel: { fontSize: 10, fontWeight: '600' },
});

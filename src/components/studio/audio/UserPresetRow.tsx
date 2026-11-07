import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { palette } from '@/constants/editor';
import { registerDevAction } from '@/lib/devActions';
import { presetsOf, type PresetKind, type PresetValues } from '@/lib/userPresets';
import { useUserPresets } from '@/store/userPresetStore';

/**
 * ⭐ A saját presetek sora: koppintás = alkalmazás, „+ Mentés” = a mostani beállítás mentése
 * névvel, hosszan = átnevezés / törlés. Offline, a telefonon tárolva.
 */
export function UserPresetRow<K extends PresetKind>({
  kind,
  getValue,
  onApply,
  canSave = true,
}: {
  kind: K;
  /** a mostani beállítás (mentéshez) */
  getValue: () => PresetValues[K] | null;
  onApply: (value: PresetValues[K]) => void;
  canSave?: boolean;
}) {
  const { t } = useTranslation();
  const list = useUserPresets((s) => s.list);
  const loaded = useUserPresets((s) => s.loaded);
  const mine = useMemo(() => presetsOf(list, kind), [list, kind]);
  useEffect(() => {
    if (!loaded) void useUserPresets.getState().load();
  }, [loaded]);

  const ask = (title: string, initial: string, done: (name: string) => void) => {
    if (typeof Alert.prompt === 'function') {
      Alert.prompt(title, undefined, (text) => text?.trim() && done(text), 'plain-text', initial);
    } else {
      // Androidon nincs szöveges Alert: automatikus név
      done(initial);
    }
  };
  const save = () => {
    const value = getValue();
    if (!value) return;
    ask(t('studio.audio.presets.saveTitle'), t('studio.audio.presets.defaultName', { n: mine.length + 1 }), (name) => {
      void useUserPresets.getState().save(kind, name, value);
    });
  };
  const manage = (id: string, name: string) =>
    Alert.alert(name, undefined, [
      { text: t('studio.audio.presets.rename'), onPress: () => ask(t('studio.audio.presets.rename'), name, (n) => void useUserPresets.getState().rename(id, n)) },
      { text: t('common.delete'), style: 'destructive', onPress: () => void useUserPresets.getState().remove(id) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);

  const getValueRef = useRef(getValue);
  getValueRef.current = getValue;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  // 🧪 füstteszt: mentés névvel és alkalmazás név szerint (csak __DEV__)
  useEffect(() => {
    const offs = [
      registerDevAction(`presets.${kind}.saveAs`, () => {
        const value = getValueRef.current();
        return value ? useUserPresets.getState().save(kind, `Füstteszt ${kind}`, value) : false;
      }),
      registerDevAction(`presets.${kind}.applyFirst`, () => {
        const p = presetsOf(useUserPresets.getState().list, kind)[0];
        if (p) onApplyRef.current(p.value);
        return p?.name ?? null;
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [kind]);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row} testID={`user-presets-${kind}`}>
      {mine.map((p) => (
        <Pressable key={p.id} style={styles.chip} onPress={() => onApply(p.value)} onLongPress={() => manage(p.id, p.name)} accessibilityRole="button" accessibilityHint={t('studio.audio.presets.hint')}>
          <Ionicons name="star" size={12} color={palette.accent} />
          <Text style={styles.text} numberOfLines={1}>
            {p.name}
          </Text>
        </Pressable>
      ))}
      {canSave ? (
        <Pressable style={[styles.chip, styles.save]} onPress={save} accessibilityRole="button" testID={`user-presets-${kind}-save`}>
          <Ionicons name="add" size={14} color={palette.textDim} />
          <Text style={[styles.text, { color: palette.textDim }]}>{t('studio.audio.presets.save')}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // a vízszintes sor ne nyúljon ki függőlegesen az oszlopos lapokon (mérve: 200 px-es chipek)
  scroll: { flexGrow: 0, marginBottom: 6 },
  row: { alignItems: 'center', gap: 6, paddingVertical: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 180, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: palette.accent, backgroundColor: `${palette.accent}1a` },
  save: { borderStyle: 'dashed', borderColor: palette.border, backgroundColor: 'transparent' },
  text: { color: palette.text, fontSize: 12, fontWeight: '700' },
});

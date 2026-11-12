import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { isNewerSchema } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';

/**
 * 📐 „Csak olvasható” sáv: a projektet az app újabb verziója mentette (`schemaVersion` nagyobb,
 * mint amit ez a verzió ismer). A parancs-busz, a mentés és a felhő-feltöltés ilyenkor nem ír
 * (`isNewerSchema`), ez a sáv mondja meg a felhasználónak, miért nem változik semmi.
 */
export function NewerSchemaBanner() {
  const { t } = useTranslation();
  const newer = useEditorStore((s) => isNewerSchema(s.project));
  if (!newer) return null;
  return (
    <View style={styles.bar} accessibilityRole="alert" testID="newer-schema-banner">
      <Ionicons name="lock-closed" size={14} color="#fff" />
      <Text style={styles.text} maxFontSizeMultiplier={1.4}>
        {t('studio.newerSchema')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: palette.danger },
  text: { color: '#fff', fontSize: 12, fontWeight: '700', flex: 1 },
});

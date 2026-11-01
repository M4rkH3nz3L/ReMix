import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { IMAGE_TEMPLATES, type ImageTemplate } from '@/lib/imageTemplates';

/** 🧩 Sablonok: mindegyik új lapot nyit szerkeszthető rétegekkel. */
export function TemplatesSheet({ onPick, onClose }: { onPick: (tpl: ImageTemplate) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <StudioSheet title={t('studio.image.templates.title')} icon="albums-outline" onClose={onClose}>
      <View style={styles.list}>
        {IMAGE_TEMPLATES.map((tpl) => (
          <Pressable key={tpl.key} style={styles.row} onPress={() => onPick(tpl)} accessibilityRole="button">
            <View style={[styles.preview, { aspectRatio: tpl.width / tpl.height, backgroundColor: tpl.background }]} />
            <View style={styles.flex}>
              <Text style={styles.label}>{t(`studio.image.templates.${tpl.key}`)}</Text>
              <Text style={styles.size}>{`${tpl.width}×${tpl.height}`}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, padding: 8, borderRadius: 12, backgroundColor: palette.surfaceHigh },
  preview: { height: 40, maxWidth: 90, borderRadius: 6 },
  flex: { flex: 1 },
  label: { color: palette.text, fontSize: 14, fontWeight: '700' },
  size: { color: palette.textDim, fontSize: 12 },
});

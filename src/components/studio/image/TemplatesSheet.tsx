import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ColorField } from '@/components/studio/image/ColorField';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { palette } from '@/constants/editor';
import { fontOptions } from '@/constants/fonts';
import { docBackground } from '@/lib/imageDoc';
import { docFromTemplate, IMAGE_TEMPLATES, type ImageTemplate } from '@/lib/imageTemplates';
import { useBrandStyle } from '@/store/brandStyleStore';

/** 🧩 Sablonok: mindegyik új lapot nyit szerkeszthető rétegekkel. */
export function TemplatesSheet({ onPick, onClose }: { onPick: (tpl: ImageTemplate) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const colors = useBrandStyle((s) => s.colors);
  const fontFamily = useBrandStyle((s) => s.fontFamily);
  const [color, setColor] = useState('#ff2d95');
  // az előnézet a márkával nyíló sablon hátterét mutatja
  const previewBackground = (tpl: ImageTemplate) => docBackground(docFromTemplate(tpl, '', () => 'x', { colors, fontFamily }));
  return (
    <StudioSheet title={t('studio.image.templates.title')} icon="albums-outline" onClose={onClose}>
      <View style={styles.brand}>
        <Text style={styles.label}>{t('studio.image.brand.title')}</Text>
        <Text style={styles.size}>{t('studio.image.brand.hint')}</Text>
        <ColorField value={color} onChange={setColor} />
        <Text style={styles.size}>{t('studio.image.brand.font')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fonts}>
          {fontOptions.filter((f) => f.family).map((f) => {
            const on = fontFamily === f.family;
            return (
              <Pressable
                key={f.id}
                testID={`brand-font-${f.id}`}
                style={[styles.font, on ? styles.fontOn : null]}
                onPress={() => void useBrandStyle.getState().setFont(on ? undefined : f.family)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.fontText, { fontFamily: f.family }]} numberOfLines={1}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View style={styles.list}>
        {IMAGE_TEMPLATES.map((tpl) => (
          <Pressable key={tpl.key} style={styles.row} onPress={() => onPick(tpl)} accessibilityRole="button">
            <View style={[styles.preview, { aspectRatio: tpl.width / tpl.height, backgroundColor: previewBackground(tpl) }]} />
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
  brand: { gap: 8, marginBottom: 14 },
  fonts: { gap: 6 },
  font: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  fontOn: { borderColor: palette.text, borderWidth: 2 },
  fontText: { color: palette.text, fontSize: 14 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, padding: 8, borderRadius: 12, backgroundColor: palette.surfaceHigh },
  preview: { height: 40, maxWidth: 90, borderRadius: 6 },
  flex: { flex: 1 },
  label: { color: palette.text, fontSize: 14, fontWeight: '700' },
  size: { color: palette.textDim, fontSize: 12 },
});

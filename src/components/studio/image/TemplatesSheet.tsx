import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ColorField } from '@/components/studio/image/ColorField';
import { StageLayers } from '@/components/studio/image/StageLayers';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { fontOptions } from '@/constants/fonts';
import { makeId } from '@/lib/id';
import { pickImage } from '@/lib/media';
import { docFromTemplate, TEMPLATE_CATEGORIES, templateFromDoc, templatesIn, type ImageTemplate, type TemplateCategory } from '@/lib/imageTemplates';
import { useBrandStyle } from '@/store/brandStyleStore';
import { useUserTemplates } from '@/store/userTemplatesStore';
import type { ImageDoc } from '@/types/project';

const PREVIEW_H = 64;

/** egy sablon kicsinyített előnézete — ugyanaz a réteg-fa, ami a vásznon és a kész képen (a helyőrző szaggatott) */
function TemplatePreview({ tpl }: { tpl: ImageTemplate }) {
  const colors = useBrandStyle((s) => s.colors);
  const fontFamily = useBrandStyle((s) => s.fontFamily);
  const doc = useMemo(() => docFromTemplate(tpl, '', () => 'p', { colors, fontFamily }), [tpl, colors, fontFamily]);
  const h = PREVIEW_H;
  const w = Math.min(120, (h * tpl.width) / tpl.height);
  const hh = (w * tpl.height) / tpl.width;
  return (
    <View style={[styles.preview, { width: w, height: hh }]} pointerEvents="none">
      <StageLayers doc={doc} w={w} h={hh} />
    </View>
  );
}

/**
 * 🧩 Sablon-könyvtár (IMAGE-PROD S9 · PRO-DESIGN DS1): kategóriák, beépített és saját sablonok,
 * mindegyik új lapot nyit szerkeszthető rétegekkel; a helyőrzőbe koppintva kép a galériából. A
 * „Mentés sablonként” az aktuális lapot teszi a saját sablonok közé (a telefonon, offline).
 */
export function TemplatesSheet({
  onPick,
  onClose,
  currentDoc,
  onBrandLogo,
}: {
  onPick: (tpl: ImageTemplate) => void;
  onClose: () => void;
  currentDoc?: ImageDoc | null;
  /** 🏷️ S11: a márka-logó a lapra (a hívó a projektbe másolja) */
  onBrandLogo?: (uri: string) => void;
}) {
  const { t } = useTranslation();
  const fontFamily = useBrandStyle((s) => s.fontFamily);
  const custom = useUserTemplates((s) => s.templates);
  const logos = useBrandStyle((s) => s.logos ?? []);
  const [color, setColor] = useState('#ff2d95');
  const [category, setCategory] = useState<TemplateCategory | 'all'>('all');
  const [saveName, setSaveName] = useState('');
  useEffect(() => {
    void useUserTemplates.getState().hydrate();
    void useBrandStyle.getState().hydrate();
  }, []);
  const addLogo = async () => {
    const picked = await pickImage();
    if (picked) await useBrandStyle.getState().addLogo(picked.uri);
  };
  const askRemoveLogo = (uri: string) =>
    Alert.alert(t('studio.image.brand.logoRemove'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void useBrandStyle.getState().removeLogo(uri) },
    ]);
  const list = templatesIn(category, custom);
  const nameOf = (tpl: ImageTemplate) => tpl.name ?? t(`studio.image.templates.${tpl.key}`);
  const saveCurrent = () => {
    if (!currentDoc) return;
    const name = saveName.trim() || currentDoc.name || t('studio.image.templates.myTemplate');
    void useUserTemplates.getState().add(templateFromDoc(currentDoc, makeId('tpl'), name));
    setSaveName('');
    Alert.alert(t('studio.image.templates.savedTitle'), t('studio.image.templates.savedBody', { name }));
  };
  const askRemove = (tpl: ImageTemplate) =>
    Alert.alert(t('studio.image.templates.removeTitle'), nameOf(tpl), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => void useUserTemplates.getState().remove(tpl.key) },
    ]);
  return (
    <StudioSheet title={t('studio.image.templates.title')} icon="albums-outline" onClose={onClose}>
      {currentDoc ? (
        <View style={styles.save}>
          <TextInput
            value={saveName}
            onChangeText={setSaveName}
            placeholder={currentDoc.name || t('studio.image.templates.myTemplate')}
            placeholderTextColor={palette.textDim}
            style={styles.input}
            accessibilityLabel={t('studio.image.templates.saveName')}
            testID="template-save-name"
          />
          <Pressable style={styles.saveBtn} onPress={saveCurrent} accessibilityRole="button" testID="template-save">
            <Text style={styles.saveText}>{t('studio.image.templates.saveAs')}</Text>
          </Pressable>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cats}>
        <Chip label={t('studio.image.templates.cat.all')} active={category === 'all'} onPress={() => setCategory('all')} />
        {TEMPLATE_CATEGORIES.map((c) => (
          <Chip key={c} label={t(`studio.image.templates.cat.${c}`)} active={category === c} onPress={() => setCategory(c)} />
        ))}
      </ScrollView>
      <View style={styles.list}>
        {list.map((tpl) => (
          <Pressable
            key={tpl.key}
            style={styles.row}
            onPress={() => onPick(tpl)}
            onLongPress={tpl.custom ? () => askRemove(tpl) : undefined}
            accessibilityRole="button"
            accessibilityHint={tpl.custom ? t('studio.image.templates.removeHint') : undefined}
          >
            <TemplatePreview tpl={tpl} />
            <View style={styles.flex}>
              <Text style={styles.label} numberOfLines={1}>{nameOf(tpl)}</Text>
              <Text style={styles.size}>{`${t(`studio.image.templates.cat.${tpl.category}`)} · ${tpl.width}×${tpl.height}${tpl.custom ? ` · ${t('studio.image.templates.mine')}` : ''}`}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <View style={styles.brand}>
        <Text style={styles.label}>{t('studio.image.brand.title')}</Text>
        <Text style={styles.size}>{t('studio.image.brand.hint')}</Text>
        <ColorField value={color} onChange={setColor} />
        {/* 🏷️ S11: márka-logók — koppintásra a lapra, hosszú nyomásra törlés; ugyanezek a videóban is */}
        <Text style={styles.size}>{t('studio.image.brand.logos')}</Text>
        <View style={styles.logos}>
          {logos.map((uri) => (
            <Pressable
              key={uri}
              style={styles.logo}
              onPress={() => onBrandLogo?.(uri)}
              onLongPress={() => askRemoveLogo(uri)}
              accessibilityRole="button"
              accessibilityLabel={t('studio.image.brand.logoInsert')}
              accessibilityHint={t('studio.image.brand.logoRemove')}
              testID="brand-logo"
            >
              <Image source={{ uri }} style={styles.logoImg} contentFit="contain" />
            </Pressable>
          ))}
          <Pressable style={[styles.logo, styles.logoAdd]} onPress={() => void addLogo()} accessibilityRole="button" accessibilityLabel={t('studio.image.brand.logoAdd')} testID="brand-logo-add">
            <Text style={styles.logoAddText}>＋</Text>
          </Pressable>
        </View>
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
    </StudioSheet>
  );
}

const styles = StyleSheet.create({
  save: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: { flex: 1, minHeight: 44, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.border, color: palette.text },
  saveBtn: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: palette.accent },
  saveText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cats: { gap: 6, paddingBottom: 10 },
  brand: { gap: 8, marginTop: 16 },
  fonts: { gap: 6 },
  logos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  logo: { width: 56, height: 56, borderRadius: 10, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  logoImg: { width: 48, height: 48 },
  logoAdd: { borderStyle: 'dashed' },
  logoAddText: { color: palette.textDim, fontSize: 22, fontWeight: '700' },
  font: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  fontOn: { borderColor: palette.text, borderWidth: 2 },
  fontText: { color: palette.text, fontSize: 14 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, padding: 8, borderRadius: 12, backgroundColor: palette.surfaceHigh },
  preview: { borderRadius: 6, overflow: 'hidden', backgroundColor: '#00000033' },
  flex: { flex: 1 },
  label: { color: palette.text, fontSize: 14, fontWeight: '700' },
  size: { color: palette.textDim, fontSize: 12 },
});

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { missingSeoFields } from '@/lib/createProjectForm';
import { logCaught } from '@/lib/logCaught';
import { parseHashtags, parseKeywords } from '@/lib/projectUtils';
import { saveProject } from '@/lib/storage';
import { useEditorStore } from '@/store/editorStore';
import { useSeoGate } from '@/store/seoGateStore';

/**
 * 📣 A megosztás előtti SEO-lap (IMAGE-PROD S22) — egyetlen példány az app gyökerében. A meglévő
 * értékekkel kitöltve nyílik; mentéskor a nyitott projektre parancsként (visszavonható), más
 * projektnél fájlba írja, majd a megosztás folytatódik.
 */
export function SeoGateHost() {
  const request = useSeoGate((s) => s.request);
  // a kérés sorszáma a kulcs: minden új kérés friss kezdőértékekkel nyitja a lapot
  return request ? <SeoGateForm key={request.seq} /> : null;
}

function SeoGateForm() {
  const { t } = useTranslation();
  const request = useSeoGate((s) => s.request);
  const finish = useSeoGate((s) => s.finish);
  const seo0 = request?.project.seo;
  const [description, setDescription] = useState(seo0?.description ?? '');
  const [hashtags, setHashtags] = useState((seo0?.hashtags ?? []).join(' '));
  const [keywords, setKeywords] = useState((seo0?.keywords ?? []).join(', '));
  const [saving, setSaving] = useState(false);

  if (!request) return null;
  const missing = missingSeoFields({ description, hashtags, keywords });
  const label: Record<string, string> = {
    description: t('home.descriptionLabel'),
    hashtags: t('home.hashtagsLabel'),
    keywords: t('home.keywordsLabel'),
  };

  const save = async () => {
    const project = request.project;
    const seo = {
      title: project.seo?.title || project.name,
      description: description.trim(),
      hashtags: parseHashtags(hashtags),
      keywords: parseKeywords(keywords),
    };
    setSaving(true);
    try {
      const store = useEditorStore.getState();
      if (store.project?.id === project.id) {
        store.dispatch({ type: 'SET_PROJECT_SEO', seo }, 'user');
        finish(useEditorStore.getState().project ?? { ...project, seo });
      } else {
        const next = { ...project, seo };
        await saveProject(next);
        finish(next);
      }
    } catch (caught) {
      logCaught('components/SeoGateHost.tsx:save', caught);
      finish(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => finish(null)}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            <Text maxFontSizeMultiplier={1.3} style={styles.title}>{t('seoGate.title')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.hint}>{t('seoGate.hint')}</Text>
            <Text maxFontSizeMultiplier={1.3} style={styles.label}>{label.description}</Text>
            <TextInput maxFontSizeMultiplier={1.3} accessibilityLabel={label.description} value={description} onChangeText={setDescription} style={[styles.input, styles.multi]} multiline placeholder={t(`home.descriptionPlaceholder_${request.project.kind ?? 'video'}`, { defaultValue: t('home.descriptionPlaceholder') })} placeholderTextColor={palette.textDim} />
            <Text maxFontSizeMultiplier={1.3} style={styles.label}>{label.hashtags}</Text>
            <TextInput maxFontSizeMultiplier={1.3} accessibilityLabel={label.hashtags} value={hashtags} onChangeText={setHashtags} style={styles.input} autoCapitalize="none" placeholder={t('home.hashtagsPlaceholder')} placeholderTextColor={palette.textDim} />
            <Text maxFontSizeMultiplier={1.3} style={styles.label}>{label.keywords}</Text>
            <TextInput maxFontSizeMultiplier={1.3} accessibilityLabel={label.keywords} value={keywords} onChangeText={setKeywords} style={styles.input} autoCapitalize="none" placeholder={t('home.keywordsPlaceholder')} placeholderTextColor={palette.textDim} />
            {missing.length > 0 ? (
              <Text maxFontSizeMultiplier={1.3} style={styles.missing}>{t('home.missingFields', { fields: missing.map((f) => label[f]).join(' · ') })}</Text>
            ) : null}
            <View style={styles.row}>
              <Pressable onPress={() => finish(null)} style={styles.btn} accessibilityRole="button">
                <Text maxFontSizeMultiplier={1.3} style={styles.btnText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={() => void save()} disabled={missing.length > 0 || saving} style={[styles.btn, styles.primary, missing.length > 0 || saving ? styles.disabled : null]} accessibilityRole="button" accessibilityState={{ disabled: missing.length > 0 || saving }}>
                <Text maxFontSizeMultiplier={1.3} style={[styles.btnText, styles.primaryText]}>{t('seoGate.continue')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#000a' },
  sheet: { backgroundColor: palette.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16, maxHeight: '85%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 13 },
  label: { color: palette.text, fontSize: 13, fontWeight: '700', marginTop: 6 },
  input: { borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: palette.text, fontSize: 15 },
  multi: { minHeight: 72, textAlignVertical: 'top' },
  missing: { color: palette.accent2 ?? palette.textDim, fontSize: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border, alignItems: 'center' },
  primary: { backgroundColor: palette.accent, borderColor: palette.accent },
  primaryText: { color: '#fff' },
  btnText: { color: palette.text, fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.4 },
});

import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, TextInput } from 'react-native';

import { styles } from '@/components/studio/createProject/createProjectStyles';
import { palette } from '@/constants/editor';
import type { CreateFieldId } from '@/lib/createProjectForm';
import type { ProjectKind } from '@/types/project';

/** ✍️ a név + SEO-mezők (leírás, hashtagek, kulcsszavak) — a CreateProjectModal.tsx-ből kiemelve */
export function SeoFields(props: {
  kind: ProjectKind;
  fieldRefs: Record<CreateFieldId, RefObject<TextInput | null>>;
  name: string;
  setName: (v: string) => void;
  seoDescription: string;
  setSeoDescription: (v: string) => void;
  seoHashtags: string;
  setSeoHashtags: (v: string) => void;
  seoKeywords: string;
  setSeoKeywords: (v: string) => void;
}) {
  const { t } = useTranslation();
  const {
    kind,
    fieldRefs,
    name,
    setName,
    seoDescription,
    setSeoDescription,
    seoHashtags,
    setSeoHashtags,
    seoKeywords,
    setSeoKeywords,
  } = props;
  return (
    <>
      <Text style={styles.fieldLabel}>{t('home.titleLabel')}</Text>
      <TextInput
        ref={fieldRefs.name}
        value={name}
        onChangeText={setName}
        placeholder={t('home.projectNamePlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        autoFocus
      />

      <Text style={styles.fieldLabel}>{t('home.seoSectionTitle')}</Text>
      <Text style={styles.seoHint}>{t('home.seoSectionHint')}</Text>

      <Text style={styles.fieldLabel}>{t('home.descriptionLabel')}</Text>
      <TextInput
        ref={fieldRefs.description}
        value={seoDescription}
        onChangeText={setSeoDescription}
        placeholder={t(`home.descriptionPlaceholder_${kind}`, {
          defaultValue: t('home.descriptionPlaceholder'),
        })}
        placeholderTextColor={palette.textDim}
        style={[styles.input, styles.inputMultiline]}
        multiline
      />

      <Text style={styles.fieldLabel}>{t('home.hashtagsLabel')}</Text>
      <TextInput
        ref={fieldRefs.hashtags}
        value={seoHashtags}
        onChangeText={setSeoHashtags}
        placeholder={t('home.hashtagsPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
        autoCapitalize="none"
      />

      <Text style={styles.fieldLabel}>{t('home.keywordsLabel')}</Text>
      <TextInput
        ref={fieldRefs.keywords}
        value={seoKeywords}
        onChangeText={setSeoKeywords}
        placeholder={t('home.keywordsPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
      />
    </>
  );
}

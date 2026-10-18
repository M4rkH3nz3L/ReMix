import { useTranslation } from 'react-i18next';
import { Text, TextInput } from 'react-native';

import { palette } from '@/constants/editor';
import { CollapsibleCard } from '@/components/ui/CollapsibleCard';
import { CreatorTypePicker, TagEditor } from '@/components/profile/CreatorControls';
import { SUGGESTED_INTERESTS, SUGGESTED_SKILLS } from '@/lib/creatorProfile';
import type { AccountProfile } from '@/lib/profile';
import { profileStyles as styles } from './styles';
import { SaveButton } from './SaveButton';

/**
 * 🎨 Creator-szekció („mutasd be magad"): típusok / készségek / érdeklődés / rólam /
 * mit készítek / éppen min dolgozom. Prezentációs — a mező-írás + mentés propból jön.
 */
export function CreatorCard({
  profile,
  setField,
  setArr,
  savingProfile,
  profileValid,
  onSaveProfile,
}: {
  profile: AccountProfile;
  setField: (key: keyof AccountProfile, value: string) => void;
  setArr: (key: 'creatorTypes' | 'skills' | 'interests' | 'languages', value: string[]) => void;
  savingProfile: boolean;
  profileValid: boolean;
  onSaveProfile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CollapsibleCard
      icon="color-palette-outline"
      title={t('creatorProfile.section')}
      subtitle={t('creatorProfile.sectionHint')}
    >
      <Text style={styles.fieldLabel}>{t('creatorProfile.typesLabel')}</Text>
      <CreatorTypePicker value={profile.creatorTypes} onChange={(v) => setArr('creatorTypes', v)} />

      <Text style={styles.fieldLabel}>{t('creatorProfile.skillsLabel')}</Text>
      <TagEditor
        value={profile.skills}
        onChange={(v) => setArr('skills', v)}
        suggestions={SUGGESTED_SKILLS}
        placeholder={t('creatorProfile.skillsPlaceholder')}
      />

      <Text style={styles.fieldLabel}>{t('creatorProfile.interestsLabel')}</Text>
      <TagEditor
        value={profile.interests}
        onChange={(v) => setArr('interests', v)}
        suggestions={SUGGESTED_INTERESTS}
        placeholder={t('creatorProfile.interestsPlaceholder')}
      />

      <Text style={styles.fieldLabel}>{t('creatorProfile.aboutLabel')}</Text>
      <TextInput
        value={profile.aboutMe}
        onChangeText={(v) => setField('aboutMe', v)}
        placeholder={t('creatorProfile.aboutPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={[styles.input, styles.inputArea]}
        multiline
      />

      <Text style={styles.fieldLabel}>{t('creatorProfile.whatLabel')}</Text>
      <TextInput
        value={profile.whatIMake}
        onChangeText={(v) => setField('whatIMake', v)}
        placeholder={t('creatorProfile.whatPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={[styles.input, styles.inputArea]}
        multiline
      />

      <Text style={styles.fieldLabel}>{t('creatorProfile.workingLabel')}</Text>
      <TextInput
        value={profile.workingOn}
        onChangeText={(v) => setField('workingOn', v)}
        placeholder={t('creatorProfile.workingPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
      />

      <SaveButton saving={savingProfile} valid={profileValid} onSave={onSaveProfile} />
    </CollapsibleCard>
  );
}

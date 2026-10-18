import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { CollapsibleCard } from '@/components/ui/CollapsibleCard';
import { TagEditor } from '@/components/profile/CreatorControls';
import { SUGGESTED_LANGUAGES } from '@/lib/creatorProfile';
import type { AccountProfile } from '@/lib/profile';
import { profileStyles as styles } from './styles';
import { SaveButton } from './SaveButton';

/**
 * 🔒 Személyes adatok (alapból privát mezők): telefon / születésnap / hely / nyelvek /
 * időzóna. Prezentációs — a mezők írása + mentés + időzóna-detektálás propból jön.
 */
export function PersonalCard({
  profile,
  setField,
  setArr,
  phoneError,
  birthdayError,
  detectTimezone,
  savingProfile,
  profileValid,
  onSaveProfile,
}: {
  profile: AccountProfile;
  setField: (key: keyof AccountProfile, value: string) => void;
  setArr: (key: 'creatorTypes' | 'skills' | 'interests' | 'languages', value: string[]) => void;
  phoneError: boolean;
  birthdayError: boolean;
  detectTimezone: () => void;
  savingProfile: boolean;
  profileValid: boolean;
  onSaveProfile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CollapsibleCard
      icon="lock-closed-outline"
      title={t('profile.personalSection')}
      subtitle={t('profile.personalHint')}
    >
      <Text style={styles.fieldLabel}>{t('auth.phoneLabel')}</Text>
      <TextInput
        value={profile.phone}
        onChangeText={(v) => setField('phone', v)}
        placeholder={t('auth.phonePlaceholder')}
        placeholderTextColor={palette.textDim}
        style={[styles.input, phoneError && styles.inputError]}
        keyboardType="phone-pad"
      />
      {phoneError ? <Text style={styles.error}>{t('auth.phoneInvalid')}</Text> : null}

      <Text style={styles.fieldLabel}>{t('auth.birthdayLabel')}</Text>
      <TextInput
        value={profile.birthday}
        onChangeText={(v) => setField('birthday', v)}
        placeholder={t('auth.birthdayPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={[styles.input, birthdayError && styles.inputError]}
        autoCapitalize="none"
      />
      {birthdayError ? <Text style={styles.error}>{t('auth.birthdayInvalid')}</Text> : null}

      <Text style={styles.fieldLabel}>{t('auth.locationLabel')}</Text>
      <TextInput
        value={profile.country}
        onChangeText={(v) => setField('country', v)}
        placeholder={t('auth.countryPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
      />
      <TextInput
        value={profile.city}
        onChangeText={(v) => setField('city', v)}
        placeholder={t('auth.cityPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.input}
      />

      <Text style={styles.fieldLabel}>{t('profile.languagesLabel')}</Text>
      <TagEditor
        value={profile.languages}
        onChange={(v) => setArr('languages', v)}
        suggestions={SUGGESTED_LANGUAGES}
        placeholder={t('profile.languagesPlaceholder')}
      />

      <Text style={styles.fieldLabel}>{t('profile.timezoneLabel')}</Text>
      <View style={styles.tzRow}>
        <TextInput
          value={profile.timezone}
          onChangeText={(v) => setField('timezone', v)}
          placeholder={t('profile.timezonePlaceholder')}
          placeholderTextColor={palette.textDim}
          style={[styles.input, { flex: 1 }]}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={detectTimezone} style={styles.tzAuto} accessibilityRole="button">
          <Ionicons name="navigate" size={15} color={palette.accent} />
          <Text style={styles.tzAutoText}>{t('profile.timezoneAuto')}</Text>
        </Pressable>
      </View>

      <SaveButton saving={savingProfile} valid={profileValid} onSave={onSaveProfile} />
    </CollapsibleCard>
  );
}

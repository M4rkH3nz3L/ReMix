import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { profileStyles as styles } from './styles';

/**
 * 👤 Fiók-szekció: bejelentkezett email + MFA/eszközök belépők, más munkamenetek
 * kiléptetése, kijelentkezés, és a fiók törlése (GDPR). Prezentációs — a handlerek propból.
 */
export function AccountCard({
  email,
  onSignOutOthers,
  onSignOut,
  onDeleteAccount,
}: {
  email: string;
  onSignOutOthers: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.accountSection')}</Text>
      <View style={styles.card}>
        <Text style={styles.emailText}>{t('auth.signedInAs', { email })}</Text>
        <Pressable onPress={() => router.push('/mfa')} style={styles.signOutBtn}>
          <Ionicons name="shield-checkmark-outline" size={18} color={palette.text} />
          <Text style={[styles.signOutText, { color: palette.text }]}>{t('auth.mfaEntry')}</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/devices')} style={styles.signOutBtn}>
          <Ionicons name="phone-portrait-outline" size={18} color={palette.text} />
          <Text style={[styles.signOutText, { color: palette.text }]}>{t('auth.devicesTitle')}</Text>
        </Pressable>
        <Pressable onPress={onSignOutOthers} style={styles.signOutBtn}>
          <Ionicons name="log-out-outline" size={18} color={palette.text} />
          <Text style={[styles.signOutText, { color: palette.text }]}>{t('auth.signOutOthers')}</Text>
        </Pressable>
        <Pressable onPress={onSignOut} style={styles.signOutBtn}>
          <Ionicons name="log-out-outline" size={18} color={palette.danger} />
          <Text style={styles.signOutText}>{t('auth.signOut')}</Text>
        </Pressable>
        <Pressable onPress={onDeleteAccount} style={styles.signOutBtn}>
          <Ionicons name="person-remove-outline" size={18} color={palette.danger} />
          <Text style={styles.signOutText}>{t('gdpr.deleteTitle')}</Text>
        </Pressable>
      </View>
    </>
  );
}

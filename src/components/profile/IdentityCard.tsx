import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { palette } from '@/constants/editor';
import { CollapsibleCard } from '@/components/ui/CollapsibleCard';
import { reachableMediaUrl } from '@/lib/mediaUrl';
import type { AccountProfile } from '@/lib/profile';
import { profileStyles as styles } from './styles';
import { SaveButton } from './SaveButton';

/**
 * 👤 Identitás-szekció: borító + avatar (kattintható kép-választóval) + username + név + bio.
 * Prezentációs — a kép-választás és a mentés handlerei propból jönnek (saját fetch nincs).
 */
export function IdentityCard({
  profile,
  setField,
  usernameError,
  nameError,
  imgBusy,
  onPickImage,
  savingProfile,
  profileValid,
  onSaveProfile,
}: {
  profile: AccountProfile;
  setField: (key: keyof AccountProfile, value: string) => void;
  usernameError: boolean;
  nameError: boolean;
  imgBusy: boolean;
  onPickImage: (kind: 'avatar' | 'cover') => void;
  savingProfile: boolean;
  profileValid: boolean;
  onSaveProfile: () => void;
}) {
  const { t } = useTranslation();
  return (
    <CollapsibleCard
      icon="person-circle-outline"
      title={t('profile.identitySection')}
      subtitle={t('profile.identityHint')}
      defaultOpen
    >
      <View style={styles.coverWrap}>
        <Pressable
          onPress={() => onPickImage('cover')}
          disabled={imgBusy}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('profile.changeCover')}
        >
          {reachableMediaUrl(profile.coverUrl) ? (
            <Image
              source={{ uri: reachableMediaUrl(profile.coverUrl) ?? undefined }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.coverPlaceholder]} />
          )}
        </Pressable>
        <View style={styles.coverBadge} pointerEvents="none">
          <Ionicons name="camera" size={13} color="#fff" />
          <Text style={styles.coverBadgeText}>{t('profile.changeCover')}</Text>
        </View>
        <Pressable
          onPress={() => onPickImage('avatar')}
          disabled={imgBusy}
          style={styles.avatarEdit}
          accessibilityRole="button"
          accessibilityLabel={t('profile.changeAvatar')}
        >
          {reachableMediaUrl(profile.avatarUrl) ? (
            <Image
              source={{ uri: reachableMediaUrl(profile.avatarUrl) ?? undefined }}
              style={styles.avatarImg}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatarImg, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitial}>
                {(profile.fullName || '?').slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.avatarCam} pointerEvents="none">
            <Ionicons name="camera" size={11} color="#fff" />
          </View>
        </Pressable>
      </View>
      <Text style={styles.sectionHint}>
        {imgBusy ? t('profile.imageUploading') : t('profile.appearanceHint')}
      </Text>

      {/* 🔑 EGYEDI felhasználónév (login-handle) — ezzel is be lehet lépni; NEM a display name */}
      <Text style={styles.fieldLabel}>{t('auth.usernameLabel')}</Text>
      <TextInput
        value={profile.username}
        onChangeText={(v) => setField('username', v.trim())}
        placeholder={t('auth.usernamePlaceholder')}
        placeholderTextColor={palette.textDim}
        style={[styles.input, usernameError && styles.inputError]}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={usernameError ? styles.error : styles.sectionHint}>
        {t('auth.usernameHint')}
      </Text>

      <Text style={styles.fieldLabel}>{t('auth.nameLabel')}</Text>
      <TextInput
        value={profile.fullName}
        onChangeText={(v) => setField('fullName', v)}
        placeholder={t('auth.namePlaceholder')}
        placeholderTextColor={palette.textDim}
        style={[styles.input, nameError && styles.inputError]}
        autoCapitalize="words"
      />
      {nameError ? <Text style={styles.error}>{t('auth.nameHint')}</Text> : null}

      <Text style={styles.fieldLabel}>{t('creatorProfile.bioLabel')}</Text>
      <TextInput
        value={profile.bio}
        onChangeText={(v) => setField('bio', v)}
        placeholder={t('creatorProfile.bioPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={[styles.input, styles.inputArea]}
        multiline
        maxLength={500}
      />
      <Text style={styles.counter}>{`${profile.bio.length}/500`}</Text>

      <SaveButton saving={savingProfile} valid={profileValid} onSave={onSaveProfile} />
    </CollapsibleCard>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { wipeAllProjects } from '@/lib/projectWipe';
import { profileStyles as styles } from './styles';

/**
 * 🧨 Veszélyzóna: az ÖSSZES projekt törlése (eszköz + saját felhő-sorok) —
 * tiszta lap a régi (média-GC előtti) projektek bugjai/árva fájljai után.
 * Dupla megerősítés; az eredmény összegzése Alertben.
 */
export function DangerZoneCard() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const runWipe = () => {
    setBusy(true);
    wipeAllProjects()
      .then((r) =>
        Alert.alert(
          t('profile.danger.wipeTitle'),
          t('profile.danger.wipeDone', {
            projects: r.projects,
            files: r.files,
            cloud: r.cloudOk ? t('profile.danger.cloudOk') : t('profile.danger.cloudSkipped'),
          }),
        ),
      )
      .catch((e: Error) => Alert.alert(t('common.error'), e.message))
      .finally(() => setBusy(false));
  };

  const confirmWipe = () => {
    Alert.alert(t('profile.danger.wipeTitle'), t('profile.danger.wipeConfirm1'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.danger.wipeCta'),
        style: 'destructive',
        onPress: () =>
          // 🧨 második megerősítés — ez visszafordíthatatlan
          Alert.alert(t('profile.danger.wipeTitle'), t('profile.danger.wipeConfirm2'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('profile.danger.wipeCta2'), style: 'destructive', onPress: runWipe },
          ]),
      },
    ]);
  };

  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.danger.title')}</Text>
      <View style={styles.card}>
        <Pressable
          onPress={busy ? undefined : confirmWipe}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator size="small" color={palette.danger} />
          ) : (
            <Ionicons name="nuclear-outline" size={20} color={palette.danger} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: palette.danger, fontSize: 14, fontWeight: '700' }}>
              {t('profile.danger.wipeTitle')}
            </Text>
            <Text style={styles.sectionHint}>{t('profile.danger.wipeHint')}</Text>
          </View>
        </Pressable>
      </View>
    </>
  );
}

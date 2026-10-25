import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { flushBugQueue, pendingBugCount, reportBug, type BugReportResult } from '@/lib/bugReporter';
import { profileStyles as styles } from './styles';

/**
 * 🐞 Hibajelentés-diagnosztika (csak dev-buildben): egy gombbal teszt-hibát küld
 * a szerver `server/bugs/` mappájába, és kiírja az eredményt — így eszközönként
 * bizonyítható, hogy a hibagyűjtés él. Mutatja a sorban várakozó (offline)
 * jelentések számát, és kézzel is üríthető.
 */
export function BugReportCard() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BugReportResult | null>(null);
  const [pending, setPending] = useState(0);

  const refreshPending = useCallback(() => {
    void pendingBugCount().then(setPending);
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  const sendTest = () => {
    setBusy(true);
    reportBug(new Error(`ReMix teszt-hiba (${new Date().toISOString()})`), {
      kind: 'handled',
      extra: { test: true },
    })
      .then(async (r) => {
        setResult(r);
        await flushBugQueue();
      })
      .finally(() => {
        setBusy(false);
        refreshPending();
      });
  };

  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.bugs.title')}</Text>
      <View style={styles.card}>
        <Pressable
          onPress={busy ? undefined : sendTest}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <Ionicons name="bug-outline" size={20} color={palette.accent} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ color: palette.text, fontSize: 14, fontWeight: '700' }}>
              {t('profile.bugs.sendTest')}
            </Text>
            <Text style={styles.sectionHint}>
              {result ? t(`profile.bugs.result_${result}`) : t('profile.bugs.hint')}
              {' · '}
              {t('profile.bugs.pending', { count: pending })}
            </Text>
          </View>
        </Pressable>
      </View>
    </>
  );
}

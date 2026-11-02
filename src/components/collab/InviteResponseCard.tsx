import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';

/** 👥 Meghívó elfogadása: addig a meghívott nem fér a projekthez. */
export function InviteResponseCard({
  projectName,
  role,
  onRespond,
}: {
  projectName: string;
  role: string;
  onRespond: (accept: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const respond = async (accept: boolean) => {
    setBusy(true);
    try {
      await onRespond(accept);
    } catch (caught) {
      logCaught('components/collab/InviteResponseCard.tsx', caught);
      Alert.alert(t('common.error'), caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('collab.invite.received.title')}</Text>
      <Text style={styles.name} numberOfLines={2}>{projectName}</Text>
      <Text style={styles.body}>{t('collab.invite.received.body', { role })}</Text>
      <Pressable testID="invite-accept" disabled={busy} style={[styles.btn, styles.accept]} onPress={() => void respond(true)} accessibilityRole="button">
        <Text style={styles.acceptText}>{t('collab.invite.received.accept')}</Text>
      </Pressable>
      <Pressable testID="invite-decline" disabled={busy} style={styles.btn} onPress={() => void respond(false)} accessibilityRole="button">
        <Text style={styles.declineText}>{t('collab.invite.received.decline')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, padding: 16, gap: 10, borderRadius: 14, backgroundColor: palette.surface },
  title: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  name: { color: palette.text, fontSize: 20, fontWeight: '800' },
  body: { color: palette.textDim, fontSize: 14, lineHeight: 20 },
  btn: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  accept: { backgroundColor: palette.accent },
  acceptText: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  declineText: { color: palette.textDim, fontSize: 15, fontWeight: '700' },
});

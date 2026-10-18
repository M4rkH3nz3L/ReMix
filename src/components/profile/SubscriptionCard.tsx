import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { billingClientAvailable } from '@/lib/billing';
import type { SubscriptionDetails } from '@/lib/subscription';
import { profileStyles as styles } from './styles';

/**
 * 💳 Pro-előfizetés szekció: aktív (részletek + visszaállítás) VAGY free (CTA + visszaállítás),
 * plus CSAK DEV a közvetlen Pro be/ki kapcsoló. Prezentációs — minden adat/handler propból.
 */
export function SubscriptionCard({
  isPro,
  sub,
  proMeta,
  onSubscribe,
  onRestore,
  devBusy,
  onDevActivate,
  onDevDeactivate,
}: {
  isPro: boolean;
  sub: SubscriptionDetails | null;
  proMeta: { untilText: string; updatedText: string | null };
  onSubscribe: () => void;
  onRestore: () => void;
  devBusy: boolean;
  onDevActivate: () => void;
  onDevDeactivate: () => void;
}) {
  const { t } = useTranslation();
  const subRow = (label: string, value: string) => (
    <View style={styles.subRow}>
      <Text style={styles.subRowLabel}>{label}</Text>
      <Text style={styles.subRowValue}>{value}</Text>
    </View>
  );
  return (
    <>
      <Text style={styles.sectionTitle}>{t('profile.subscriptionSection')}</Text>
      <View style={styles.card}>
        {isPro ? (
          <>
            <View style={styles.subHeader}>
              <View style={styles.proBadge}>
                <Ionicons name="sparkles" size={13} color={palette.accent} />
                <Text style={styles.proBadgeText}>PRO</Text>
              </View>
              <Text style={styles.subActive}>{t('profile.subActive')}</Text>
            </View>
            {subRow(
              t('profile.subStatusLabel'),
              t(`profile.subStatus.${sub?.status ?? 'active'}`, {
                defaultValue: sub?.status ?? 'active',
              })
            )}
            {subRow(t('profile.subUntilLabel'), proMeta.untilText)}
            {subRow(
              t('profile.subSourceLabel'),
              t(`profile.subSource.${sub?.source ?? 'manual'}`, {
                defaultValue: sub?.source ?? 'manual',
              })
            )}
            {proMeta.updatedText
              ? subRow(t('profile.subUpdatedLabel'), proMeta.updatedText)
              : null}
            {billingClientAvailable() ? (
              <Pressable onPress={onRestore} style={styles.subRestore}>
                <Ionicons name="refresh" size={15} color={palette.textDim} />
                <Text style={styles.subRestoreText}>{t('paywallSheet.restore')}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <View style={styles.subHeader}>
              <View style={styles.freeBadge}>
                <Text style={styles.freeBadgeText}>FREE</Text>
              </View>
              <Text style={styles.subFreeTitle}>{t('profile.subNone')}</Text>
            </View>
            <Text style={styles.subFreeHint}>{t('profile.subNoneHint')}</Text>
            <View style={{ marginTop: 10, gap: 8 }}>
              <PrimaryButton icon="rocket" label={t('profile.subscribeCta')} onPress={onSubscribe} />
              {billingClientAvailable() ? (
                <Pressable onPress={onRestore} style={styles.subRestore}>
                  <Ionicons name="refresh" size={15} color={palette.textDim} />
                  <Text style={styles.subRestoreText}>{t('paywallSheet.restore')}</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        )}
        {__DEV__ ? (
          <Pressable
            onPress={isPro ? onDevDeactivate : onDevActivate}
            disabled={devBusy}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              marginTop: 12,
              paddingVertical: 9,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: palette.border,
              borderStyle: 'dashed',
            }}
          >
            <Ionicons name="construct-outline" size={14} color={palette.accent2} />
            <Text style={{ color: palette.accent2, fontSize: 12, fontWeight: '700' }}>
              {devBusy
                ? t('profile.devProBusy')
                : isPro
                  ? t('profile.devProOff')
                  : t('profile.devProOn')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}

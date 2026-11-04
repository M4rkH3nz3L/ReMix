import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { DevBillingPanel } from '@/components/profile/DevBillingPanel';
import { PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { billingClientAvailable } from '@/lib/billing';
import type { SubscriptionDetails } from '@/lib/subscription';
import { tierLabelKey } from '@/lib/tiers';
import { useEntitlement } from '@/store/entitlementStore';
import { profileStyles as styles } from './styles';

/**
 * 💳 Előfizetés szekció: aktív fizetős szint (Amatőr / Haladó / Profi / Vállalati — részletek +
 * visszaállítás) VAGY Free (CTA + visszaállítás), plusz CSAK DEV a teljes dev-admin panel
 * (szint, Coin, KYC, ciklus). Az adatok propból; a szint az entitlement-store-ból.
 */
export function SubscriptionCard({
  sub,
  proMeta,
  onSubscribe,
  onRestore,
}: {
  sub: SubscriptionDetails | null;
  proMeta: { untilText: string; updatedText: string | null };
  onSubscribe: () => void;
  onRestore: () => void;
}) {
  const { t } = useTranslation();
  // a valódi aktív szint (az Amatőr is fizetős — eddig az `isPro` miatt Free-nek látszott)
  const tier = useEntitlement((st) => st.effectiveTier());
  const paid = tier !== 'free';
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
        {paid ? (
          <>
            <View style={styles.subHeader}>
              <View style={styles.proBadge}>
                <Ionicons name="sparkles" size={13} color={palette.accent} />
                <Text style={styles.proBadgeText}>{t(tierLabelKey(tier)).toUpperCase()}</Text>
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
        {__DEV__ ? <DevBillingPanel /> : null}
      </View>
    </>
  );
}

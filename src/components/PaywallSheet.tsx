import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { accentGradient, palette } from '@/constants/editor';
import {
  activateProDev,
  billingClientAvailable,
  purchaseTier,
  PurchaseCancelledError,
  restorePurchases,
} from '@/lib/billing';
import { capabilityLabel } from '@/lib/capabilities';
import { formatEur } from '@/lib/coins';
import { ANNUAL_FREE_MONTHS, planPrice, planRows, recommendedTier, type PlanCell } from '@/lib/paywallPlans';
import { InsufficientCreditsError } from '@/lib/shop';
import type { BillingPeriod } from '@/lib/storeProducts';
import { TIER_ORDER, tierLabelKey, type Tier } from '@/lib/tiers';
import { ManagedByStoreError, fetchSubscription, startTrial, subscribeWithCoins } from '@/lib/wallet';
import { usePaywall } from '@/store/paywallStore';
import { useUpsell } from '@/store/upsellStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 💳 Paywall v2 (PRO-CASH C1.4) — 5 szintes összehasonlítás, havi/éves, Coin- és áruházi út, próba.
 *
 * Egyetlen példány él az app gyökerében; a `usePaywall` store nyitja (a kiváltó képesség
 * minimum-szintje lesz a kiemelt csomag). A tábla minden száma a `paywallPlans` magból jön
 * (ENTITLEMENTS / TIER_QUOTAS / árak), így nem csúszhat el a valódi kaputól. Fizetés:
 *   • Coinból — a legolcsóbb út (1 Coin = 5 € a weben), szerver-hiteles `subscribe_with_coins`;
 *   • áruházban — RevenueCat IAP (`remix_<szint>_<periódus>`), ha elérhető;
 *   • 7 napos Amatőr-próba kártya és Coin nélkül, ha még nem használta;
 *   • dev-ben a szerver-hiteles /billing/activate.
 */

type BuyTier = Exclude<Tier, 'free' | 'business'>;
const BUY_TIERS: BuyTier[] = ['basic', 'pro', 'ultra'];

export function PaywallSheet() {
  const { t } = useTranslation();
  const visible = usePaywall((s) => s.visible);
  const capability = usePaywall((s) => s.capability);
  const closeSheet = usePaywall((s) => s.close);
  const offer = usePaywall((s) => s.offer);
  // „Most nem” egy ösztönző ajánlatnál: 72 óra csend (PRO-CASH 4.4)
  const dismiss = () => {
    if (offer) {
      useUpsell.getState().dismiss();
    }
    closeSheet();
  };
  const close = closeSheet;
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  // a kiemelt szint a kiváltó képességből jön; a user választása erre a megnyitásra szól
  const [override, setOverride] = useState<{ capability: typeof capability; tier: BuyTier } | null>(null);
  const defaultTier: BuyTier = offer ? offer.tier : recommendedTier(capability);
  const picked: BuyTier = override && override.capability === capability ? override.tier : defaultTier;
  const setPicked = (tier: BuyTier) => setOverride({ capability, tier });
  const [trialAvailable, setTrialAvailable] = useState(false);

  const rows = useMemo(() => planRows(), []);
  const trigger = capability ? capabilityLabel(capability) : null;
  const canBuy = billingClientAvailable();
  const price = planPrice(picked, period);

  useEffect(() => {
    if (!visible) {
      return;
    }
    fetchSubscription()
      .then((sub) => setTrialAvailable(!!sub?.trialAvailable))
      .catch((caught) => { logCaught('components/PaywallSheet.tsx:trial', caught); });
  }, [visible, capability]);

  const run = async (fn: () => Promise<boolean>) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (await fn()) {
        close();
      }
    } catch (e) {
      logCaught('components/PaywallSheet.tsx:run', e);
      if (e instanceof PurchaseCancelledError) {
        return; // felhasználó megszakította — nincs hibajelzés
      }
      if (e instanceof InsufficientCreditsError) {
        Alert.alert(t('wallet.notEnoughTitle'), t('paywallSheet.needCoins', { coins: price.coins }), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('wallet.goToShop'), onPress: () => { close(); router.push('/shop'); } },
        ]);
        return;
      }
      if (e instanceof ManagedByStoreError) {
        Alert.alert(t('paywallSheet.errorTitle'), t('wallet.sub.storeManaged'));
        return;
      }
      Alert.alert(t('paywallSheet.errorTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCoins = () =>
    run(async () => {
      const res = await subscribeWithCoins(picked, period === 'annual' ? 12 : 1);
      Alert.alert(t('wallet.subDoneTitle'), t('wallet.subDoneMsg', { tier: t(tierLabelKey(picked)), until: new Date(res.until).toLocaleDateString() }));
      return true;
    });

  const onStore = () =>
    run(async () => {
      if (canBuy) {
        return purchaseTier(picked, period);
      }
      if (__DEV__) {
        return activateProDev();
      }
      Alert.alert(t('paywallSheet.comingSoonTitle'), t('paywallSheet.comingSoonBody'));
      return false;
    });

  const onTrial = () =>
    run(async () => {
      const res = await startTrial();
      Alert.alert(t('paywallSheet.trialStartedTitle'), t('paywallSheet.trialStartedMsg', { date: new Date(res.until).toLocaleDateString() }));
      return true;
    });

  const onRestore = () =>
    run(async () => {
      const ok = await restorePurchases();
      Alert.alert(t('paywallSheet.restoreTitle'), ok ? t('paywallSheet.restoreOk') : t('paywallSheet.restoreNone'));
      return ok;
    });

  const cell = (c: PlanCell, highlight: boolean) =>
    c.kind === 'bool' ? (
      <Ionicons
        name={c.value ? 'checkmark-circle' : 'remove'}
        size={16}
        color={c.value ? (highlight ? palette.accent : palette.text) : palette.textDim}
      />
    ) : (
      <Text style={[styles.cellText, highlight && styles.cellTextHi]} numberOfLines={2}>
        {t(c.key, c.params)}
      </Text>
    );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={dismiss} />
        <View style={styles.sheet}>
          <LinearGradient colors={[...accentGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
            <View style={styles.badge}>
              <Ionicons name="sparkles" size={14} color={palette.text} />
              <Text style={styles.badgeText}>REMIX</Text>
            </View>
            <Text style={styles.heroTitle}>{t('paywallSheet.heroTitle')}</Text>
            <Text style={styles.heroSub}>
              {offer ? t(offer.messageKey) : trigger ? t('paywallSheet.heroSubTrigger', { trigger }) : t('paywallSheet.heroSub')}
            </Text>
          </LinearGradient>

          <ScrollView style={styles.body} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
            {/* havi / éves */}
            <View style={styles.segment}>
              {(['monthly', 'annual'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPeriod(p)}
                  style={[styles.segBtn, period === p && styles.segBtnOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: period === p }}
                >
                  <Text style={[styles.segText, period === p && styles.segTextOn]}>
                    {p === 'monthly' ? t('wallet.monthly') : t('paywallSheet.annualGift', { n: ANNUAL_FREE_MONTHS })}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* szintválasztó */}
            <View style={styles.tierRow}>
              {BUY_TIERS.map((tier) => {
                const p = planPrice(tier, period);
                const on = picked === tier;
                return (
                  <Pressable
                    key={tier}
                    onPress={() => setPicked(tier)}
                    style={[styles.tierCard, on && styles.tierCardOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                  >
                    {tier === defaultTier ? <Text style={styles.reco}>{t('paywallSheet.recommended')}</Text> : null}
                    <Text style={styles.tierName}>{t(tierLabelKey(tier))}</Text>
                    <Text style={styles.tierPrice}>{p.coins} 🪙</Text>
                    <Text style={styles.tierSub}>
                      {period === 'monthly' ? t('paywallSheet.perMonth') : t('paywallSheet.perYear')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* összehasonlítás: Free | Amatőr | Haladó | Profi | Vállalati */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View>
                <View style={styles.tRow}>
                  <View style={styles.tLabel} />
                  {TIER_ORDER.map((tier) => (
                    <View key={tier} style={[styles.tCell, tier === picked && styles.tCellHi]}>
                      <Text style={[styles.tHead, tier === picked && styles.cellTextHi]}>{t(tierLabelKey(tier))}</Text>
                    </View>
                  ))}
                </View>
                {rows.map((row) => (
                  <View key={row.label} style={styles.tRow}>
                    <View style={styles.tLabel}>
                      <Text style={styles.tLabelText} numberOfLines={2}>{t(row.label)}</Text>
                    </View>
                    {TIER_ORDER.map((tier) => (
                      <View key={tier} style={[styles.tCell, tier === picked && styles.tCellHi]}>
                        {cell(row.cells[tier], tier === picked)}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </ScrollView>
            <Text style={styles.note}>{t('paywallSheet.businessNote')}</Text>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onCoins} disabled={busy} style={styles.ctaPressable} accessibilityRole="button">
              <LinearGradient colors={[...accentGradient]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cta}>
                <Ionicons name="wallet" size={16} color={palette.text} />
                <Text style={styles.ctaText}>
                  {busy ? t('paywallSheet.activating') : t('paywallSheet.payCoins', { tier: t(tierLabelKey(picked)), coins: price.coins })}
                </Text>
              </LinearGradient>
            </Pressable>
            <Text style={styles.cheapest}>{t('paywallSheet.coinsCheapest', { eur: formatEur(price.coins * 5) })}</Text>
            {canBuy || __DEV__ ? (
              <Pressable onPress={onStore} disabled={busy} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>
                  {canBuy && price.storeEur != null
                    ? t('paywallSheet.payStore', { price: formatEur(price.storeEur) })
                    : `${t('paywallSheet.activatePro')} (DEV)`}
                </Text>
              </Pressable>
            ) : null}
            {trialAvailable ? (
              <Pressable onPress={onTrial} disabled={busy} style={styles.secondary} accessibilityRole="button">
                <Text style={styles.secondaryText}>{t('paywallSheet.trialCta')}</Text>
              </Pressable>
            ) : null}
            <View style={styles.linksRow}>
              {canBuy ? (
                <Pressable onPress={onRestore} disabled={busy} style={styles.dismiss}>
                  <Text style={styles.dismissText}>{t('paywallSheet.restore')}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={dismiss} disabled={busy} style={styles.dismiss}>
                <Text style={styles.dismissText}>{t('paywallSheet.notNow')}</Text>
              </Pressable>
            </View>
            <Text style={styles.legal}>{t('paywallSheet.legal')}</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000000aa',
    justifyContent: 'flex-end',
  },
  backdropTap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    maxHeight: '86%',
    overflow: 'hidden',
  },
  hero: {
    padding: 20,
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#00000033',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  heroTitle: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '800',
  },
  heroSub: {
    color: '#ffffffdd',
    fontSize: 13,
    lineHeight: 18,
  },
  body: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  segment: { flexDirection: 'row', backgroundColor: palette.surfaceHigh, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40, borderRadius: 10 },
  segBtnOn: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.accent },
  segText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  segTextOn: { color: palette.text },
  tierRow: { flexDirection: 'row', gap: 8 },
  tierCard: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
    minHeight: 92,
    justifyContent: 'center',
  },
  tierCardOn: { borderColor: palette.accent, borderWidth: 2 },
  reco: { color: palette.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  tierName: { color: palette.text, fontSize: 14, fontWeight: '800' },
  tierPrice: { color: palette.text, fontSize: 18, fontWeight: '900' },
  tierSub: { color: palette.textDim, fontSize: 11 },
  tRow: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  tLabel: { width: 118, paddingVertical: 8, justifyContent: 'center' },
  tLabelText: { color: palette.textDim, fontSize: 12 },
  tCell: { width: 82, paddingVertical: 8, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  tCellHi: { backgroundColor: '#ffffff0d' },
  tHead: { color: palette.text, fontSize: 12, fontWeight: '800' },
  cellText: { color: palette.text, fontSize: 11, textAlign: 'center' },
  cellTextHi: { color: palette.accent, fontWeight: '700' },
  note: { color: palette.textDim, fontSize: 11 },
  cheapest: { color: palette.textDim, fontSize: 11, textAlign: 'center' },
  secondary: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
  },
  secondaryText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  linksRow: { flexDirection: 'row', justifyContent: 'center', gap: 18 },
  footer: {
    padding: 16,
    paddingTop: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  ctaPressable: {
    borderRadius: 14,
    shadowColor: palette.accent,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
  },
  ctaText: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
  },
  dismiss: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  dismissText: {
    color: palette.textDim,
    fontSize: 13,
    fontWeight: '600',
  },
  legal: {
    color: palette.textDim,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
});

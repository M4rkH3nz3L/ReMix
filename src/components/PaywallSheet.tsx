import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { accentGradient, palette } from '@/constants/editor';
import {
  activateProDev,
  billingClientAvailable,
  purchasePro,
  PurchaseCancelledError,
  restorePurchases,
} from '@/lib/billing';
import { capabilityLabel, proCapabilities } from '@/lib/capabilities';
import { usePaywall } from '@/store/paywallStore';

/**
 * 🔒 Remix Pro paywall — a felhő-funkciók (AI + felhő-HD render) ajánlata.
 *
 * Egyetlen példány él a szerkesztő gyökerében; a `usePaywall` store nyitja.
 * A vásárlás VALÓS: RevenueCat IAP (App Store / Play), ha elérhető (natív build
 * + kulcs); dev-ben a szerver-hiteles /billing/activate (30 nap). A Pro-t a
 * szerver (`subscriptions`) tartja — a kliens onnan szinkronizál.
 */

/** amit a Pro NEM zár el — hangsúlyozza, hogy az alap ingyen marad */
const FREE_PERKS = ['editor', 'camera', 'export'];

export function PaywallSheet() {
  const { t } = useTranslation();
  const visible = usePaywall((s) => s.visible);
  const capability = usePaywall((s) => s.capability);
  const close = usePaywall((s) => s.close);
  const [busy, setBusy] = useState(false);

  const perks = proCapabilities();
  const trigger = capability ? capabilityLabel(capability) : null;
  const canBuy = billingClientAvailable();

  const onUpgrade = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      // 1) VALÓS IAP (RevenueCat) — natív build + kulcs esetén
      if (canBuy) {
        const ok = await purchasePro();
        if (ok) {
          close();
        }
        return;
      }
      // 2) DEV: szerver-hiteles aktiválás (30 nap) a workeren át
      if (__DEV__) {
        const ok = await activateProDev();
        if (ok) {
          close();
        }
        return;
      }
      // 3) nincs natív build / store-termék → tájékoztatás
      Alert.alert(t('paywallSheet.comingSoonTitle'), t('paywallSheet.comingSoonBody'));
    } catch (e) {
      if (e instanceof PurchaseCancelledError) {
        return; // felhasználó megszakította — nincs hibajelzés
      }
      Alert.alert(t('paywallSheet.errorTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRestore = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const ok = await restorePurchases();
      Alert.alert(
        t('paywallSheet.restoreTitle'),
        ok ? t('paywallSheet.restoreOk') : t('paywallSheet.restoreNone')
      );
      if (ok) {
        close();
      }
    } catch (e) {
      Alert.alert(t('paywallSheet.errorTitle'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={close} />
        <View style={styles.sheet}>
          <LinearGradient
            colors={[...accentGradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <View style={styles.badge}>
              <Ionicons name="sparkles" size={14} color={palette.text} />
              <Text style={styles.badgeText}>REMIX PRO</Text>
            </View>
            <Text style={styles.heroTitle}>{t('paywallSheet.heroTitle')}</Text>
            <Text style={styles.heroSub}>
              {trigger
                ? t('paywallSheet.heroSubTrigger', { trigger })
                : t('paywallSheet.heroSub')}
            </Text>
          </LinearGradient>

          <ScrollView style={styles.body} contentContainerStyle={{ gap: 14, paddingBottom: 8 }}>
            <View>
              <Text style={styles.groupTitle}>{t('paywallSheet.groupPro')}</Text>
              <View style={{ gap: 7 }}>
                {perks.map((p) => (
                  <View key={p} style={styles.row}>
                    <Ionicons name="cloud-done" size={16} color={palette.accent} />
                    <Text style={styles.rowText}>{p}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View>
              <Text style={styles.groupTitle}>{t('paywallSheet.groupFree')}</Text>
              <View style={{ gap: 7 }}>
                {FREE_PERKS.map((p) => (
                  <View key={p} style={styles.row}>
                    <Ionicons name="checkmark-circle" size={16} color={palette.textDim} />
                    <Text style={[styles.rowText, { color: palette.textDim }]}>
                      {t('paywallSheet.freePerk_' + p)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onUpgrade} disabled={busy} style={styles.ctaPressable}>
              <LinearGradient
                colors={[...accentGradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.cta}
              >
                <Ionicons name="rocket" size={16} color={palette.text} />
                <Text style={styles.ctaText}>
                  {busy
                    ? t('paywallSheet.activating')
                    : t('paywallSheet.activatePro')}
                  {!canBuy && __DEV__ ? ' (DEV)' : ''}
                </Text>
              </LinearGradient>
            </Pressable>
            {canBuy ? (
              <Pressable onPress={onRestore} disabled={busy} style={styles.dismiss}>
                <Text style={styles.dismissText}>{t('paywallSheet.restore')}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={close} disabled={busy} style={styles.dismiss}>
              <Text style={styles.dismissText}>{t('paywallSheet.notNow')}</Text>
            </Pressable>
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
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  groupTitle: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  rowText: {
    color: palette.text,
    fontSize: 13,
    flex: 1,
  },
  footer: {
    padding: 20,
    paddingTop: 12,
    gap: 10,
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
    paddingVertical: 6,
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

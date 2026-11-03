import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { cloudBaseUrl } from '@/lib/backend';
import { coinPack } from '@/lib/coins';
import { highestActiveEntitlement, storeProductId, type BillingPeriod, type StoreTier } from '@/lib/storeProducts';
import { asRecord, str } from '@/lib/parseGuards';
import { workerJsonHeaders } from '@/lib/workerAuth';
import { useAuth } from '@/store/authStore';
import { useEntitlement } from '@/store/entitlementStore';
import { logCaught } from '@/lib/logCaught';

/**
 * 💳 Billing kliens-réteg — a VALÓS Pro-aktiválás.
 *
 * A Pro szerver-hiteles (Supabase `subscriptions`); ez a modul csak elindítja a
 * fizetést és utána a szerverről FRISSÍT (`refreshEntitlement`). Két út:
 *
 *   • RevenueCat IAP (App Store / Play) — a valós pénz-út mobilon. Natív modul +
 *     dev/prod build + RevenueCat API-kulcs kell (EXPO_PUBLIC_RC_IOS_KEY /
 *     _ANDROID_KEY). Expo Go-ban / kulcs nélkül nem elérhető → a hívó a dev/
 *     manuális útra esik vissza. A vásárlást a RevenueCat webhook írja a
 *     subscriptions-be (worker /billing/revenuecat).
 *   • Dev/manuális aktiválás — a worker /billing/activate (service_role) 30 napra
 *     ír Pro-t. Teszteléshez / promóhoz; ugyanaz a subscriptions-sor.
 *
 * A RevenueCat SDK importja VÉDETT (dinamikus require + try/catch), hogy Expo
 * Go-ban (ahol nincs natív modul) ne dőljön el az app.
 */

// A RevenueCat-entitlementek neve a szint azonosítója (basic / pro / ultra); a termékek
// `remix_<szint>_<monthly|annual>` és `coins_<n>` — lásd @/lib/storeProducts és coins.ts.

let purchasesRef: any = null;
let triedRequire = false;

/** A react-native-purchases modul, vagy null (Expo Go / nincs natív modul). */
function rc(): any | null {
  if (purchasesRef || triedRequire) {
    return purchasesRef;
  }
  triedRequire = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-purchases');
    purchasesRef = mod?.default ?? mod;
  } catch (caught) {
    logCaught('lib/billing.ts:rc', caught);
    purchasesRef = null;
  }
  return purchasesRef;
}

/** A platform RevenueCat API-kulcsa env-ből, vagy null. */
function rcApiKey(): string | null {
  const key =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_RC_IOS_KEY
      : Platform.OS === 'android'
        ? process.env.EXPO_PUBLIC_RC_ANDROID_KEY
        : undefined;
  return key?.trim() || null;
}

/** Elérhető-e a valós IAP (natív modul + kulcs + nem web). */
export function billingClientAvailable(): boolean {
  return Platform.OS !== 'web' && !!rc() && !!rcApiKey();
}

let configured = false;

/**
 * RevenueCat inicializálás + a user összekötése (`logIn(userId)`), hogy a
 * webhook `app_user_id`-ja a mi user-id-nk legyen. Bejelentkezéskor hívjuk.
 * No-op, ha nincs natív modul / kulcs / web.
 */
export async function configureBilling(userId: string | null): Promise<void> {
  const Purchases = rc();
  const key = rcApiKey();
  if (!Purchases || !key || Platform.OS === 'web') {
    return;
  }
  try {
    if (!configured) {
      Purchases.configure({ apiKey: key, appUserID: userId ?? undefined });
      configured = true;
    }
    if (userId) {
      await Purchases.logIn(userId);
    } else {
      await Purchases.logOut().catch((caught: unknown) => { logCaught('lib/billing.ts:configureBilling', caught); });
    }
  } catch (caught) {
    logCaught('lib/billing.ts:configureBilling', caught);
    // best-effort; a valós vásárlás enélkül úgysem indul
  }
}

/** A bejelentkezett user szintjének újraszinkronja a szerverről (hiteles forrás). */
export async function refreshEntitlement(): Promise<void> {
  const userId = useAuth.getState().user?.id ?? null;
  await useEntitlement.getState().syncFromUser(userId);
}

/** A RevenueCat customerInfo alapján OPTIMISTA szint-beállítás (a szerver megerősíti). */
function applyCustomerInfo(customerInfo: any): void {
  const best = highestActiveEntitlement(customerInfo?.entitlements?.active);
  if (best) {
    useEntitlement.getState().setTier(best.tier, best.expirationDate);
  }
}

/** A hívó megkülönböztetheti a felhasználói megszakítást a valódi hibától. */
export class PurchaseCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'PurchaseCancelledError';
  }
}

/** Az összes offering csomagja közül az adott áruházi termékhez tartozó, vagy null. */
function findPackage(offerings: any, productId: string): any | null {
  const all = Object.values(offerings?.all ?? {}) as any[];
  for (const off of [offerings?.current, ...all]) {
    const pkg = off?.availablePackages?.find((p: any) => p?.product?.identifier === productId);
    if (pkg) {
      return pkg;
    }
  }
  return null;
}

/**
 * VALÓS áruházi előfizetés RevenueCat-tel (`remix_<szint>_<periódus>`). Siker után
 * optimista beállítás + szerver-szinkron (a hiteles sort a webhook írja). Dobás:
 * PurchaseCancelledError (megszakítás) vagy Error (elérhetetlen/egyéb).
 */
export async function purchaseTier(tier: StoreTier, period: BillingPeriod = 'monthly'): Promise<boolean> {
  const Purchases = rc();
  if (!Purchases || !rcApiKey()) {
    throw new Error(tr('lib.billing.iapUnavailable'));
  }
  await configureBilling(useAuth.getState().user?.id ?? null);
  const pkg = findPackage(await Purchases.getOfferings(), storeProductId(tier, period));
  if (!pkg) {
    throw new Error(tr('lib.billing.noOffer'));
  }
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    applyCustomerInfo(customerInfo);
  } catch (e) {
    if ((e as { userCancelled?: boolean })?.userCancelled) {
      throw new PurchaseCancelledError();
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
  await refreshEntitlement();
  return useEntitlement.getState().effectiveTier() !== 'free';
}

/** A Haladó (pro) havi előfizetés — a régi hívók rövidítése. */
export function purchasePro(): Promise<boolean> {
  return purchaseTier('pro', 'monthly');
}

/**
 * Coin-csomag vásárlása az áruházban (consumable, `coins_<n>`). A jóváírást a RevenueCat
 * webhook végzi (vásárolt + bónusz alegyenleg); a hívó utána frissíti a pénztárcát.
 */
export async function purchaseCoinPack(packId: string): Promise<void> {
  const Purchases = rc();
  if (!Purchases || !rcApiKey() || !coinPack(packId)) {
    throw new Error(tr('lib.billing.iapUnavailable'));
  }
  await configureBilling(useAuth.getState().user?.id ?? null);
  const category = Purchases.PRODUCT_CATEGORY?.NON_SUBSCRIPTION;
  const products = await Purchases.getProducts([packId], category);
  const product = products?.[0];
  if (!product) {
    throw new Error(tr('lib.billing.noOffer'));
  }
  try {
    await Purchases.purchaseStoreProduct(product);
  } catch (e) {
    if ((e as { userCancelled?: boolean })?.userCancelled) {
      throw new PurchaseCancelledError();
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Korábbi vásárlások visszaállítása (App Store / Play). */
export async function restorePurchases(): Promise<boolean> {
  const Purchases = rc();
  if (!Purchases || !rcApiKey()) {
    throw new Error(tr('lib.billing.iapUnavailable'));
  }
  await configureBilling(useAuth.getState().user?.id ?? null);
  const customerInfo = await Purchases.restorePurchases();
  applyCustomerInfo(customerInfo);
  await refreshEntitlement();
  return useEntitlement.getState().isPro();
}

/**
 * DEV/manuális aktiválás a worker /billing/activate-en (service_role, 30 nap).
 * A valós IAP hiányában (Expo Go / nincs kulcs) ezzel tesztelhető a szerver-
 * hiteles Pro. Optimista beállítás + szerver-szinkron.
 */
export async function activateProDev(days = 30): Promise<boolean> {
  const userId = useAuth.getState().user?.id;
  if (!userId) {
    throw new Error(tr('lib.billing.noUser'));
  }
  // 🧪 Kliens-oldali dev-override ELŐSZÖR: így WEBEN is működik, ahol a kliens a
  // hosztolt prod Supabase-t nézi, a dev-worker viszont a lokálisba ír (a prod
  // subscriptions-t nem látná) — és túléli a `syncFromUser`-t.
  useEntitlement.getState().setDevPro(true);
  // A szerver-hiteles út best-effort: natívon (kliens+worker azonos Supabase) ez
  // valódi subscriptions-sort ír; ha a worker elérhetetlen, a dev-override akkor is áll.
  try {
    const res = await fetch(`${cloudBaseUrl()}/billing/activate`, {
      method: 'POST',
      headers: await workerJsonHeaders(),
      body: JSON.stringify({ userId, days }),
    });
    if (res.ok) {
      const data = asRecord(await res.json());
      useEntitlement.getState().setTier('pro', str(data?.proUntil));
    }
  } catch (caught) {
    logCaught('lib/billing.ts:activateProDev', caught);
    // a worker nem elérhető — a dev-override marad az aktív Pro-forrás
  }
  return useEntitlement.getState().isPro();
}

/** DEV/manuális visszavonás: a kliens-override KI + a worker /billing/deactivate (best-effort). */
export async function deactivateProDev(): Promise<void> {
  const userId = useAuth.getState().user?.id;
  // előbb a dev-override le, hogy weben is azonnal Free legyen
  useEntitlement.getState().setDevPro(false);
  useEntitlement.getState().setTier('free');
  if (!userId) {
    return;
  }
  await fetch(`${cloudBaseUrl()}/billing/deactivate`, {
    method: 'POST',
    headers: await workerJsonHeaders(),
    body: JSON.stringify({ userId }),
  }).catch((caught) => { logCaught('lib/billing.ts:deactivateProDev', caught); });
}

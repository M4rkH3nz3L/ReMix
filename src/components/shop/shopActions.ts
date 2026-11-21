import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { MIN_SHOP_PRICE_CENTS, coinsToCents, formatCoins, moneyErrorText } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';
import { visibleProjects } from '@/lib/projectKinds';
import {
  getPayload,
  InsufficientCreditsError,
  importPayloadAsProject,
  publishProjectAsItem,
  publishSoundPack,
  purchaseItem,
  storeSoundPack,
  unpublishItem,
  type ShopItem,
} from '@/lib/shop';
import { isBelowShopMinimum } from '@/lib/shopScreenOps';
import { listProjects, loadProject } from '@/lib/storage';
import { requireApp, requireSignIn } from '@/lib/webGate';
import type { ProjectMeta } from '@/types/project';

/**
 * A bolt-képernyő hook nélküli akció-gyára (REFACTOR: a src/app/shop.tsx-ből): megnyitás a
 * szerkesztőben, vásárlás, megvett tétel használata, publikálás, visszavonás. A pénzmozgató
 * hívások argumentumai, a busy-őr és a logCaught-címkék (az eredeti fájl ujjlenyomatai)
 * változatlanok.
 */
export interface ShopActionDeps {
  t: TFunction;
  busy: boolean;
  pubProjectId: string | null;
  pubTitle: string;
  pubPrice: string;
  pubKind: 'template' | 'soundpack';
  load: () => void;
  refreshBalance: () => void;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setMyProjects: Dispatch<SetStateAction<ProjectMeta[]>>;
  setPubProjectId: Dispatch<SetStateAction<string | null>>;
  setPubTitle: Dispatch<SetStateAction<string>>;
  setPublishOpen: Dispatch<SetStateAction<boolean>>;
}

export function createShopActions({
  t,
  busy,
  pubProjectId,
  pubTitle,
  pubPrice,
  pubKind,
  load,
  refreshBalance,
  setBusy,
  setMyProjects,
  setPubProjectId,
  setPubTitle,
  setPublishOpen,
}: ShopActionDeps) {
  const openInEditor = (payload: unknown, itemId?: string) => {
    // 🌐 weben nincs szerkesztő → a megvett tétel az appban használható
    if (!requireApp()) {
      return;
    }
    // 🛍️ V4: a hangcsomag a telefon loop-könyvtárába kerül (Hang Stúdió → Loopok), nem új projekt
    if (itemId && storeSoundPack(itemId, payload)) {
      Alert.alert(t('shop.title'), t('shop.soundPackStored'));
      return;
    }
    importPayloadAsProject(payload, itemId)
      .then((pid) => {
        if (pid) {
          router.replace(`/editor/${pid}`);
        } else {
          Alert.alert(t('shop.title'), t('shop.useUnsupported'));
        }
      })
      .catch((e: unknown) =>
        { logCaught('app/shop.tsx:openInEditor', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); }
      );
  };

  const onBuy = (item: ShopItem) => {
    if (busy || !requireSignIn()) {
      return;
    }
    setBusy(true);
    purchaseItem(item.id)
      .then((payload) => {
        refreshBalance();
        Alert.alert(t('shop.boughtTitle'), t('shop.boughtBody', { title: item.title }), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('shop.useInProject'), onPress: () => openInEditor(payload, item.id) },
        ]);
      })
      .catch((e: unknown) => {
      logCaught('app/shop.tsx:onBuy', e);
        if (e instanceof InsufficientCreditsError) {
          Alert.alert(t('shop.needCreditsTitle'), t('shop.needCreditsBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('shop.buyCredits'), onPress: () => router.push('/profile') },
          ]);
        } else {
          Alert.alert(t('common.error'), moneyErrorText(t, e));
        }
      })
      .finally(() => setBusy(false));
  };

  const onUseOwned = (item: ShopItem) => {
    if (busy) {
      return;
    }
    setBusy(true);
    getPayload(item.id)
      .then((payload) => {
        if (payload) {
          openInEditor(payload, item.id);
        }
      })
      .catch((caught) => { logCaught('app/shop.tsx:onUseOwned', caught); })
      .finally(() => setBusy(false));
  };

  const openPublish = () => {
    listProjects()
      .then((all) => {
        const ps = visibleProjects(all);
        setMyProjects(ps);
        setPubProjectId(ps[0]?.id ?? null);
        setPubTitle(ps[0]?.name ?? '');
        setPublishOpen(true);
      })
      .catch((caught) => { logCaught('app/shop.tsx:openPublish', caught); });
  };

  const doPublish = () => {
    if (!pubProjectId || !pubTitle.trim() || busy) {
      return;
    }
    const priceCents = coinsToCents(pubPrice);
    if (isBelowShopMinimum(priceCents)) {
      Alert.alert(t('shop.title'), t('shop.priceMin', { min: formatCoins(MIN_SHOP_PRICE_CENTS) }));
      return;
    }
    setBusy(true);
    loadProject(pubProjectId)
      .then((p) => {
        if (!p) {
          throw new Error(t('shop.publishNoProject'));
        }
        if (pubKind === 'soundpack') {
          return publishSoundPack(p, { title: pubTitle.trim(), priceCents });
        }
        return publishProjectAsItem(p, {
          title: pubTitle.trim(),
          priceCents,
          kind: 'template',
        });
      })
      .then((item) => {
        if (!item) {
          Alert.alert(t('shop.title'), t('shop.soundPackEmpty'));
          return;
        }
        setPublishOpen(false);
        Alert.alert(t('shop.title'), t('shop.publishedOk'));
        load();
      })
      .catch((e: unknown) =>
        { logCaught('app/shop.tsx:doPublish', e); return Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e)); }
      )
      .finally(() => setBusy(false));
  };

  const confirmUnpublish = (item: ShopItem) => {
    Alert.alert(item.title, t('shop.unpublishConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('shop.unpublish'),
        style: 'destructive',
        onPress: () => unpublishItem(item.id).then(load).catch((caught) => { logCaught('app/shop.tsx:confirmUnpublish', caught); }),
      },
    ]);
  };

  return { onBuy, onUseOwned, openPublish, doPublish, confirmUnpublish };
}

import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { formatCoins } from '@/lib/coins';
import {
  type ConnectedProvider,
  type ExternalProviderType,
  type OAuthProviderType,
  connectManualProvider,
  connectOAuthProvider,
  disconnectProvider,
  listProviderFiles,
  setDefaultStorage,
} from '@/lib/externalStorage';
import { logCaught } from '@/lib/logCaught';
import { InsufficientCreditsError } from '@/lib/shop';
import type { StorageEntry } from '@/lib/storageProviders';
import { AddonNotAllowedError, addAddon } from '@/lib/wallet';

/** a tárhely-akciók bemenete: a render-kori állapot + a setterek (a StorageCard gyökeréből) */
export interface StorageActionDeps {
  t: TFunction;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setBalance: (v: number) => void;
  refresh: () => void;
  boostBlocks: number;
  cost: number;
  manualType: 'webdav' | 's3' | null;
  setManualType: (v: 'webdav' | 's3' | null) => void;
  manualLabel: string;
  setManualLabel: (v: string) => void;
  manualCfg: Record<string, string>;
  setManualCfg: Dispatch<SetStateAction<Record<string, string>>>;
  expanded: string | null;
  setExpanded: (v: string | null) => void;
  setFiles: (v: StorageEntry[] | null) => void;
}

/**
 * 🗄️ A tárhely-kártya hook nélküli akciói (a StorageCard.tsx-ből kiemelve, szó szerint):
 * bővítés vásárlása, OAuth/manuális bekötés, leválasztás, aktív cél, fájl-lista.
 */
export function createStorageActions(d: StorageActionDeps) {
  const { t, busy, setBusy, setBalance, refresh, boostBlocks, cost } = d;
  const { manualType, setManualType, manualLabel, setManualLabel, manualCfg, setManualCfg } = d;
  const { expanded, setExpanded, setFiles } = d;

  const onBuy = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const res = await addAddon('storage_10gb', boostBlocks);
      setBalance(res.balance);
      refresh();
      Alert.alert(
        t('profile.storage.boostDoneTitle'),
        t('profile.storage.addonDoneMsg', { gb: boostBlocks * 10, paid: formatCoins(res.cost), monthly: formatCoins(cost) })
      );
    } catch (e) {
      logCaught('components/profile/StorageCard.tsx:onBuy', e);
      if (e instanceof InsufficientCreditsError) {
        Alert.alert(t('profile.storage.notEnoughTitle'), t('profile.storage.notEnoughMsg'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('profile.storage.goToShop'), onPress: () => router.push('/shop') },
        ]);
      } else if (e instanceof AddonNotAllowedError) {
        Alert.alert(t('common.error'), t(`wallet.sub.addonError.${e.message}`, { defaultValue: e.message }));
      } else {
        Alert.alert(t('common.error'), (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  const onConnectOAuth = async (provider: OAuthProviderType) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const ok = await connectOAuthProvider(provider);
      if (ok) {
        await refresh();
      }
    } catch (e) {
      logCaught('components/profile/StorageCard.tsx:onConnectOAuth', e);
      Alert.alert(t('profile.storage.connectFailedTitle'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onConnectManual = async () => {
    if (!manualType || busy) {
      return;
    }
    setBusy(true);
    try {
      await connectManualProvider(manualType, manualLabel || manualType, manualCfg);
      setManualType(null);
      setManualLabel('');
      setManualCfg({});
      await refresh();
    } catch (e) {
      logCaught('components/profile/StorageCard.tsx:onConnectManual', e);
      Alert.alert(t('profile.storage.connectFailedTitle'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = (p: ConnectedProvider) => {
    Alert.alert(t('profile.storage.disconnectTitle'), t('profile.storage.disconnectMsg', { label: p.label }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.storage.disconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            await disconnectProvider(p.id);
            await refresh();
          } catch (e) {
            logCaught('components/profile/StorageCard.tsx:onDisconnect', e);
            Alert.alert(t('common.error'), (e as Error).message);
          }
        },
      },
    ]);
  };

  const onSelectTarget = async (sourceId: string | null) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await setDefaultStorage(sourceId);
      // a mentés-kori backup-döntés cache-elt cél-ellenőrzése frissüljön azonnal
      const { invalidateOwnStorageTargetCache } = await import('@/lib/externalStorage');
      invalidateOwnStorageTargetCache();
      await refresh();
    } catch (e) {
      logCaught('components/profile/StorageCard.tsx:onSelectTarget', e);
      Alert.alert(t('common.error'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onToggleFiles = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      setFiles(null);
      return;
    }
    setExpanded(id);
    setFiles(null);
    try {
      setFiles(await listProviderFiles(id));
    } catch (caught) {
      logCaught('components/profile/StorageCard.tsx:onToggleFiles', caught);
      setFiles([]);
    }
  };

  const startConnect = (type: ExternalProviderType, oauth: boolean) => {
    if (oauth) {
      onConnectOAuth(type as OAuthProviderType);
    } else {
      setManualType(type as 'webdav' | 's3');
      setManualLabel('');
      setManualCfg({});
    }
  };

  return { onBuy, onConnectOAuth, onConnectManual, onDisconnect, onSelectTarget, onToggleFiles, startConnect };
}

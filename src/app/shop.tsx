import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { requireSignIn } from '@/lib/webGate';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { PublishSheet } from '@/components/shop/PublishSheet';
import { BrowseCard, ListingCard, PurchaseCard } from '@/components/shop/ShopCards';
import { createShopActions } from '@/components/shop/shopActions';
import { styles } from '@/components/shop/shopStyles';
import { palette } from '@/constants/editor';
import {
  creditBalance,
  listShopItems,
  myListings,
  myPurchases,
  SHOP_KINDS,
  type PurchasedItem,
  type ShopItem,
  type ShopKind,
} from '@/lib/shop';
import { createInFlightLock } from '@/lib/asyncGuard';
import { KIND_EMOJI } from '@/lib/shopScreenOps';
import type { ProjectMeta } from '@/types/project';
import { formatCoins } from '@/lib/coins';
import { logCaught } from '@/lib/logCaught';


type Tab = 'browse' | 'purchases' | 'sell';

/**
 * 🛍️ A bolt-képernyő: a gyökér az állapotot (eredeti hook-sorrendben), a betöltést, a
 * fül-váltást és a kompozíciót tartja; az akciók a shop/shopActions.ts-ben, a kártyák és a
 * publikálás modal a src/components/shop/ alatt.
 */
export default function ShopScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('browse');
  const [balance, setBalance] = useState(0);
  const [kind, setKind] = useState<ShopKind | null>(null);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [purchases, setPurchases] = useState<PurchasedItem[]>([]);
  const [listings, setListings] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  // ⚠️ hiba ≠ üres: enélkül a hálózati hiba „üres boltként" jelent meg,
  // és a felhasználónak esélye sem volt újrapróbálni
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  // 🔒 szinkron zár a dupla koppintás ellen (a `busy` render-kori, két koppintás egy renderben átcsúszna)
  const [inFlight] = useState(createInFlightLock);

  const [publishOpen, setPublishOpen] = useState(false);
  const [myProjects, setMyProjects] = useState<ProjectMeta[]>([]);
  const [pubProjectId, setPubProjectId] = useState<string | null>(null);
  const [pubTitle, setPubTitle] = useState('');
  const [pubPrice, setPubPrice] = useState('0,40');
  // 🛍️ V4: sablon (a projekt) vagy hangcsomag (a projekt dob- és szinti-mintái)
  const [pubKind, setPubKind] = useState<'template' | 'soundpack'>('template');

  const refreshBalance = useCallback(() => {
    creditBalance().then(setBalance).catch((caught) => { logCaught('app/shop.tsx:refreshBalance', caught); });
  }, []);

  const load = useCallback(() => {
    refreshBalance();
    if (tab === 'browse') {
      listShopItems({ kind: kind ?? undefined, sort: 'new' })
        .then((rows) => {
          setItems(rows);
          setLoadError(false);
        })
        .catch((caught) => { logCaught('app/shop.tsx:load', caught); return setLoadError(true); })
        .finally(() => setLoading(false));
    } else if (tab === 'purchases') {
      myPurchases()
        .then((rows) => {
          setPurchases(rows);
          setLoadError(false);
        })
        .catch((caught) => { logCaught('app/shop.tsx:load', caught); return setLoadError(true); })
        .finally(() => setLoading(false));
    } else {
      myListings()
        .then((rows) => {
          setListings(rows);
          setLoadError(false);
        })
        .catch((caught) => { logCaught('app/shop.tsx:load', caught); return setLoadError(true); })
        .finally(() => setLoading(false));
    }
  }, [tab, kind, refreshBalance]);

  useEffect(() => {
    load();
  }, [load]);

  // tab/típus váltás → spinner (eseménykezelőben a setState engedélyezett)
  const changeTab = (next: Tab) => {
    // a vásárlásaim/eladás személyes → kijelentkezve bejelentkezést kér
    if (next !== 'browse' && !requireSignIn()) {
      return;
    }
    setLoading(true);
    setTab(next);
  };
  const changeKind = (next: ShopKind | null) => {
    setLoading(true);
    setKind(next);
  };

  const { onBuy, onUseOwned, openPublish, doPublish, confirmUnpublish } = createShopActions({
    t,
    busy,
    inFlight,
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
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => goBackOrHome()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('shop.title')}
        </Text>
        {/* egyenleg → a pénztárca (profil): koin-vétel/küldés/kiváltás + dev-adás */}
        <Pressable onPress={() => router.push('/profile')} hitSlop={8} style={styles.balancePill}>
          <Text style={styles.balanceText}>{formatCoins(balance)} 🪙</Text>
          <Ionicons name="wallet-outline" size={16} color={palette.accent} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <Chip label={t('shop.tabBrowse')} active={tab === 'browse'} onPress={() => changeTab('browse')} />
        <Chip label={t('shop.tabPurchases')} active={tab === 'purchases'} onPress={() => changeTab('purchases')} />
        <Chip label={t('shop.tabSell')} active={tab === 'sell'} onPress={() => changeTab('sell')} />
      </View>

      {tab === 'browse' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kindRow}
        >
          <Chip label={t('shop.allKinds')} active={kind === null} onPress={() => changeKind(null)} />
          {SHOP_KINDS.map((k) => (
            <Chip
              key={k}
              label={`${KIND_EMOJI[k]} ${t(`shop.kind.${k}`)}`}
              active={kind === k}
              onPress={() => changeKind(k)}
            />
          ))}
        </ScrollView>
      ) : null}

      {tab === 'sell' ? (
        <View style={styles.sellCta}>
          <PrimaryButton label={t('shop.publishCta')} icon="cloud-upload-outline" onPress={openPublish} />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : loadError ? (
        // ⚠️ hiba ≠ üres: a felhasználó lássa, hogy baj volt, és tudjon újrapróbálni
        <View style={styles.loadingBox}>
          <Text style={styles.empty}>{t('shop.loadFailed')}</Text>
          <PrimaryButton
            label={t('common.retry')}
            icon="refresh-outline"
            onPress={() => {
              setLoading(true);
              load();
            }}
          />
        </View>
      ) : tab === 'browse' ? (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <BrowseCard t={t} item={item} busy={busy} onBuy={onBuy} />}
          ListEmptyComponent={<Text style={styles.empty}>{t('shop.emptyBrowse')}</Text>}
        />
      ) : tab === 'purchases' ? (
        <FlatList
          data={purchases}
          keyExtractor={(p) => p.item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <PurchaseCard t={t} p={item} busy={busy} onUseOwned={onUseOwned} />}
          ListEmptyComponent={<Text style={styles.empty}>{t('shop.emptyPurchases')}</Text>}
        />
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ListingCard t={t} item={item} confirmUnpublish={confirmUnpublish} />}
          ListEmptyComponent={<Text style={styles.empty}>{t('shop.emptyListings')}</Text>}
        />
      )}

      {/* — publikálás modal — */}
      <PublishSheet
        t={t}
        publishOpen={publishOpen}
        setPublishOpen={setPublishOpen}
        pubKind={pubKind}
        setPubKind={setPubKind}
        myProjects={myProjects}
        pubProjectId={pubProjectId}
        setPubProjectId={setPubProjectId}
        pubTitle={pubTitle}
        setPubTitle={setPubTitle}
        pubPrice={pubPrice}
        setPubPrice={setPubPrice}
        busy={busy}
        doPublish={doPublish}
      />
    </SafeAreaView>
  );
}

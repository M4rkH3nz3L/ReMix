import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Chip, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  buyCreditsDev,
  creditBalance,
  getPayload,
  InsufficientCreditsError,
  listShopItems,
  myListings,
  myPurchases,
  importPayloadAsProject,
  publishProjectAsItem,
  purchaseItem,
  SHOP_KINDS,
  unpublishItem,
  type PurchasedItem,
  type ShopItem,
  type ShopKind,
} from '@/lib/shop';
import { listProjects, loadProject } from '@/lib/storage';
import type { ProjectMeta } from '@/types/project';

const KIND_EMOJI: Record<ShopKind, string> = {
  template: '🎬',
  overlay: '🖼️',
  lut: '🎨',
  sfx: '🔊',
  sticker: '✨',
  font: '🔤',
  preset: '🎛️',
};

const CREDIT_PACKS = [100, 500, 1200];

type Tab = 'browse' | 'purchases' | 'sell';

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

  const [creditsOpen, setCreditsOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [myProjects, setMyProjects] = useState<ProjectMeta[]>([]);
  const [pubProjectId, setPubProjectId] = useState<string | null>(null);
  const [pubTitle, setPubTitle] = useState('');
  const [pubPrice, setPubPrice] = useState('50');

  const refreshBalance = useCallback(() => {
    creditBalance().then(setBalance).catch(() => {});
  }, []);

  const load = useCallback(() => {
    refreshBalance();
    if (tab === 'browse') {
      listShopItems({ kind: kind ?? undefined, sort: 'new' })
        .then((rows) => {
          setItems(rows);
          setLoadError(false);
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    } else if (tab === 'purchases') {
      myPurchases()
        .then((rows) => {
          setPurchases(rows);
          setLoadError(false);
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    } else {
      myListings()
        .then((rows) => {
          setListings(rows);
          setLoadError(false);
        })
        .catch(() => setLoadError(true))
        .finally(() => setLoading(false));
    }
  }, [tab, kind, refreshBalance]);

  useEffect(() => {
    load();
  }, [load]);

  // tab/típus váltás → spinner (eseménykezelőben a setState engedélyezett)
  const changeTab = (next: Tab) => {
    setLoading(true);
    setTab(next);
  };
  const changeKind = (next: ShopKind | null) => {
    setLoading(true);
    setKind(next);
  };

  const openInEditor = (payload: unknown) => {
    importPayloadAsProject(payload)
      .then((pid) => {
        if (pid) {
          router.replace(`/editor/${pid}`);
        } else {
          Alert.alert(t('shop.title'), t('shop.useUnsupported'));
        }
      })
      .catch((e: unknown) =>
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
      );
  };

  const onBuy = (item: ShopItem) => {
    if (busy) {
      return;
    }
    setBusy(true);
    purchaseItem(item.id)
      .then((payload) => {
        refreshBalance();
        Alert.alert(t('shop.boughtTitle'), t('shop.boughtBody', { title: item.title }), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('shop.useInProject'), onPress: () => openInEditor(payload) },
        ]);
      })
      .catch((e: unknown) => {
        if (e instanceof InsufficientCreditsError) {
          Alert.alert(t('shop.needCreditsTitle'), t('shop.needCreditsBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('shop.buyCredits'), onPress: () => setCreditsOpen(true) },
          ]);
        } else {
          Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
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
          openInEditor(payload);
        }
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  const onTopUp = (amount: number) => {
    setBusy(true);
    buyCreditsDev(amount)
      .then((b) => {
        setBalance(b);
        setCreditsOpen(false);
      })
      .catch((e: unknown) =>
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
      )
      .finally(() => setBusy(false));
  };

  const openPublish = () => {
    listProjects()
      .then((ps) => {
        setMyProjects(ps);
        setPubProjectId(ps[0]?.id ?? null);
        setPubTitle(ps[0]?.name ?? '');
        setPublishOpen(true);
      })
      .catch(() => {});
  };

  const doPublish = () => {
    if (!pubProjectId || !pubTitle.trim() || busy) {
      return;
    }
    setBusy(true);
    loadProject(pubProjectId)
      .then((p) => {
        if (!p) {
          throw new Error(t('shop.publishNoProject'));
        }
        return publishProjectAsItem(p, {
          title: pubTitle.trim(),
          priceCredits: Math.max(0, parseInt(pubPrice, 10) || 0),
          kind: 'template',
        });
      })
      .then(() => {
        setPublishOpen(false);
        Alert.alert(t('shop.title'), t('shop.publishedOk'));
        load();
      })
      .catch((e: unknown) =>
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
      )
      .finally(() => setBusy(false));
  };

  const confirmUnpublish = (item: ShopItem) => {
    Alert.alert(item.title, t('shop.unpublishConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('shop.unpublish'),
        style: 'destructive',
        onPress: () => unpublishItem(item.id).then(load).catch(() => {}),
      },
    ]);
  };

  const priceLabel = (n: number) => (n > 0 ? `${n} 🪙` : t('shop.free'));

  const browseCard = (item: ShopItem) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardEmoji}>{KIND_EMOJI[item.kind] ?? '🎬'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {item.sellerName ?? t('shop.creator')} · ⬇ {item.downloads}
          </Text>
        </View>
        <Text style={styles.cardPrice}>{priceLabel(item.priceCredits)}</Text>
      </View>
      {item.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
      <PrimaryButton
        label={item.priceCredits > 0 ? t('shop.buyFor', { price: item.priceCredits }) : t('shop.getFree')}
        icon="cart-outline"
        onPress={() => onBuy(item)}
        disabled={busy}
      />
    </View>
  );

  const purchaseCard = (p: PurchasedItem) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardEmoji}>{KIND_EMOJI[p.item.kind] ?? '🎬'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {p.item.title}
          </Text>
          <Text style={styles.cardMeta}>{t('shop.owned')}</Text>
        </View>
      </View>
      <PrimaryButton
        label={t('shop.useInProject')}
        icon="create-outline"
        onPress={() => onUseOwned(p.item)}
        disabled={busy}
      />
    </View>
  );

  const listingCard = (item: ShopItem) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardEmoji}>{KIND_EMOJI[item.kind] ?? '🎬'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.cardMeta}>
            {priceLabel(item.priceCredits)} · ⬇ {item.downloads} ·{' '}
            {item.status === 'published' ? t('shop.live') : t('shop.removed')}
          </Text>
        </View>
        {item.status === 'published' ? (
          <Pressable onPress={() => confirmUnpublish(item)} hitSlop={8}>
            <Ionicons name="trash-outline" size={20} color={palette.danger} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={palette.text} />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('shop.title')}
        </Text>
        <Pressable onPress={() => setCreditsOpen(true)} hitSlop={8} style={styles.balancePill}>
          <Text style={styles.balanceText}>{balance} 🪙</Text>
          <Ionicons name="add-circle" size={16} color={palette.accent} />
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
          renderItem={({ item }) => browseCard(item)}
          ListEmptyComponent={<Text style={styles.empty}>{t('shop.emptyBrowse')}</Text>}
        />
      ) : tab === 'purchases' ? (
        <FlatList
          data={purchases}
          keyExtractor={(p) => p.item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => purchaseCard(item)}
          ListEmptyComponent={<Text style={styles.empty}>{t('shop.emptyPurchases')}</Text>}
        />
      ) : (
        <FlatList
          data={listings}
          keyExtractor={(i) => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => listingCard(item)}
          ListEmptyComponent={<Text style={styles.empty}>{t('shop.emptyListings')}</Text>}
        />
      )}

      {/* — kredit-vásárlás modal — */}
      <Modal visible={creditsOpen} transparent animationType="slide" onRequestClose={() => setCreditsOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropTap} onPress={() => setCreditsOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('shop.buyCredits')}</Text>
            <Text style={styles.sheetHint}>{t('shop.creditsHint')}</Text>
            <View style={styles.packRow}>
              {CREDIT_PACKS.map((amt) => (
                <Pressable
                  key={amt}
                  style={styles.pack}
                  disabled={busy}
                  onPress={() => onTopUp(amt)}
                >
                  <Text style={styles.packAmount}>{amt} 🪙</Text>
                  <Text style={styles.packDev}>{t('shop.devGrant')}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={() => setCreditsOpen(false)} style={styles.dismiss}>
              <Text style={styles.dismissText}>{t('paywallSheet.notNow')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* — publikálás modal — */}
      <Modal visible={publishOpen} transparent animationType="slide" onRequestClose={() => setPublishOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={styles.backdropTap} onPress={() => setPublishOpen(false)} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{t('shop.publishCta')}</Text>
            <Text style={styles.sheetHint}>{t('shop.publishHint')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kindRow}>
              {myProjects.map((p) => (
                <Chip
                  key={p.id}
                  label={p.name}
                  active={pubProjectId === p.id}
                  onPress={() => {
                    setPubProjectId(p.id);
                    setPubTitle(p.name);
                  }}
                />
              ))}
            </ScrollView>
            <Text style={styles.fieldLabel}>{t('shop.titleLabel')}</Text>
            <TextInput
              style={styles.input}
              value={pubTitle}
              onChangeText={setPubTitle}
              placeholder={t('shop.titleLabel')}
              placeholderTextColor={palette.textDim}
            />
            <Text style={styles.fieldLabel}>{t('shop.priceLabel')}</Text>
            <TextInput
              style={styles.input}
              value={pubPrice}
              onChangeText={setPubPrice}
              keyboardType="number-pad"
              placeholder="50"
              placeholderTextColor={palette.textDim}
            />
            <View style={{ marginTop: 12 }}>
              <PrimaryButton
                label={t('shop.publishNow')}
                icon="pricetag-outline"
                onPress={doPublish}
                disabled={busy || !pubProjectId || !pubTitle.trim()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 72 },
  backText: { color: palette.text, fontSize: 16 },
  headerTitle: { flex: 1, textAlign: 'center', color: palette.text, fontSize: 17, fontWeight: '800' },
  balancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  balanceText: { color: palette.text, fontSize: 14, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  kindRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 10 },
  sellCta: { paddingHorizontal: 16, paddingBottom: 10 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  list: { padding: 16, gap: 12, paddingBottom: 40 },
  empty: { color: palette.textDim, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardEmoji: { fontSize: 28 },
  cardTitle: { color: palette.text, fontSize: 15, fontWeight: '700' },
  cardMeta: { color: palette.textDim, fontSize: 12 },
  cardPrice: { color: palette.accent, fontSize: 15, fontWeight: '800' },
  cardDesc: { color: palette.textDim, fontSize: 13, lineHeight: 18 },
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  backdropTap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    gap: 10,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  sheetTitle: { color: palette.text, fontSize: 18, fontWeight: '800' },
  sheetHint: { color: palette.textDim, fontSize: 13, lineHeight: 18 },
  packRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  pack: {
    flex: 1,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  packAmount: { color: palette.text, fontSize: 16, fontWeight: '800' },
  packDev: { color: palette.textDim, fontSize: 10 },
  dismiss: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  dismissText: { color: palette.textDim, fontSize: 15, fontWeight: '600' },
  fieldLabel: { color: palette.textDim, fontSize: 12, fontWeight: '700', marginTop: 6 },
  input: {
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 15,
  },
});

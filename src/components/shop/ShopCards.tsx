import { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import { Pressable, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/ui/controls';
import { styles } from '@/components/shop/shopStyles';
import { palette } from '@/constants/editor';
import { formatCoins } from '@/lib/coins';
import type { PurchasedItem, ShopItem } from '@/lib/shop';
import { kindEmoji } from '@/lib/shopScreenOps';

/** 🛍️ A bolt listáinak kártyái (REFACTOR: a src/app/shop.tsx browse/purchase/listingCard-ja). */

const priceLabel = (t: TFunction, cents: number) => (cents > 0 ? `${formatCoins(cents)} 🪙` : t('shop.free'));

/** böngészés: ár + vásárlás / ingyenes letöltés */
export function BrowseCard({
  t,
  item,
  busy,
  onBuy,
}: {
  t: TFunction;
  item: ShopItem;
  busy: boolean;
  onBuy: (item: ShopItem) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardEmoji}>{kindEmoji(item.kind)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.cardMeta} numberOfLines={1}>
            {item.sellerName ?? t('shop.creator')} · ⬇ {item.downloads}
          </Text>
        </View>
        <Text style={styles.cardPrice}>{priceLabel(t, item.priceCents)}</Text>
      </View>
      {item.description ? (
        <Text style={styles.cardDesc} numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
      <PrimaryButton
        label={item.priceCents > 0 ? t('shop.buyFor', { price: formatCoins(item.priceCents) }) : t('shop.getFree')}
        icon="cart-outline"
        onPress={() => onBuy(item)}
        disabled={busy}
      />
    </View>
  );
}

/** vásárlásaim: a megvett tétel használata */
export function PurchaseCard({
  t,
  p,
  busy,
  onUseOwned,
}: {
  t: TFunction;
  p: PurchasedItem;
  busy: boolean;
  onUseOwned: (item: ShopItem) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardEmoji}>{kindEmoji(p.item.kind)}</Text>
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
}

/** eladás: saját hirdetés állapota + visszavonás */
export function ListingCard({
  t,
  item,
  confirmUnpublish,
}: {
  t: TFunction;
  item: ShopItem;
  confirmUnpublish: (item: ShopItem) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardEmoji}>{kindEmoji(item.kind)}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.cardMeta}>
            {priceLabel(t, item.priceCents)} · ⬇ {item.downloads} ·{' '}
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
}

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CreatorBadges, TagBadges } from '@/components/profile/CreatorControls';
import { COVER_ASPECT, palette } from '@/constants/editor';
import { compact } from '@/lib/channelScreen';
import type { ChannelData } from '@/lib/feed';
import type { LiveSession } from '@/lib/live';
import type { CreatorTotals } from '@/lib/promotion';

/**
 * A csatorna profil-feje a poszt-rács fölött (REFACTOR: a src/app/channel/[id].tsx
 * ListHeaderComponent-je): borító, avatar, név, LIVE-jelző, creator-badge-ek, bio,
 * statisztika, saját gombsor VAGY követés/üzenet/ajándék, skillek.
 */
export function ChannelProfileHeader({
  data,
  username,
  displayName,
  liveSession,
  followers,
  totals,
  following,
  onFollow,
  onMessage,
  onGift,
}: {
  data: ChannelData | null;
  username: string;
  displayName: string;
  liveSession: LiveSession | null;
  followers: number;
  totals: CreatorTotals | null;
  following: boolean;
  onFollow: () => void;
  onMessage: () => void;
  onGift: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.profileHead}>
      {data?.coverUri ? (
        <Image source={{ uri: data.coverUri }} style={styles.cover} contentFit="cover" />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]} />
      )}
      <View style={styles.bigAvatar}>
        {data?.creator?.avatarUri ? (
          <Image
            source={{ uri: data.creator.avatarUri }}
            style={styles.bigAvatarImg}
            contentFit="cover"
          />
        ) : (
          <Text style={styles.bigAvatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
        )}
      </View>
      <Text style={styles.displayName}>{displayName}</Text>
      <Text style={styles.handle}>@{username}</Text>
      {liveSession ? (
        <Pressable style={styles.liveBanner} onPress={() => router.push(`/live/${liveSession.id}`)}>
          <View style={styles.liveBannerDot} />
          <Ionicons name="radio" size={15} color="#fff" />
          <Text style={styles.liveBannerText} numberOfLines={1}>
            {t('channel.liveNow', { defaultValue: 'LIVE now — tap to watch' })}
          </Text>
        </Pressable>
      ) : null}
      {data?.creatorTypes?.length ? (
        <View style={styles.creatorBadges}>
          <CreatorBadges types={data.creatorTypes} />
        </View>
      ) : null}
      {data?.bio ? <Text style={styles.bio}>{data.bio}</Text> : null}
      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{compact(data?.postCount ?? 0)}</Text>
          <Text style={styles.statLabel}>{t('channel.posts')}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{compact(followers)}</Text>
          <Text style={styles.statLabel}>{t('channel.followers')}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{compact(data?.following ?? 0)}</Text>
          <Text style={styles.statLabel}>{t('channel.following')}</Text>
        </View>
      </View>
      {totals ? (
        <View style={styles.totalsRow}>
          <Text style={styles.totalsText}>
            ▶ {compact(totals.views)} · ♥ {compact(totals.likes)} · 🔀 {compact(totals.remixes)}
          </Text>
        </View>
      ) : null}
      {data?.isMe ? (
        // három EGYENLŐ cella oldalmargóval — telefonon semmi nem lóg ki (élő teszt CH1)
        <View style={styles.ownActionRow}>
          {(
            [
              { icon: 'settings-outline', label: t('channel.editProfile'), to: '/profile' },
              { icon: 'folder-outline', label: t('collections.title'), to: '/collections' },
              { icon: 'stats-chart-outline', label: t('dashboard.title'), to: '/dashboard' },
            ] as const
          ).map((a) => (
            <Pressable
              key={a.to}
              style={styles.ownActionBtn}
              onPress={() => router.push(a.to)}
              accessibilityRole="button"
              accessibilityLabel={a.label}
            >
              <Ionicons name={a.icon} size={18} color={palette.text} />
              <Text
                style={styles.ownActionText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.followBtn, following && styles.followingBtn]}
            onPress={onFollow}
          >
            <Text style={[styles.followBtnText, following && styles.followingBtnText]}>
              {following ? t('channel.following2') : t('channel.follow')}
            </Text>
          </Pressable>
          <Pressable style={styles.msgBtn} onPress={onMessage} accessibilityLabel={t('chat.message')}>
            <Ionicons name="chatbubble-outline" size={18} color={palette.text} />
          </Pressable>
          <Pressable
            style={styles.msgBtn}
            onPress={onGift}
            accessibilityLabel={t('wallet.gift.title')}
          >
            <Ionicons name="gift-outline" size={18} color={palette.accent2} />
          </Pressable>
        </View>
      )}
      {data?.skills?.length ? (
        <View style={styles.skillsWrap}>
          <TagBadges tags={data.skills} max={12} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  profileHead: { alignItems: 'center', paddingVertical: 16, gap: 6 },
  cover: { alignSelf: 'stretch', aspectRatio: COVER_ASPECT, borderRadius: 14, backgroundColor: palette.surfaceHigh },
  coverPlaceholder: { borderWidth: 1, borderColor: palette.border },
  bigAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: palette.bg,
    marginTop: -48,
  },
  bigAvatarImg: { width: '100%', height: '100%' },
  bigAvatarText: { color: '#fff', fontSize: 40, fontWeight: '800' },
  displayName: { color: palette.text, fontSize: 18, fontWeight: '800', marginTop: 4 },
  handle: { color: palette.textDim, fontSize: 14 },
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 10,
  },
  liveBannerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },
  liveBannerText: { color: '#fff', fontSize: 13, fontWeight: '800', flexShrink: 1 },
  creatorBadges: { marginTop: 8, paddingHorizontal: 16 },
  bio: { color: palette.text, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6, paddingHorizontal: 24 },
  skillsWrap: { marginTop: 14, paddingHorizontal: 16, alignItems: 'center' },
  stats: { flexDirection: 'row', gap: 28, marginTop: 12 },
  stat: { alignItems: 'center' },
  statNum: { color: palette.text, fontSize: 17, fontWeight: '800' },
  statLabel: { color: palette.textDim, fontSize: 12 },
  followBtn: {
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 40,
    paddingVertical: 10,
  },
  followingBtn: { backgroundColor: palette.surfaceHigh, borderWidth: 1, borderColor: palette.border },
  followBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  followingBtnText: { color: palette.text },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 },
  ownActionRow: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    gap: 8,
    marginTop: 14,
    paddingHorizontal: 16,
  },
  ownActionBtn: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 56,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  ownActionText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  msgBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalsRow: { marginTop: 10, backgroundColor: palette.surfaceHigh, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  totalsText: { color: palette.text, fontSize: 13, fontWeight: '700' },
});

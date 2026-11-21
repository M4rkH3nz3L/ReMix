import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { VideoThumb } from '@/components/VideoThumb';
import { palette } from '@/constants/editor';
import { compact } from '@/lib/channelScreen';
import type { FeedPost } from '@/types/social';

/** A csatorna poszt-rácsának egy cellája (REFACTOR: a src/app/channel/[id].tsx gridItem-je) */
export function ChannelGridItem({
  item,
  isMe,
  openInFeed,
  openPost,
}: {
  item: FeedPost;
  isMe: boolean | undefined;
  openInFeed: (post: FeedPost) => void;
  openPost: (post: FeedPost) => void;
}) {
  return (
    <VideoThumb
      style={styles.gridItem}
      videoUri={item.videoUri}
      posterUri={item.posterUri}
      onPress={() => openInFeed(item)}
      label={item.title}
    >
      <View style={styles.gridViews}>
        <Ionicons name="play" size={11} color="#fff" />
        <Text style={styles.gridViewsText}>{compact(item.counts.views)}</Text>
      </View>
      {/* saját poszt → kezelés (kiemelés/statisztika/remix-mod/törlés) a sarok-gombbal */}
      {isMe ? (
        <Pressable style={styles.gridManage} onPress={() => openPost(item)} hitSlop={8}>
          <Ionicons name="ellipsis-horizontal" size={16} color="#fff" />
        </Pressable>
      ) : null}
    </VideoThumb>
  );
}

const styles = StyleSheet.create({
  gridItem: {
    flex: 1 / 3,
    aspectRatio: 0.62,
    marginBottom: 3,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gridManage: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#00000088',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridViews: { position: 'absolute', left: 5, bottom: 5, flexDirection: 'row', alignItems: 'center', gap: 3 },
  gridViewsText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});

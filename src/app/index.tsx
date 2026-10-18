import { FlatList, View } from 'react-native';

import { BottomNav } from '@/components/BottomNav';
import { CollectionSheet } from '@/components/CollectionSheet';
import { CommentSheet } from '@/components/CommentSheet';
import { FeedEmpty, FeedLoading } from '@/components/feed/FeedEmpty';
import { FeedPostBody } from '@/components/feed/FeedPostBody';
import { FeedTopBar } from '@/components/feed/FeedTopBar';
import { styles } from '@/components/feed/feedStyles';
import { GiftSheet } from '@/components/GiftSheet';
import { useFeed } from '@/hooks/useFeed';
import type { FeedPost } from '@/types/social';

/**
 * 📱 FEED (home) képernyő — VÉKONY KOMPOZÍCIÓ (Health/02.4). A nem-prezentációs
 * logika a [useFeed] hookban él; a nagy JSX-szekciók prezentációs al-komponensek
 * (`FeedTopBar` / `FeedEmpty` / `FeedPostBody`). Itt már csak az összerakás marad:
 * a függőleges TOP-lista + a poszton belüli vízszintes remix-lapozó + a sheet-ek.
 */
export default function FeedScreen() {
  const f = useFeed();

  // egy TOP-poszt = egy függőleges oldal, amin belül VÍZSZINTESEN lapozható az eredeti
  // + a csatolt remixek (full-screen). Jobbról-balra húzva jön elő a remix; a videó a
  // beállt laphoz vált. (A lista MINDIG jelen van — remixek nélkül 1 lap, scroll tiltva.)
  const renderItem = ({ item }: { item: FeedPost }) => {
    const pages = f.remixPages(item, f.remixMap[item.id]);
    return (
      <View style={[styles.page, { height: f.pageHeight, width: f.width }]}>
        {/* 🖥️ középre igazított 9:16 oszlop (weben) — az overlay-ek EHHEZ igazodnak */}
        <View style={[styles.column, { width: f.contentW, height: f.pageHeight }]}>
          <FlatList
            ref={(r: FlatList<FeedPost> | null) => {
              if (r) {
                f.listRefs.current.set(item.id, r);
              } else {
                f.listRefs.current.delete(item.id);
              }
            }}
            horizontal
            pagingEnabled
            scrollEnabled={pages.length > 1}
            directionalLockEnabled
            nestedScrollEnabled
            data={pages}
            extraData={f.activeId ?? ''}
            keyExtractor={(p) => p.id}
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            scrollEventThrottle={32}
            getItemLayout={(_, index) => ({ length: f.contentW, offset: f.contentW * index, index })}
            onScroll={(e) => f.onPagerScroll(item.id, e.nativeEvent.contentOffset.x)}
            onMomentumScrollEnd={(e) => f.onPagerScroll(item.id, e.nativeEvent.contentOffset.x)}
            renderItem={({ item: sub, index }) => (
              <View style={{ width: f.contentW, height: f.pageHeight }}>
                <FeedPostBody
                  sub={sub}
                  subIndex={index}
                  pageCount={pages.length}
                  topPost={item}
                  t={f.t}
                  activeId={f.activeId}
                  chromeVisible={f.chromeVisible}
                  chromeBottom={f.chromeBottom}
                  seekBottom={f.seekBottom}
                  contentW={f.contentW}
                  pageHeight={f.pageHeight}
                  insets={f.insets}
                  canModeratePost={f.canModeratePost}
                  muted={f.muted}
                  volume={f.volume}
                  volumeOpen={f.volumeOpen}
                  volHeightRef={f.volHeightRef}
                  volumeGesture={f.volumeGesture}
                  onToggleMute={f.onToggleMute}
                  progress={f.progress}
                  seekWidthRef={f.seekWidthRef}
                  seekGesture={f.seekGesture}
                  hotspotTime={f.hotspotTime}
                  handleHotspot={f.handleHotspot}
                  player={f.player}
                  webVideoRef={f.webVideoRef}
                  heartAnim={f.heartAnim}
                  ppAnim={f.ppAnim}
                  ppIcon={f.ppIcon}
                  pulseStyle={f.pulseStyle}
                  tapGesture={f.tapGesture}
                  openCreator={f.openCreator}
                  onLike={f.onLike}
                  onSave={f.onSave}
                  onRemix={f.onRemix}
                  onFollow={f.onFollow}
                  onModerate={f.onModerate}
                  onReportPost={f.onReportPost}
                  goToPage={f.goToPage}
                  setCommentFor={f.setCommentFor}
                  setCollectionFor={f.setCollectionFor}
                  setGiftFor={f.setGiftFor}
                />
              </View>
            )}
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* felső mód-váltó — csak a kezelőfelülettel együtt (hármas koppintás) */}
      {f.chromeVisible ? (
        <FeedTopBar
          channelId={f.channelId}
          channelTitle={f.channelTitle}
          mode={f.mode}
          contentW={f.contentW}
          onChangeMode={f.changeMode}
        />
      ) : null}

      {f.loading ? (
        <FeedLoading />
      ) : f.posts.length === 0 ? (
        <FeedEmpty mode={f.mode} />
      ) : (
        <FlatList
          data={f.posts}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          extraData={f.listExtra}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={f.pageHeight}
          decelerationRate="fast"
          onViewableItemsChanged={f.onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          getItemLayout={(_, index) => ({ length: f.pageHeight, offset: f.pageHeight * index, index })}
          initialScrollIndex={
            f.channelId && f.startId
              ? Math.max(0, f.posts.findIndex((p) => p.id === f.startId))
              : undefined
          }
          onScrollToIndexFailed={() => {}}
        />
      )}

      {/* alsó menü — csak hármas koppintás után (immerzív alap); channel-módban vissza-gomb visz */}
      {f.chromeVisible && !f.channelId ? <BottomNav active="feed" /> : null}

      {/* 🎁 ajándék-lap (a poszt szerzőjének, TikTok-modell) */}
      <GiftSheet
        visible={f.giftFor !== null}
        toUsername={f.giftFor?.creator.username ?? ''}
        toName={f.giftFor?.creator.displayName}
        postId={f.giftFor?.id ?? null}
        onClose={() => f.setGiftFor(null)}
      />

      {/* 📁 kollekció-választó (a mentés-gomb hosszú-nyomására) */}
      <CollectionSheet postId={f.collectionFor?.id ?? null} onClose={() => f.setCollectionFor(null)} />

      {/* 💬 komment-lap (a komment-gomb nyitja) */}
      <CommentSheet
        post={f.commentFor}
        onClose={() => f.setCommentFor(null)}
        onCountChange={(d) => {
          if (f.commentFor) {
            f.patch(f.commentFor.id, (p) => ({
              ...p,
              counts: { ...p.counts, comments: Math.max(0, p.counts.comments + d) },
            }));
          }
        }}
      />
    </View>
  );
}

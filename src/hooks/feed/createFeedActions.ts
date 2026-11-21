import { type Href, router } from 'expo-router';
import type { TFunction } from 'i18next';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Alert } from 'react-native';

import { canRemix, remixRoute } from '@/lib/imageRemix';
import { showError } from '@/components/ui/errorAlert';
import { haptics } from '@/design';
import { remixFromPost, toggleFollow, toggleLike, toggleSave } from '@/lib/feed';
import { runOptimistic } from '@/lib/optimistic';
import { REPORT_REASONS, reportPost } from '@/lib/reports';
import { blockUser } from '@/lib/blocks';
import type { FeedMode, FeedPost } from '@/types/social';
import { moderatePostGlobal } from '@/lib/roles';
import { requireApp, requireSignIn } from '@/lib/webGate';
import { logCaught } from '@/lib/logCaught';

/**
 * 👆 A feed interakciós handlerei (REFACTOR: a useFeed-ből) — hook-mentes csoport, minden
 * renderben újra létrehozva, pontosan mint korábban a hook törzsében: mód-váltás, poszt-patch,
 * like/mentés (optimista), remix, moderáció, jelentés, blokkolás, követés.
 */
export function createFeedActions({
  t,
  mode,
  busy,
  setLoading,
  setPosts,
  setMode,
  setRemixMap,
  setBusy,
  blockedIdsRef,
  popHeart,
}: {
  t: TFunction;
  mode: FeedMode;
  busy: boolean;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setPosts: Dispatch<SetStateAction<FeedPost[]>>;
  setMode: Dispatch<SetStateAction<FeedMode>>;
  setRemixMap: Dispatch<SetStateAction<Record<string, FeedPost[]>>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  blockedIdsRef: MutableRefObject<string[]>;
  popHeart: () => void;
}) {
  const changeMode = (m: FeedMode) => {
    bumpChrome();
    if (m === mode) {
      return;
    }
    setLoading(true);
    setPosts([]);
    setMode(m);
  };

  // egy poszt frissítése id alapján — a top-listában ÉS a betöltött remixek közt is
  // (a remix-oldalakon is működjön az optimista like/mentés/komment-számláló)
  const patch = (id: string, fn: (p: FeedPost) => FeedPost) => {
    setPosts((prev) => prev.map((p) => (p.id === id ? fn(p) : p)));
    setRemixMap((prev) => {
      let changed = false;
      const next: Record<string, FeedPost[]> = {};
      for (const [k, list] of Object.entries(prev)) {
        let listChanged = false;
        const nl = list.map((p) => {
          if (p.id === id) {
            listChanged = true;
            return fn(p);
          }
          return p;
        });
        if (listChanged) {
          changed = true;
        }
        next[k] = listChanged ? nl : list;
      }
      return changed ? next : prev;
    });
  };

  // a chrome mindig látszik (nincs auto-elrejtés) → nincs teendő; a hívások maradnak,
  // hogy a jövőbeli finomítás egy helyen bekötheto legyen
  const bumpChrome = () => {};

  const onLike = (post: FeedPost) => {
    bumpChrome();
    if (!requireSignIn()) {
      return;
    }
    const liked = !post.viewerLiked;
    const apply = (on: boolean) => (p: FeedPost) => ({
      ...p,
      viewerLiked: on,
      counts: { ...p.counts, likes: p.counts.likes + (on ? 1 : -1) },
    });
    // ⚡ §12.4: optimista (azonnali visszajelzés) + VISSZAGÖRGETÉS hibánál a közös
    // helperrel — enélkül az UI a szerverrel ELLENTÉTES állapotot mutatna.
    void runOptimistic({
      apply: () => patch(post.id, apply(liked)),
      rollback: () => patch(post.id, apply(!liked)),
      commit: () => toggleLike(post.id, liked),
    });
  };

  // dupla-tap a videón → LIKE (csak lájkol, nem vesz vissza) + szív-pop + haptika
  const onDoubleTapLike = (post: FeedPost) => {
    haptics.impact();
    if (!post.viewerLiked) {
      onLike(post);
    } else {
      bumpChrome();
    }
    popHeart();
  };

  const onSave = (post: FeedPost) => {
    bumpChrome();
    if (!requireSignIn()) {
      return;
    }
    const saved = !post.viewerSaved;
    const apply = (on: boolean) => (p: FeedPost) => ({
      ...p,
      viewerSaved: on,
      counts: { ...p.counts, saves: p.counts.saves + (on ? 1 : -1) },
    });
    // optimista + visszagörgetés hibánál (lásd onLike)
    void runOptimistic({
      apply: () => patch(post.id, apply(saved)),
      rollback: () => patch(post.id, apply(!saved)),
      commit: () => toggleSave(post.id, saved),
    });
  };

  const onRemix = (post: FeedPost) => {
    bumpChrome();
    // 🌐 weben nincs szerkesztő → még a projekt-másolat ELŐTT megállunk
    if (busy || !requireApp() || !requireSignIn()) {
      return;
    }
    if (!canRemix(post)) {
      Alert.alert(t('feed.title'), t('feed.notRemixable'));
      return;
    }
    setBusy(true);
    remixFromPost(post)
      .then((pid) => {
        if (pid) {
          router.push(remixRoute(post, pid) as Href);
        }
      })
      .catch((e: unknown) => { logCaught('hooks/useFeed.ts:onRemix', e); return showError(e, 'remix'); })
      .finally(() => setBusy(false));
  };

  // ⚠️ A sikert csak a hívás UTÁN jelentjük: korábban az Alert azonnal ment, így
  // hálózati hiba esetén is azt mondtuk, hogy „követed" — pedig nem.
  // 🛡️ globális moderáció: bármely poszt eltávolítása a feedből (post.moderate jog)
  const onModerate = (post: FeedPost) => {
    bumpChrome();
    Alert.alert(t('feed.moderate.title'), t('feed.moderate.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('feed.moderate.remove'),
        style: 'destructive',
        onPress: () =>
          moderatePostGlobal(post.id, 'removed')
            .then(() => {
              setPosts((prev) => prev.filter((p) => p.id !== post.id));
              setRemixMap((prev) => {
                const next: Record<string, FeedPost[]> = {};
                for (const [k, list] of Object.entries(prev)) {
                  next[k] = list.filter((p) => p.id !== post.id);
                }
                return next;
              });
            })
            .catch((e: unknown) => { logCaught('hooks/useFeed.ts:onModerate', e); return showError(e); }),
      },
    ]);
  };

  // 🚩 poszt bejelentése (nem-saját) — ok-választó
  // 🚩 jelentés ok-választó (a moderációs menüből)
  const reportWithReason = (post: FeedPost) => {
    Alert.alert(t('report.title'), t('report.pickReason'), [
      ...REPORT_REASONS.map((r) => ({
        text: t(`report.reason_${r}`),
        onPress: () =>
          reportPost(post.id, r)
            .then(() => Alert.alert(t('report.title'), t('report.done')))
            .catch((e: unknown) => { logCaught('hooks/useFeed.ts:reportWithReason', e); return showError(e); }),
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  // 🛡️ szerző blokkolása: a block szerverre megy, a posztjai AZONNAL eltűnnek a feedből
  const onBlockUser = (post: FeedPost) => {
    const name = post.creator.username ? `@${post.creator.username}` : t('report.thisUser');
    Alert.alert(t('report.blockTitle'), t('report.blockConfirm', { name }), [
      { text: t('common.cancel'), style: 'cancel' as const },
      {
        text: t('report.blockAction'),
        style: 'destructive' as const,
        onPress: () =>
          blockUser(post.creator.id)
            .then(() => {
              blockedIdsRef.current = [...blockedIdsRef.current, post.creator.id];
              setPosts((prev) => prev.filter((p) => p.creator.id !== post.creator.id));
              Alert.alert(t('report.blockTitle'), t('report.blockDone', { name }));
            })
            .catch((e: unknown) => { logCaught('hooks/useFeed.ts:onBlockUser', e); return showError(e); }),
      },
    ]);
  };

  // 🚩 moderációs menü (nem-saját poszt): jelentés VAGY a szerző blokkolása
  const onReportPost = (post: FeedPost) => {
    bumpChrome();
    if (!requireSignIn()) {
      return;
    }
    Alert.alert(t('report.title'), undefined, [
      { text: t('report.label'), onPress: () => reportWithReason(post) },
      { text: t('report.blockAction'), style: 'destructive' as const, onPress: () => onBlockUser(post) },
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const onFollow = (post: FeedPost) => {
    bumpChrome();
    if (!requireSignIn()) {
      return;
    }
    toggleFollow(post.creator.id, true)
      .then(() =>
        Alert.alert(t('feed.title'), t('feed.followed', { name: post.creator.displayName }))
      )
      .catch((caught) => { logCaught('hooks/useFeed.ts:onFollow', caught); return Alert.alert(t('common.error'), t('feed.followFailed')); });
  };

  return { changeMode, patch, onLike, onDoubleTapLike, onSave, onRemix, onModerate, onReportPost, onFollow };
}

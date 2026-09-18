import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import {
  addComment,
  currentUserId,
  deleteComment,
  listComments,
  type PostComment,
} from '@/lib/feed';
import type { FeedPost } from '@/types/social';
import { useRoles } from '@/store/roleStore';
import { REPORT_REASONS, reportComment } from '@/lib/reports';

/** Rövid relatív idő (pl. „3p", „2ó", „5n") — nincs külső függőség. */
function ago(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'most';
  if (diff < 3600) return `${Math.floor(diff / 60)}p`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}ó`;
  return `${Math.floor(diff / 86400)}n`;
}

interface Props {
  /** a poszt, amelynek a kommentjeit mutatjuk; null = zárva */
  post: FeedPost | null;
  onClose: () => void;
  /** a feed komment-számláló optimista frissítéséhez (+1 / -1) */
  onCountChange: (delta: number) => void;
}

export function CommentSheet({ post, onClose, onCountChange }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const me = currentUserId();
  const isPostOwner = !!post && me === post.creator.id;
  // 🛡️ globális moderátor-jog: bárki kommentjét törölheti (a szerző + poszt-tulaj mellé)
  const canModerate = useRoles((s) => s.permissions.includes('comment.moderate'));
  // származtatott betöltés-állapot → nincs szinkron setState az effektben
  const loading = post !== null && loadedFor !== post.id;

  useEffect(() => {
    if (!post) {
      return;
    }
    let alive = true;
    listComments(post.id)
      .then((cs) => {
        if (alive) {
          setComments(cs);
          setLoadedFor(post.id);
        }
      })
      .catch(() => {
        if (alive) {
          setComments([]);
          setLoadedFor(post.id);
        }
      });
    return () => {
      alive = false;
    };
  }, [post]);

  const onSend = () => {
    const body = text.trim();
    if (!post || !body || sending) {
      return;
    }
    setSending(true);
    addComment(post.id, body)
      .then((c) => {
        setComments((prev) => [c, ...prev]);
        setText('');
        onCountChange(1);
      })
      .catch((e: unknown) =>
        Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
      )
      .finally(() => setSending(false));
  };

  const onDelete = (c: PostComment) => {
    Alert.alert(t('feed.comments.deleteTitle'), t('feed.comments.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          // optimista: azonnal eltűnik, hibánál visszakerül
          setComments((prev) => prev.filter((x) => x.id !== c.id));
          onCountChange(-1);
          deleteComment(c.id).catch(() => {
            setComments((prev) => [c, ...prev.filter((x) => x.id !== c.id)]);
            onCountChange(1);
            Alert.alert(t('common.error'), t('feed.comments.deleteFailed'));
          });
        },
      },
    ]);
  };

  // 🚩 komment bejelentése (nem-saját) — ok-választó
  const onReport = (c: PostComment) => {
    Alert.alert(t('report.title'), t('report.pickReason'), [
      ...REPORT_REASONS.map((r) => ({
        text: t(`report.reason_${r}`),
        onPress: () =>
          reportComment(c.id, r)
            .then(() => Alert.alert(t('report.title'), t('report.done')))
            .catch((e: unknown) =>
              Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e))
            ),
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const renderItem = ({ item }: { item: PostComment }) => {
    const canDelete = me === item.authorId || isPostOwner || canModerate;
    return (
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(item.author.displayName || '?').slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <View style={styles.bubble}>
          <Text style={styles.author}>
            @{item.author.username} <Text style={styles.time}>· {ago(item.createdAt)}</Text>
          </Text>
          <Text style={styles.body}>{item.body}</Text>
        </View>
        {me && me !== item.authorId ? (
          <Pressable onPress={() => onReport(item)} hitSlop={8} style={styles.del}>
            <Ionicons name="flag-outline" size={15} color={palette.textDim} />
          </Pressable>
        ) : null}
        {canDelete ? (
          <Pressable onPress={() => onDelete(item)} hitSlop={8} style={styles.del}>
            <Ionicons name="trash-outline" size={16} color={palette.textDim} />
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <Modal
      visible={post !== null}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 10 }]}>
            <View style={styles.grabber} />
            <Text style={styles.title}>
              {t('feed.comments.title', { n: post?.counts.comments ?? 0 })}
            </Text>

            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={palette.accent} />
              </View>
            ) : (
              <FlatList
                data={comments}
                keyExtractor={(c) => c.id}
                renderItem={renderItem}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                ListEmptyComponent={
                  <Text style={styles.empty}>{t('feed.comments.empty')}</Text>
                }
              />
            )}

            {me ? (
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={text}
                  onChangeText={setText}
                  placeholder={t('feed.comments.placeholder')}
                  placeholderTextColor={palette.textDim}
                  multiline
                  maxLength={2000}
                />
                <Pressable
                  style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnOff]}
                  onPress={onSend}
                  disabled={!text.trim() || sending}
                >
                  <Ionicons name="send" size={18} color="#fff" />
                </Pressable>
              </View>
            ) : (
              // kijelentkezve NEM megy a komment — beszédes CTA a néma hiba helyett
              <Pressable
                style={styles.loginCta}
                onPress={() => {
                  onClose();
                  router.push('/auth');
                }}
              >
                <Ionicons name="log-in-outline" size={18} color="#fff" />
                <Text style={styles.loginCtaText}>{t('feed.comments.loginToComment')}</Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
  sheetWrap: { maxHeight: '80%' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: palette.border,
    minHeight: 320,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.border,
    marginBottom: 10,
  },
  title: { color: palette.text, fontSize: 15, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  loadingBox: { paddingVertical: 40, alignItems: 'center' },
  list: { flexGrow: 0 },
  empty: { color: palette.textDim, textAlign: 'center', paddingVertical: 30 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  bubble: { flex: 1 },
  author: { color: palette.text, fontSize: 13, fontWeight: '700' },
  time: { color: palette.textDim, fontSize: 12, fontWeight: '500' },
  body: { color: palette.text, fontSize: 14, marginTop: 2, lineHeight: 19 },
  del: { padding: 4 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  input: {
    flex: 1,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    color: palette.text,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
  loginCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.accent,
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  loginCtaText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});

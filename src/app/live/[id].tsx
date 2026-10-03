import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import {
  bumpViewerPeak,
  buildLiveSelf,
  endLive,
  getLive,
  myUserId,
  openLiveRoom,
  type LiveChat,
  type LiveRoom,
  type LiveSession,
} from '@/lib/live';

const REACTIONS = ['❤️', '🔥', '👏', '😂', '🎉'];

/** Egy felúszó reakció-emoji (2 mp alatt felfelé + elhalványul). Az `x` drift az
 * esemény-handlerben készül (nem renderben), hogy ne hívjunk impure fn-t render közben. */
function FloatingHeart({ emoji, x, onDone }: { emoji: string; x: number; onDone: () => void }) {
  const anim = useRef(new Animated.Value(0)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    // egyszer fut (mount): a végén eltávolítja magát a doneRef-en át
    Animated.timing(anim, { toValue: 1, duration: 2000, useNativeDriver: true }).start(() =>
      doneRef.current(),
    );
  }, [anim]);
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [0, -260] });
  const opacity = anim.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] });
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, x] });
  return (
    <Animated.Text style={[styles.floatEmoji, { opacity, transform: [{ translateY }, { translateX }] }]}>
      {emoji}
    </Animated.Text>
  );
}

export default function LiveRoomScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewers, setViewers] = useState(1);
  const [chat, setChat] = useState<LiveChat[]>([]);
  const [text, setText] = useState('');
  const [floats, setFloats] = useState<{ id: string; emoji: string; x: number }[]>([]);
  const [camPerm, requestCam] = useCameraPermissions();

  const roomRef = useRef<LiveRoom | null>(null);
  const endedRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const me = myUserId();
  const isHost = session != null && session.hostId === me;

  const addFloat = useCallback((emoji: string) => {
    // esemény-handler (nem render) → itt szabad a Math.random
    const fid = `${Date.now()}-${Math.random()}`;
    const x = (Math.random() - 0.5) * 60;
    setFloats((prev) => [...prev.slice(-24), { id: fid, emoji, x }]);
  }, []);

  // session betöltése + realtime room nyitása
  useEffect(() => {
    let active = true;
    const liveId = String(id);
    (async () => {
      const s = await getLive(liveId).catch(() => null);
      if (!active) {
        return;
      }
      if (!s) {
        setNotFound(true);
        return;
      }
      setSession(s);
      const self = await buildLiveSelf();
      if (!active || !self) {
        return;
      }
      roomRef.current = openLiveRoom(liveId, self, {
        onChat: (m) => setChat((prev) => [...prev.slice(-80), m]),
        onReaction: (emoji) => addFloat(emoji),
        onViewers: (count) => {
          setViewers(count);
          // a host frissíti a csúcs-nézőszámot (RLS: csak ő)
          if (s.hostId === self.id) {
            void bumpViewerPeak(liveId, count);
          }
        },
      });
    })();
    return () => {
      active = false;
      roomRef.current?.stop();
      roomRef.current = null;
    };
  }, [id, addFloat]);

  // host: kamera-engedély kérése belépéskor
  useEffect(() => {
    if (isHost && camPerm && !camPerm.granted && camPerm.canAskAgain) {
      void requestCam();
    }
  }, [isHost, camPerm, requestCam]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [chat.length]);

  const onSendChat = () => {
    const body = text.trim();
    if (!body) {
      return;
    }
    roomRef.current?.sendChat(body);
    setText('');
  };

  const onReact = (emoji: string) => {
    roomRef.current?.sendReaction(emoji);
    // a sajátot azonnal is megmutatjuk (a broadcast self:true visszahozza, de ne lógjon)
  };

  const onEndOrLeave = async () => {
    if (isHost && session && !endedRef.current) {
      endedRef.current = true;
      await endLive(session.id).catch(() => {});
    }
    router.back();
  };

  // host kilépéskor (unmount) best-effort leállítás
  useEffect(() => {
    return () => {
      if (isHost && session && !endedRef.current) {
        endedRef.current = true;
        void endLive(session.id).catch(() => {});
      }
    };
  }, [isHost, session]);

  if (notFound) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="radio-outline" size={48} color={palette.border} />
          <Text style={styles.endedText}>{t('live.ended')}</Text>
          <Pressable style={styles.leaveBtn} onPress={() => router.back()}>
            <Text style={styles.leaveText}>{t('live.leave')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={palette.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      {/* háttér: host → kamera, néző → gradiens + host-avatar (a videó-stream providert igényel) */}
      {isHost && camPerm?.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="front" />
      ) : (
        <LinearGradient colors={['#1a1030', '#0c0d12']} style={StyleSheet.absoluteFill}>
          <View style={styles.viewerStage}>
            {session.hostAvatar ? (
              <Image source={{ uri: session.hostAvatar }} style={styles.viewerAvatar} />
            ) : (
              <View style={[styles.viewerAvatar, styles.viewerAvatarFallback]}>
                <Ionicons name="person" size={48} color={palette.textDim} />
              </View>
            )}
            {!isHost ? <Text style={styles.viewerNote}>{t('live.videoSoon')}</Text> : null}
          </View>
        </LinearGradient>
      )}

      {/* felúszó reakciók */}
      <View pointerEvents="none" style={styles.floatLayer}>
        {floats.map((f) => (
          <FloatingHeart
            key={f.id}
            emoji={f.emoji}
            x={f.x}
            onDone={() => setFloats((prev) => prev.filter((p) => p.id !== f.id))}
          />
        ))}
      </View>

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']}>
        {/* fejléc: host + LIVE + nézőszám + bezárás */}
        <View style={styles.topBar}>
          <View style={styles.hostChip}>
            <View style={styles.liveDot} />
            <Text style={styles.hostName} numberOfLines={1}>
              {session.hostName || session.hostUsername || '—'}
            </Text>
          </View>
          <View style={styles.viewerChip}>
            <Ionicons name="eye" size={14} color="#fff" />
            <Text style={styles.viewerCount}>{viewers}</Text>
          </View>
          <Pressable onPress={onEndOrLeave} hitSlop={10} style={styles.closeBtn}>
            <Text style={styles.closeText}>{isHost ? t('live.endLive') : t('live.leave')}</Text>
          </Pressable>
        </View>

        <Text style={styles.liveTitle} numberOfLines={2}>
          {session.title}
        </Text>

        <View style={{ flex: 1 }} />

        {/* chat + reakciók */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {chat.map((m, i) => (
              <View key={`${m.id}-${m.at}-${i}`} style={styles.chatRow}>
                <Text style={styles.chatName}>{m.name}</Text>
                <Text style={styles.chatText}>{m.text}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.reactRow}>
            {REACTIONS.map((e) => (
              <Pressable key={e} onPress={() => onReact(e)} style={styles.reactBtn} hitSlop={6}>
                <Text style={styles.reactEmoji}>{e}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={t('live.chatPlaceholder')}
              placeholderTextColor="#ffffff99"
              style={styles.chatInput}
              maxLength={500}
              onSubmitEditing={onSendChat}
              returnKeyType="send"
            />
            <Pressable onPress={onSendChat} style={styles.sendBtn} hitSlop={6}>
              <Ionicons name="send" size={18} color="#fff" />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  endedText: { color: palette.textDim, fontSize: 16, fontWeight: '700' },

  viewerStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  viewerAvatar: { width: 110, height: 110, borderRadius: 55, backgroundColor: palette.surface },
  viewerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  viewerNote: { color: '#ffffff99', fontSize: 13 },

  floatLayer: { position: 'absolute', right: 24, bottom: 160, width: 80, height: 320 },
  floatEmoji: { position: 'absolute', bottom: 0, right: 0, fontSize: 30 },

  overlay: { flex: 1, paddingHorizontal: 14 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  hostChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00000066',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexShrink: 1,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.danger },
  hostName: { color: '#fff', fontSize: 14, fontWeight: '800', flexShrink: 1 },
  viewerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#00000066',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  viewerCount: { color: '#fff', fontSize: 13, fontWeight: '800' },
  closeBtn: {
    marginLeft: 'auto',
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  closeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  liveTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 10, textShadowColor: '#000', textShadowRadius: 6 },

  chatScroll: { maxHeight: 220 },
  chatContent: { gap: 6, paddingVertical: 8 },
  chatRow: { backgroundColor: '#00000055', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start', maxWidth: '92%' },
  chatName: { color: palette.accent, fontSize: 12, fontWeight: '800' },
  chatText: { color: '#fff', fontSize: 14, marginTop: 1 },

  reactRow: { flexDirection: 'row', gap: 10, paddingVertical: 8 },
  reactBtn: { backgroundColor: '#00000055', borderRadius: 999, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reactEmoji: { fontSize: 22 },

  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  chatInput: {
    flex: 1,
    backgroundColor: '#ffffff1f',
    borderRadius: 999,
    color: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: { backgroundColor: palette.accent, borderRadius: 999, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  leaveBtn: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  leaveText: { color: palette.text, fontSize: 14, fontWeight: '700' },
});

import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { palette } from '@/constants/editor';
import { encodeScenePayload, type ScenePayload } from '@/lib/liveComposite';
import {
  bumpViewerPeak,
  buildLiveSelf,
  endLive,
  getLive,
  myUserId,
  openLiveRoom,
  type LiveChat,
  type LiveRoom,
  type LiveSelf,
  type LiveSession,
} from '@/lib/live';
import { hasEnabledTargets, startLiveEgress, stopLiveEgress } from '@/lib/liveDestinations';
import { setActiveScene } from '@/lib/liveDoc';
import { loadProject } from '@/lib/storage';
import type { LiveDoc } from '@/types/live';
// type-only (erased runtime-ban → NEM húzza be a WebRTC-t)
import type { LiveVideoStageProps } from '@/components/live/LiveVideoStage';

// 🔴 A WebRTC-videó réteg LAZY (külön modul: @/components/live/LiveVideoStage) →
// az expo-router INDULÁSI route-validációja NEM tölti be a natív WebRTC-modult,
// így egy WebRTC nélküli build sem dönti el az egész appot. Ha a modul nem
// tölthető (hiányzó natív WebRTC → részleges/üres modul), fallback-komponensre
// esünk (barátságos „frissítsd az appot" üzenet), nem dob érvénytelen-elem hibát.
// 🔑 Van-e BELINKELVE a natív WebRTC-modul? (@livekit/react-native-webrtc a
// `NativeModules.WebRTCModule`-t nézi, és annak hiányában a modul-TETEJÉN dob —
// amit a lazy try/catch sem kap el, mert a Metro module-init-throw megkerüli.)
// Ezért ELŐRE ellenőrizzük (ez NEM importálja az @livekit-et), és csak akkor
// próbáljuk betölteni a videó-réteget, ha a WebRTC tényleg jelen van.
const WEBRTC_AVAILABLE = !!NativeModules.WebRTCModule;

const LiveVideoStage = lazy(async () => {
  try {
    const m = (await import('@/components/live/LiveVideoStage')) as {
      default?: ComponentType<LiveVideoStageProps>;
    } | undefined;
    if (m && typeof m.default === 'function') {
      return { default: m.default };
    }
  } catch {
    // a natív WebRTC-modul hiányzik (régi build) → fallback (lentebb)
  }
  // MINDIG valid komponenst adunk vissza (sosem `undefined` → nincs „invalid element type")
  return { default: LiveVideoUnavailable };
});

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

/** A videó betöltése/kapcsolódása alatti placeholder (host-avatar + „kapcsolódás"). */
function ConnectingStage({ hostAvatar, note }: { hostAvatar: string | null; note: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.connectingBg]}>
      <View style={styles.viewerStage}>
        {hostAvatar ? (
          <Image source={{ uri: hostAvatar }} style={styles.viewerAvatar} />
        ) : (
          <View style={[styles.viewerAvatar, styles.viewerAvatarFallback]}>
            <Ionicons name="person" size={48} color={palette.textDim} />
          </View>
        )}
        <Text style={styles.viewerNote}>{note}</Text>
      </View>
    </View>
  );
}

/** Fallback, ha a natív WebRTC-modul hiányzik (régi build) → a videó nem tölthető. */
function LiveVideoUnavailable({ hostAvatar }: LiveVideoStageProps) {
  const { t } = useTranslation();
  return (
    <View style={[StyleSheet.absoluteFill, styles.connectingBg]}>
      <View style={styles.viewerStage}>
        {hostAvatar ? (
          <Image source={{ uri: hostAvatar }} style={styles.viewerAvatar} />
        ) : (
          <View style={[styles.viewerAvatar, styles.viewerAvatarFallback]}>
            <Ionicons name="videocam-off" size={44} color={palette.textDim} />
          </View>
        )}
        <Text style={styles.viewerNote}>
          {t('live.videoUnavailable', { defaultValue: 'Live video needs the latest app build.' })}
        </Text>
      </View>
    </View>
  );
}

export default function LiveRoomScreen() {
  const { t } = useTranslation();
  const { id, project: projectParam } = useLocalSearchParams<{ id: string; project?: string }>();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewers, setViewers] = useState(1);
  const [chat, setChat] = useState<LiveChat[]>([]);
  const [text, setText] = useState('');
  const [floats, setFloats] = useState<{ id: string; emoji: string; x: number }[]>([]);
  // 🔴 a saját identitás (a videó-token-szerzéshez a LiveVideoStage-ben)
  const [self, setSelf] = useState<LiveSelf | null>(null);
  // 🎥 a renderelendő jelenet-állapot (host: a saját live-docából; néző: a broadcastból)
  const [scene, setScene] = useState<ScenePayload | null>(null);
  // 🎥 host: a jelenet-lista az élő váltóhoz (a live-docból)
  const [hostScenes, setHostScenes] = useState<{ id: string; name: string }[]>([]);
  // 🎚️ host: mikrofon némítva (az élő mic-kontroll; a mixer kezdőértékéből)
  const [micMuted, setMicMuted] = useState(false);

  const roomRef = useRef<LiveRoom | null>(null);
  const liveDocRef = useRef<LiveDoc | null>(null); // host: a live-produkció doc (Studio)
  const egressIdRef = useRef<string | null>(null); // host: a futó multistream-egress (Pro)
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

  // 🎥 a host kiküldi az aktív jelenetet (saját render + broadcast a nézőknek)
  const broadcastScene = useCallback(() => {
    const doc = liveDocRef.current;
    if (!doc) {
      return;
    }
    const payload = encodeScenePayload(doc);
    setScene(payload);
    roomRef.current?.sendScene(payload);
  }, []);

  // 🎥 a host élőben jelenetet vált → újra-broadcast
  const switchScene = useCallback(
    (sceneId: string) => {
      const doc = liveDocRef.current;
      if (!doc) {
        return;
      }
      liveDocRef.current = setActiveScene(doc, sceneId);
      broadcastScene();
    },
    [broadcastScene],
  );

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
      setSelf(self); // → a LiveVideoStage ebből szerzi a videó-tokent (lazy)
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
        // 🎥 néző: a host jelenet-állapotát rendereli; host a sajátját (lentebb)
        onScene: (payload) => {
          if (s.hostId !== self.id) {
            setScene(payload);
          }
        },
        // új néző → a host újra-broadcastolja a jelenetet (késői csatlakozó is kapja)
        onViewerJoin: () => {
          if (s.hostId === self.id) {
            broadcastScene();
          }
        },
      });

      // 🎥 a host betölti a Studio live-produkció dokumentumát → jelenet-broadcast.
      // (A videó-token + WebRTC-kapcsolat a lazy LiveVideoStage-ben fut.)
      if (s.hostId === self.id && projectParam) {
        const proj = await loadProject(String(projectParam)).catch(() => null);
        if (active && proj?.live) {
          liveDocRef.current = proj.live;
          setHostScenes(proj.live.scenes.map((sc) => ({ id: sc.id, name: sc.name })));
          setMicMuted(proj.live.mixer?.channels.find((c) => c.id === 'mic')?.mute ?? false);
          broadcastScene();
          // 🎥 multistream (Pro): ha van engedélyezett RTMP-cél → egress indítása
          // (a ReMix-feed mindig megy; nem-Pro / nincs egress-infra esetén csendben kimarad)
          hasEnabledTargets()
            .then((has) => (has && active ? startLiveEgress(liveId) : null))
            .then((r) => {
              if (r && active) {
                egressIdRef.current = r.egressId;
              }
            })
            .catch(() => {});
        }
      }
    })();
    return () => {
      active = false;
      roomRef.current?.stop();
      roomRef.current = null;
    };
  }, [id, projectParam, addFloat, broadcastScene]);

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
      if (egressIdRef.current) {
        void stopLiveEgress(egressIdRef.current); // 🎥 multistream leállítása
        egressIdRef.current = null;
      }
      await endLive(session.id).catch(() => {});
    }
    router.back();
  };

  // host kilépéskor (unmount) best-effort leállítás
  useEffect(() => {
    return () => {
      if (isHost && session && !endedRef.current) {
        endedRef.current = true;
        if (egressIdRef.current) {
          void stopLiveEgress(egressIdRef.current);
          egressIdRef.current = null;
        }
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
      {/* háttér: a WEBRTC-videó LAZY rétege (host → kamera-publish, néző → remote),
          Suspense (betöltés) + ErrorBoundary (hiányzó natív modul = barátságos panel,
          nem app-crash). A kompozíciót a `scene` jelenet-állapot hajtja. */}
      <View style={StyleSheet.absoluteFill}>
        {!self ? (
          <ConnectingStage hostAvatar={session.hostAvatar} note={t('live.connecting')} />
        ) : !WEBRTC_AVAILABLE ? (
          // nincs natív WebRTC (régi build) → meg SEM próbáljuk importálni a videó-
          // réteget (az @livekit a modul-tetején dobna) → barátságos üzenet
          <LiveVideoUnavailable
            liveId={String(id)}
            publish={isHost}
            name={self.name}
            userId={self.id}
            hostAvatar={session.hostAvatar}
            scene={scene}
          />
        ) : (
          <ErrorBoundary>
            <Suspense fallback={<ConnectingStage hostAvatar={session.hostAvatar} note={t('live.connecting')} />}>
              <LiveVideoStage
                liveId={String(id)}
                publish={isHost}
                name={self.name}
                userId={self.id}
                hostAvatar={session.hostAvatar}
                scene={scene}
                micMuted={micMuted}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </View>

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
          {/* 🎚️ host: élő mikrofon-némítás (LiveKit) */}
          {isHost && (
            <Pressable
              onPress={() => setMicMuted((v) => !v)}
              hitSlop={8}
              style={[styles.micBtn, micMuted && styles.micBtnOff]}
            >
              <Ionicons name={micMuted ? 'mic-off' : 'mic'} size={18} color="#fff" />
            </Pressable>
          )}
          <Pressable onPress={onEndOrLeave} hitSlop={10} style={styles.closeBtn}>
            <Text style={styles.closeText}>{isHost ? t('live.endLive') : t('live.leave')}</Text>
          </Pressable>
        </View>

        <Text style={styles.liveTitle} numberOfLines={2}>
          {session.title}
        </Text>

        {/* 🎥 host: élő jelenet-váltó (OBS-szerű), ha több jelenet van */}
        {isHost && hostScenes.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sceneSwitchRow}
            keyboardShouldPersistTaps="handled"
          >
            {hostScenes.map((sc) => {
              const on = sc.id === scene?.sceneId;
              return (
                <Pressable
                  key={sc.id}
                  onPress={() => switchScene(sc.id)}
                  style={[styles.sceneSwitchChip, on && styles.sceneSwitchChipOn]}
                >
                  <Text style={[styles.sceneSwitchText, on && styles.sceneSwitchTextOn]} numberOfLines={1}>
                    {sc.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

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

  connectingBg: { backgroundColor: '#140c24' },
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
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnOff: { backgroundColor: palette.danger },
  closeBtn: {
    marginLeft: 'auto',
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  closeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  liveTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 10, textShadowColor: '#000', textShadowRadius: 6 },

  sceneSwitchRow: { gap: 8, paddingVertical: 10 },
  sceneSwitchChip: {
    backgroundColor: '#00000066',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#ffffff22',
    maxWidth: 160,
  },
  sceneSwitchChipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  sceneSwitchText: { color: '#ffffffcc', fontSize: 13, fontWeight: '700' },
  sceneSwitchTextOn: { color: '#fff' },

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

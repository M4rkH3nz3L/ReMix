import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { goBackOrHome } from '@/lib/nav';
import { IS_WEB_VIEWER } from '@/lib/webGate';
import { Gesture } from 'react-native-gesture-handler';
import { LiveQuickGrid } from '@/components/live/LiveQuickGrid';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LiveChatPanel } from '@/components/live/session/LiveChatPanel';
import { LiveErrorBanner } from '@/components/live/session/LiveErrorBanner';
import { LiveSceneSwitcher } from '@/components/live/session/LiveSceneSwitcher';
import { FloatingHeart } from '@/components/live/session/LiveSessionStages';
import { LiveSessionTopBar } from '@/components/live/session/LiveSessionTopBar';
import { LiveVideoLayer } from '@/components/live/session/LiveVideoLayer';
import { createLiveChatActions, createLiveEndActions } from '@/components/live/session/liveSessionActions';
import {
  holdScreenAwake,
  openLiveSession,
  startHostHeartbeat,
  stopHostOnUnmount,
} from '@/components/live/session/liveSessionLifecycle';
import { palette } from '@/constants/editor';
import { encodeScenePayload, type ScenePayload } from '@/lib/liveComposite';
import {
  initialLiveState,
  isHostDevice,
  liveReducer,
  type EgressStatus,
  type LiveErrorCode,
} from '@/lib/liveState';
import {
  myUserId,
  type LiveChat,
  type LiveRoom,
  type LiveSelf,
  type LiveSession,
} from '@/lib/live';
import { sceneAfterSwipe, setActiveScene, toggleSourceVisible } from '@/lib/liveDoc';
import { appendLiveFloat, flipFacing, quickGridSources, showsEndedView, type LiveFloat } from '@/lib/liveSessionOps';
import type { LiveDoc } from '@/types/live';
import type { Project } from '@/types/project';

/**
 * 🔴 Az élő adás képernyője (a „Start streaming" után). REFACTOR: a részek a
 * src/components/live/session/ alatt — WebRTC-videó réteg (lazy), fejléc, hiba-sáv,
 * jelenet-váltó, chat; a kapcsolat-életciklus és a stream-konfiguráció (egress) hook
 * nélküli függvényei; az expo-mentes mag a src/lib/liveSessionOps.ts. A gyökér a hookokat
 * és az effekteket EREDETI sorrendben és függőségekkel tartja.
 */
export default function LiveRoomScreen() {
  const { t } = useTranslation();
  const { id, project: projectParam } = useLocalSearchParams<{ id: string; project?: string }>();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [viewers, setViewers] = useState(1);
  const [chat, setChat] = useState<LiveChat[]>([]);
  const [text, setText] = useState('');
  const [floats, setFloats] = useState<LiveFloat[]>([]);
  // 🔴 a saját identitás (a videó-token-szerzéshez a LiveVideoStage-ben)
  const [self, setSelf] = useState<LiveSelf | null>(null);
  // 🎥 a renderelendő jelenet-állapot (host: a saját live-docából; néző: a broadcastból)
  const [scene, setScene] = useState<ScenePayload | null>(null);
  // 🎥 host: a jelenet-lista az élő váltóhoz (a live-docból)
  const [hostScenes, setHostScenes] = useState<{ id: string; name: string }[]>([]);
  // 🎚️ host: mikrofon némítva (az élő mic-kontroll; a mixer kezdőértékéből)
  const [micMuted, setMicMuted] = useState(false);
  // 📷 host: a kamera iránya (a Studióból; adás közben váltható — L27)
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  // 🔴 host: az adás kezdetének ms-időbélyege a live-timerhez (0 = még nem él)
  const [liveStartMs, setLiveStartMs] = useState(0);
  // 🚦 az adás ÁLLAPOTGÉPE (L13) — a média-kapcsolat eseményei hajtják, nem a UI
  const [ls, dispatchLs] = useReducer(liveReducer, undefined, () => initialLiveState(0));
  // 📡 az egress (multistream / felhős felvétel) LÁTHATÓ állapota (L17 — eddig elnyelve)
  const [egress, setEgress] = useState<EgressStatus>({ state: 'off' });
  // újrapróbánál a videó-réteg újracsatlakozik (új kulcs → remount)
  const [stageKey, setStageKey] = useState(0);
  // a hosszú életű (session-) effekt a friss fordítót használja — nem indul újra nyelvváltáskor
  const tRef = useRef(t);
  tRef.current = t;
  const onConnection = useCallback((st: 'connected' | 'reconnecting' | 'disconnected') => {
    dispatchLs({ type: st === 'connected' ? 'CONNECTED' : 'DISCONNECTED', at: Date.now() });
  }, []);
  const onFatal = useCallback((code: LiveErrorCode) => {
    dispatchLs({ type: 'FAIL', at: Date.now(), error: code });
  }, []);
  // ⏱️ újracsatlakozás közben másodpercenként: az időkorlát után hiba (nem ragad „ÉLŐ"-ben)
  useEffect(() => {
    if (ls.phase !== 'reconnecting') return;
    const timer = setInterval(() => dispatchLs({ type: 'TICK', at: Date.now() }), 1000);
    return () => clearInterval(timer);
  }, [ls.phase]);

  const roomRef = useRef<LiveRoom | null>(null);
  const liveDocRef = useRef<LiveDoc | null>(null); // host: a live-produkció doc (Studio)
  const egressIdRef = useRef<string | null>(null); // host: a futó multistream-egress (Pro)
  const vodUrlRef = useRef<string | null>(null); // host: a felvett VOD URL-je (D158, ha van)
  const liveProjRef = useRef<Project | null>(null); // host: a live-produkció projektje (VOD-poszthoz)
  // 📼 az adás KEZDETÉNEK időbélyege → az adás végén az eltelt idő a VOD becsült
  //    hossza (a tényleges hosszt az editor a videó betöltésekor pontosítja). A
  //    Date.now() render-tiltott, ezért a stampet a session-betöltő effektben
  //    (nem renderben) állítjuk; 0 = még nem indult.
  const startStampRef = useRef(0);
  const endedRef = useRef(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const me = myUserId();
  // 🌐 weben nincs közvetítés (csak nézés) — a saját élőjét is nézőként látja
  const isHost = !IS_WEB_VIEWER && isHostDevice(session?.hostId, me ?? undefined, projectParam ? String(projectParam) : undefined);

  const addFloat = useCallback((emoji: string) => {
    // esemény-handler (nem render) → itt szabad a Math.random
    const fid = `${Date.now()}-${Math.random()}`;
    const x = (Math.random() - 0.5) * 60;
    setFloats((prev) => appendLiveFloat(prev, { id: fid, emoji, x }));
  }, []);

  // 🎥 a host kiküldi az aktív jelenetet (saját render + broadcast a nézőknek)
  const broadcastScene = useCallback(() => {
    const doc = liveDocRef.current;
    if (!doc) {
      return;
    }
    const payload = encodeScenePayload(doc);
    // a nézők a LiveKit adatcsatornán kapják (SceneDataPublisher, 3 mp-es heartbeattel a
    // késői csatlakozónak is) — a hamisítható nyilvános broadcastot már nem használjuk
    setScene(payload);
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

  // 🎛️ gombrács: a jelenet forrásai ki-be, azonnal a kimeneten
  const [gridOpen, setGridOpen] = useState(false);
  const toggleSource = useCallback(
    (sourceId: string) => {
      const doc = liveDocRef.current;
      const sceneId = doc?.activeSceneId;
      if (doc && sceneId) {
        liveDocRef.current = toggleSourceVisible(doc, sceneId, sourceId);
        broadcastScene();
      }
    },
    [broadcastScene]
  );
  // 👉 vízszintes húzás a képen: a szomszédos jelenet; a küszöb nagy, adás közben nem válthat véletlenül
  const swipe = useRef({ run: (_translationX: number) => {} });
  swipe.current.run = (translationX) => {
    const next = isHost ? sceneAfterSwipe(hostScenes, scene?.sceneId, translationX) : null;
    if (next) {
      switchScene(next);
    }
  };
  const sceneSwipe = useMemo(
    () =>
      Gesture.Pan()
        .withTestId('live-scene-swipe')
        .runOnJS(true)
        .activeOffsetX([-30, 30])
        .failOffsetY([-30, 30])
        .onEnd((e) => swipe.current.run(e.translationX)),
    []
  );

  // session betöltése + realtime room nyitása (🔌 liveSessionLifecycle)
  useEffect(
    () =>
      openLiveSession({
        id,
        projectParam,
        addFloat,
        broadcastScene,
        roomRef,
        liveDocRef,
        liveProjRef,
        startStampRef,
        endedRef,
        egressIdRef,
        vodUrlRef,
        tRef,
        setNotFound,
        setSession,
        setSelf,
        setChat,
        setViewers,
        setLiveStartMs,
        setHostScenes,
        setMicMuted,
        setFacing,
        setEgress,
        dispatchLs,
      }),
    [id, projectParam, addFloat, broadcastScene]
  );

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [chat.length]);

  const { onSendChat, onReact } = createLiveChatActions({ roomRef, text, setText });

  const { importVod, onEndOrLeave } = createLiveEndActions({
    isHost,
    session,
    projectParam,
    t,
    dispatchLs,
    endedRef,
    egressIdRef,
    vodUrlRef,
    liveProjRef,
    liveDocRef,
    startStampRef,
  });

  // host kilépéskor (unmount) best-effort leállítás
  useEffect(() => {
    return () => {
      stopHostOnUnmount({ isHost, session, projectParam, endedRef, egressIdRef, liveDocRef, importVod });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- az importVod a refekből dolgozik; a cleanup csak session/host-váltásra fusson újra
  }, [isHost, session, projectParam]);

  // 🔆 L36: adás közben a képernyő NEM zárolódik (különben az iOS leállítja a kamerát, a
  // session pedig fagyott képpel „élő" maradna)
  useEffect(() => {
    if (!isHost || !session) return;
    return holdScreenAwake();
  }, [isHost, session]);

  // 💓 L14: a host 30 mp-enként „él még" jelet küld (a szerveres sweep a jel nélküli,
  // beragadt sessiont lezárja; a „Most élő" lista csak a friss adásokat mutatja)
  useEffect(() => {
    if (!isHost || !session) return;
    return startHostHeartbeat(session.id, endedRef);
  }, [isHost, session]);

  // a néző: a befejezett / nem létező adás → „véget ért" nézet (nem végtelen „Kapcsolódás…")
  if (showsEndedView(notFound, isHost, ls)) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Ionicons name="radio-outline" size={48} color={palette.border} />
          <Text style={styles.endedText}>{t('live.ended')}</Text>
          <Pressable style={styles.leaveBtn} onPress={() => goBackOrHome()}>
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
      <LiveVideoLayer
        sceneSwipe={sceneSwipe}
        self={self}
        session={session}
        liveId={String(id)}
        isHost={isHost}
        scene={scene}
        stageKey={stageKey}
        micMuted={micMuted}
        facing={facing}
        setScene={setScene}
        onConnection={onConnection}
        onFatal={onFatal}
      />

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
        <LiveSessionTopBar
          session={session}
          viewers={viewers}
          ls={ls}
          isHost={isHost}
          egress={egress}
          liveStartMs={liveStartMs}
          gridOpen={gridOpen}
          setGridOpen={setGridOpen}
          micMuted={micMuted}
          setMicMuted={setMicMuted}
          setFacing={setFacing}
          onEndOrLeave={onEndOrLeave}
        />

        {/* 🚦 hiba-sáv: mi történt + mit tehet (újrapróba / befejezés) — nem ragad „ÉLŐ"-ben */}
        {ls.phase === 'error' ? (
          <LiveErrorBanner ls={ls} isHost={isHost} dispatchLs={dispatchLs} setStageKey={setStageKey} onEndOrLeave={onEndOrLeave} />
        ) : null}

        <Text style={styles.liveTitle} numberOfLines={2}>
          {session.title}
        </Text>

        {/* 🎥 host: élő jelenet-váltó (OBS-szerű), ha több jelenet van */}
        {isHost && hostScenes.length > 1 && (
          <LiveSceneSwitcher hostScenes={hostScenes} activeSceneId={scene?.sceneId} switchScene={switchScene} />
        )}

        {isHost && gridOpen && liveDocRef.current ? (
          <LiveQuickGrid
            sources={quickGridSources(liveDocRef.current)}
            micMuted={micMuted}
            onToggle={toggleSource}
            onMic={() => setMicMuted((v) => !v)}
            onFlip={() => setFacing((f) => flipFacing(f))}
          />
        ) : null}

        <View style={{ flex: 1 }} />

        {/* chat + reakciók */}
        <LiveChatPanel
          scrollRef={scrollRef}
          chat={chat}
          text={text}
          setText={setText}
          onSendChat={onSendChat}
          onReact={onReact}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  endedText: { color: palette.textDim, fontSize: 16, fontWeight: '700' },

  floatLayer: { position: 'absolute', right: 24, bottom: 160, width: 80, height: 320 },

  overlay: { flex: 1, paddingHorizontal: 14 },
  liveTitle: { color: '#fff', fontSize: 16, fontWeight: '700', marginTop: 10, textShadowColor: '#000', textShadowRadius: 6 },

  leaveBtn: { backgroundColor: palette.surface, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  leaveText: { color: palette.text, fontSize: 14, fontWeight: '700' },
});

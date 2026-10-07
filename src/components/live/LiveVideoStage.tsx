import { Ionicons } from '@expo/vector-icons';
import { LiveKitRoom, useLocalParticipant } from '@livekit/react-native';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { LiveComposite } from '@/components/live/LiveComposite';
import { palette } from '@/constants/editor';
import { sceneHasVisible, type ScenePayload } from '@/lib/liveComposite';
import { ensureLiveKit, fetchLiveToken } from '@/lib/livekit';

/**
 * 🔴 A LiveKit-videó (WebRTC) rétege — MINDEN WebRTC-függő import ide van szigetelve
 * (@livekit/react-native, LiveComposite, livekit.ts). A szülő (`live/[id].tsx`) ezt
 * `React.lazy`-vel tölti → az expo-router indulási route-validációja NEM tölti be a
 * natív WebRTC-modult, így egy WebRTC nélküli build sem dönti el az egész appot
 * induláskor (csak itt, a tényleges belépéskor, amit ErrorBoundary kezel).
 *
 * Maga a token-szerzés + kamera/mikrofon-engedély is itt fut (host = publish). A
 * jelenet-állapotot (`scene`) a szülő adja (host: saját live-docból; néző: broadcast).
 */
export interface LiveVideoStageProps {
  liveId: string;
  publish: boolean;
  name: string;
  userId: string;
  hostAvatar: string | null;
  scene: ScenePayload | null;
  /** 🎚️ a host mikrofonja némítva (az élő audio-mixerből; csak publish esetén él). */
  micMuted?: boolean;
}

/** A host mikrofon-némítás alkalmazása a LiveKitre (a <LiveKitRoom>-on BELÜL). */
function MicControl({ muted }: { muted: boolean }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    // Ugyanaz a race, mint a SceneDataPublisher-ben: a setMicrophoneEnabled aszinkron,
    // és a room (még nem / már nem) kész állapotában elutasíthat → kezeljük a rejectiont.
    const p = localParticipant?.setMicrophoneEnabled(!muted);
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  }, [localParticipant, muted]);
  return null;
}

/**
 * 🖥️ F5 — natív képernyő-megosztás. Ha a host aktív jelenetében LÁTHATÓ `screen`
 * forrás van, elindítjuk a natív capture-t (Android: MediaProjection + foreground
 * service a LiveKit-pluginból; iOS: in-app RPScreenRecorder — a teljes Broadcast
 * Upload Extension külön natív target, go-live lépés). A hibát (pl. a user megszakítja
 * az OS-promptot) elnyeljük, hogy ne dőljön el a room.
 */
function ScreenShareControl({ wantScreen }: { wantScreen: boolean }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    const p = localParticipant?.setScreenShareEnabled(wantScreen);
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
  }, [localParticipant, wantScreen]);
  return null;
}

/**
 * 📡 168 — a host a jelenet-állapotot a LiveKit **data-channelen** is broadcastolja
 * (`topic='scene'`), hogy az **egress web-layout template** (egy rejtett LiveKit-
 * résztvevő a szerveroldali kompozitorban) UGYANAZT a `ScenePayload`-ot lássa, mint
 * az in-app nézők (akik a Supabase-realtime-on kapják). EGY modell, két renderelő.
 * Azonnal publikál változáskor + 3 mp-es heartbeat, hogy a KÉSŐBB csatlakozó egress
 * is megkapja a legfrissebb jelenetet. Best-effort (hiba nem dönti el a room-ot).
 */
function SceneDataPublisher({ scene }: { scene: ScenePayload | null }) {
  const { localParticipant } = useLocalParticipant();
  const sceneRef = useRef<ScenePayload | null>(scene);
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);
  useEffect(() => {
    const send = () => {
      const p = localParticipant;
      const s = sceneRef.current;
      if (!p || !s || typeof TextEncoder === 'undefined') {
        return;
      }
      try {
        const bytes = new TextEncoder().encode(JSON.stringify(s));
        // A publishData ASZINKRON: ha a room épp (még nem / már nem) kapcsolódik — pl.
        // „PC manager is closed" belépéskor vagy teardownkor —, a Promise ELUTASÍT. A
        // sync try/catch ezt NEM fogja el → a rejectiont külön kell kezelni (best-effort),
        // mint a ScreenShareControl-ban, különben „Uncaught (in promise)".
        const pub = p.publishData(bytes, { reliable: true, topic: 'scene' });
        if (pub && typeof pub.catch === 'function') {
          pub.catch(() => {});
        }
      } catch {
        // best-effort — az in-app nézők úgyis a Supabase-realtime-on kapják a jelenetet
      }
    };
    send();
    const timer = setInterval(send, 3000);
    return () => clearInterval(timer);
  }, [localParticipant, scene]);
  return null;
}

export default function LiveVideoStage({
  liveId,
  publish,
  name,
  userId,
  hostAvatar,
  scene,
  micMuted,
}: LiveVideoStageProps) {
  const { t } = useTranslation();
  const [, requestCam] = useCameraPermissions();
  const [, requestMic] = useMicrophonePermissions();
  const [lk, setLk] = useState<{ token: string; url: string } | null>(null);
  // 🔁 a token-szerzés ÚJRAPRÓBÁL (capped backoff), ahogy az OBS is folyamatosan
  // próbál csatlakozni: ha a worker épp nem elérhető (dev-stack indul, hálózat
  // pislákol), a „Kapcsolódás…" NEM ragad be némán — amint a `/live/token` válaszol,
  // belépünk a szobába. Pár sikertelen próba után „Újracsatlakozás…"-ra váltunk.
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const attemptFetch = async () => {
      if (!active) {
        return;
      }
      const tok = await fetchLiveToken(liveId, publish, name, userId).catch(() => null);
      if (!active) {
        return;
      }
      if (tok) {
        setRetrying(false);
        setLk(tok);
        return;
      }
      attempt += 1;
      setRetrying(attempt >= 2);
      // 1s → 2s → 4s → … → max 8s; folyamatosan próbál, amíg a stage mountolva van
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      timer = setTimeout(attemptFetch, backoff);
    };
    (async () => {
      ensureLiveKit();
      if (publish) {
        await requestCam();
        await requestMic();
      }
      await attemptFetch();
    })();
    return () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [liveId, publish, name, userId, requestCam, requestMic]);

  if (!lk) {
    return (
      <LinearGradient colors={['#1a1030', '#0c0d12']} style={StyleSheet.absoluteFill}>
        <View style={styles.center}>
          {hostAvatar ? (
            <Image source={{ uri: hostAvatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Ionicons name="person" size={48} color={palette.textDim} />
            </View>
          )}
          <Text style={styles.note}>{t(retrying ? 'live.reconnecting' : 'live.connecting')}</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <LiveKitRoom serverUrl={lk.url} token={lk.token} connect audio={publish} video={publish}>
        <LiveComposite payload={scene} hostAvatar={hostAvatar} />
        {publish && <MicControl muted={micMuted ?? false} />}
        {publish && <ScreenShareControl wantScreen={scene ? sceneHasVisible(scene, 'screen') : false} />}
        {publish && <SceneDataPublisher scene={scene} />}
      </LiveKitRoom>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  avatar: { width: 110, height: 110, borderRadius: 55, backgroundColor: palette.surface },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  note: { color: '#ffffff99', fontSize: 13 },
});

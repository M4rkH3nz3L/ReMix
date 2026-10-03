import { Ionicons } from '@expo/vector-icons';
import { LiveKitRoom } from '@livekit/react-native';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { LiveComposite } from '@/components/live/LiveComposite';
import { palette } from '@/constants/editor';
import type { ScenePayload } from '@/lib/liveComposite';
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
export default function LiveVideoStage({
  liveId,
  publish,
  name,
  userId,
  hostAvatar,
  scene,
}: {
  liveId: string;
  publish: boolean;
  name: string;
  userId: string;
  hostAvatar: string | null;
  scene: ScenePayload | null;
}) {
  const { t } = useTranslation();
  const [, requestCam] = useCameraPermissions();
  const [, requestMic] = useMicrophonePermissions();
  const [lk, setLk] = useState<{ token: string; url: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      ensureLiveKit();
      if (publish) {
        await requestCam();
        await requestMic();
      }
      const tok = await fetchLiveToken(liveId, publish, name, userId).catch(() => null);
      if (active && tok) {
        setLk(tok);
      }
    })();
    return () => {
      active = false;
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
          <Text style={styles.note}>{t('live.connecting')}</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <LiveKitRoom serverUrl={lk.url} token={lk.token} connect audio={publish} video={publish}>
        <LiveComposite payload={scene} hostAvatar={hostAvatar} />
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

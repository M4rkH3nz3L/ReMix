import { Suspense, lazy, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeModules, StyleSheet, View } from 'react-native';
import { GestureDetector, type GestureType } from 'react-native-gesture-handler';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import type { LiveErrorCode } from '@/lib/liveState';
import type { LiveSelf, LiveSession } from '@/lib/live';
import type { ScenePayload } from '@/lib/liveComposite';
// type-only (erased runtime-ban → NEM húzza be a WebRTC-t)
import type { LiveVideoStageProps } from '@/components/live/LiveVideoStage';
import { logCaught } from '@/lib/logCaught';

import { ConnectingStage, LiveVideoUnavailable } from './LiveSessionStages';

/**
 * Az élő adás háttere: a WebRTC-videó LAZY rétege a jelenet-húzás gesztussal (REFACTOR:
 * a src/app/live/[id].tsx-ből — a lazy betöltés, a WebRTC-őr és a logCaught-címke változatlan).
 */

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
  } catch (caught) {
    logCaught('app/live/[id].tsx:LiveVideoStage', caught);
    // a natív WebRTC-modul hiányzik (régi build) → fallback (lentebb)
  }
  // MINDIG valid komponenst adunk vissza (sosem `undefined` → nincs „invalid element type")
  return { default: LiveVideoUnavailable };
});

export interface LiveVideoLayerProps {
  sceneSwipe: GestureType;
  self: LiveSelf | null;
  session: LiveSession;
  liveId: string;
  isHost: boolean;
  scene: ScenePayload | null;
  stageKey: number;
  micMuted: boolean;
  facing: 'front' | 'back';
  setScene: (payload: ScenePayload) => void;
  onConnection: (st: 'connected' | 'reconnecting' | 'disconnected') => void;
  onFatal: (code: LiveErrorCode) => void;
}

export function LiveVideoLayer({
  sceneSwipe,
  self,
  session,
  liveId,
  isHost,
  scene,
  stageKey,
  micMuted,
  facing,
  setScene,
  onConnection,
  onFatal,
}: LiveVideoLayerProps) {
  const { t } = useTranslation();
  return (
      <GestureDetector gesture={sceneSwipe}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        {!self ? (
          <ConnectingStage hostAvatar={session.hostAvatar} note={t('live.connecting')} />
        ) : !WEBRTC_AVAILABLE ? (
          // nincs natív WebRTC (régi build) → meg SEM próbáljuk importálni a videó-
          // réteget (az @livekit a modul-tetején dobna) → barátságos üzenet
          <LiveVideoUnavailable
            liveId={liveId}
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
                key={stageKey}
                liveId={liveId}
                publish={isHost}
                name={self.name}
                userId={self.id}
                hostAvatar={session.hostAvatar}
                scene={scene}
                micMuted={micMuted}
                hostId={session.hostId}
                onScene={setScene}
                onConnection={onConnection}
                onFatal={onFatal}
                facing={facing}
              />
            </Suspense>
          </ErrorBoundary>
        )}
      </View>
      </GestureDetector>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { formatLiveElapsed, liveElapsedSeconds } from '@/lib/liveSessionOps';
// type-only (erased runtime-ban → NEM húzza be a WebRTC-t)
import type { LiveVideoStageProps } from '@/components/live/LiveVideoStage';

/**
 * Az élő adás képernyőjének kis renderelő részei (REFACTOR: a src/app/live/[id].tsx-ből):
 * felúszó reakció, kapcsolódás-placeholder, WebRTC-hiány fallback, live-timer.
 */

/** Egy felúszó reakció-emoji (2 mp alatt felfelé + elhalványul). Az `x` drift az
 * esemény-handlerben készül (nem renderben), hogy ne hívjunk impure fn-t render közben. */
export function FloatingHeart({ emoji, x, onDone }: { emoji: string; x: number; onDone: () => void }) {
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
export function ConnectingStage({ hostAvatar, note }: { hostAvatar: string | null; note: string }) {
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
export function LiveVideoUnavailable({ hostAvatar }: LiveVideoStageProps) {
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

/** 🔴 Élő-időzítő: mióta tart az adás (host). Másodpercenként ketyeg; a `Date.now()`
 * CSAK az intervallum-callbackben fut (nem renderben), az elapsed state-ben tárolt. */
export function LiveTimer({ startMs }: { startMs: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startMs) {
      return;
    }
    const tick = () => setElapsed(liveElapsedSeconds(startMs, Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startMs]);
  const text = formatLiveElapsed(elapsed);
  return <Text style={styles.liveTimer}>{text}</Text>;
}

const styles = StyleSheet.create({
  connectingBg: { backgroundColor: '#140c24' },
  viewerStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  viewerAvatar: { width: 110, height: 110, borderRadius: 55, backgroundColor: palette.surface },
  viewerAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  viewerNote: { color: '#ffffff99', fontSize: 13 },

  floatEmoji: { position: 'absolute', bottom: 0, right: 0, fontSize: 30 },

  liveTimer: { color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

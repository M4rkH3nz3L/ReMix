import { Ionicons } from '@expo/vector-icons';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import type { LiveSession } from '@/lib/live';
import { flipFacing } from '@/lib/liveSessionOps';
import { isOnAir, type EgressStatus, type LiveState } from '@/lib/liveState';

import { LiveTimer } from './LiveSessionStages';

/**
 * Az élő adás fejléce (REFACTOR: a src/app/live/[id].tsx-ből): host + nézőszám, a kapcsolat
 * és az egress (multistream / felvétel) állapota, live-timer, a host élő kontrolljai, bezárás.
 */

export interface LiveSessionTopBarProps {
  session: LiveSession;
  viewers: number;
  ls: LiveState;
  isHost: boolean;
  egress: EgressStatus;
  liveStartMs: number;
  gridOpen: boolean;
  setGridOpen: Dispatch<SetStateAction<boolean>>;
  micMuted: boolean;
  setMicMuted: Dispatch<SetStateAction<boolean>>;
  setFacing: Dispatch<SetStateAction<'front' | 'back'>>;
  onEndOrLeave: () => Promise<void>;
}

export function LiveSessionTopBar({
  session,
  viewers,
  ls,
  isHost,
  egress,
  liveStartMs,
  gridOpen,
  setGridOpen,
  micMuted,
  setMicMuted,
  setFacing,
  onEndOrLeave,
}: LiveSessionTopBarProps) {
  const { t } = useTranslation();
  return (
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
          {/* 🚦 a kapcsolat valós állapota (nem ragad „ÉLŐ"-ben) */}
          {ls.phase === 'connecting' || ls.phase === 'reconnecting' ? (
            <View style={[styles.stateChip, ls.phase === 'reconnecting' && styles.stateChipWarn]} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color="#fff" />
              <Text style={styles.stateChipText}>{t(`live.state.${ls.phase}`)}</Text>
            </View>
          ) : null}
          {/* 📡 host: multistream / felvétel állapota */}
          {isHost && egress.state !== 'off' ? (
            <Pressable
              onPress={() =>
                egress.state === 'failed' ? Alert.alert(t('live.egress.title'), t(`live.egress.reason_${egress.reason}`)) : undefined
              }
              style={[styles.stateChip, egress.state === 'failed' && styles.stateChipWarn]}
              accessibilityRole="button"
              accessibilityLabel={t('live.egress.title')}
            >
              <Ionicons name={egress.state === 'failed' ? 'alert-circle' : 'radio'} size={14} color="#fff" />
              <Text style={styles.stateChipText}>
                {egress.state === 'starting'
                  ? t('live.egress.starting')
                  : egress.state === 'failed'
                    ? t('live.egress.failed')
                    : egress.recording && egress.destinations === 0
                      ? t('live.egress.recording')
                      : t('live.egress.on', { count: egress.destinations })}
              </Text>
            </Pressable>
          ) : null}
          {/* 🔴 host: mióta tart az adás (live-timer) — csak ha TÉNYLEG élőben vagyunk */}
          {isHost && liveStartMs > 0 && isOnAir(ls) && (
            <View style={styles.timerChip}>
              <View style={styles.liveDot} />
              <LiveTimer startMs={liveStartMs} />
            </View>
          )}
          {/* 🎛️ host: érintős gombrács */}
          {isHost && (
            <Pressable
              testID="live-grid-toggle"
              onPress={() => setGridOpen((v) => !v)}
              hitSlop={8}
              style={[styles.micBtn, gridOpen && styles.micBtnOn]}
              accessibilityRole="button"
              accessibilityLabel={t('live.quick.title')}
            >
              <Ionicons name="apps" size={18} color="#fff" />
            </Pressable>
          )}
          {/* 📷 host: kamera-váltás adás közben (L27) */}
          {isHost && (
            <Pressable
              onPress={() => setFacing((f) => flipFacing(f))}
              hitSlop={8}
              style={styles.micBtn}
              accessibilityRole="button"
              accessibilityLabel={t('live.flipCamera')}
            >
              <Ionicons name="camera-reverse" size={18} color="#fff" />
            </Pressable>
          )}
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
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  stateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: '#00000088',
  },
  stateChipWarn: { backgroundColor: '#b26a00cc' },
  stateChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
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
  timerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#00000066',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: '#00000066',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnOff: { backgroundColor: palette.danger },
  micBtnOn: { backgroundColor: palette.accent },
  closeBtn: {
    marginLeft: 'auto',
    backgroundColor: palette.danger,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  closeText: { color: '#fff', fontSize: 13, fontWeight: '800' },
});

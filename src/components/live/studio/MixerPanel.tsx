import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CHANNEL_ICON, GAIN_STEP } from '@/components/live/studio/liveStudioConstants';
import { shared } from '@/components/live/studio/liveStudioStyles';
import { palette } from '@/constants/editor';
import {
  MAX_DB,
  MIN_DB,
  setChannelGainDb,
  setMasterGainDb,
  toggleAutoDuck,
  toggleMute as mixerToggleMute,
  toggleSolo as mixerToggleSolo,
} from '@/lib/liveMixer';
import { formatGainDb, gainLevel, levelWidth } from '@/lib/liveStudioOps';
import type { LiveDoc, LiveMixer } from '@/types/live';

export interface MixerPanelProps {
  live: LiveDoc;
  commitMixer: (nextMixer: LiveMixer) => void;
}

/** 🎚️ audio-mixer: csatornánként erősítés / némítás / szóló, master, auto-duck */
export function MixerPanel({ live, commitMixer }: MixerPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* 🎚️ audio-mixer */}
      {live.mixer && (
        <>
          <View style={shared.rowBetween}>
            <Text style={shared.sectionLabel}>{t('live.studio.mixer', { defaultValue: 'Audio mixer' })}</Text>
            <Pressable
              onPress={() => commitMixer(toggleAutoDuck(live.mixer!))}
              style={[styles.duckChip, live.mixer.autoDuck && styles.duckChipOn]}
              hitSlop={6}
            >
              <Ionicons name="trending-down" size={13} color={live.mixer.autoDuck ? '#fff' : palette.textDim} />
              <Text style={[styles.duckText, live.mixer.autoDuck && styles.duckTextOn]}>Auto-duck</Text>
            </Pressable>
          </View>

          {live.mixer.channels.map((ch) => {
            const level = gainLevel(ch.gainDb, MIN_DB, MAX_DB); // 0..1 a sáv-vizualizációhoz
            return (
              <View key={ch.id} style={styles.mixRow}>
                <Ionicons name={CHANNEL_ICON[ch.id]} size={16} color={palette.textDim} />
                <Text style={styles.mixLabel}>{ch.label}</Text>
                <View style={styles.mixBarTrack}>
                  <View style={[styles.mixBarFill, { width: levelWidth(level) }, ch.mute && styles.mixBarMuted]} />
                </View>
                <Pressable onPress={() => commitMixer(setChannelGainDb(live.mixer!, ch.id, ch.gainDb - GAIN_STEP))} hitSlop={6} style={styles.mixStep}>
                  <Ionicons name="remove" size={16} color={palette.text} />
                </Pressable>
                <Text style={styles.mixDb}>{formatGainDb(ch.gainDb)}</Text>
                <Pressable onPress={() => commitMixer(setChannelGainDb(live.mixer!, ch.id, ch.gainDb + GAIN_STEP))} hitSlop={6} style={styles.mixStep}>
                  <Ionicons name="add" size={16} color={palette.text} />
                </Pressable>
                <Pressable onPress={() => commitMixer(mixerToggleMute(live.mixer!, ch.id))} hitSlop={6} style={[styles.msBtn, ch.mute && styles.mBtnOn]}>
                  <Text style={[styles.msText, ch.mute && styles.msTextOn]}>M</Text>
                </Pressable>
                <Pressable onPress={() => commitMixer(mixerToggleSolo(live.mixer!, ch.id))} hitSlop={6} style={[styles.msBtn, ch.solo && styles.sBtnOn]}>
                  <Text style={[styles.msText, ch.solo && styles.msTextOn]}>S</Text>
                </Pressable>
              </View>
            );
          })}

          <View style={styles.mixRow}>
            <Ionicons name="options" size={16} color={palette.accent} />
            <Text style={[styles.mixLabel, { color: palette.accent }]}>Master</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => commitMixer(setMasterGainDb(live.mixer!, live.mixer!.masterGainDb - GAIN_STEP))} hitSlop={6} style={styles.mixStep}>
              <Ionicons name="remove" size={16} color={palette.text} />
            </Pressable>
            <Text style={styles.mixDb}>{formatGainDb(live.mixer!.masterGainDb)}</Text>
            <Pressable onPress={() => commitMixer(setMasterGainDb(live.mixer!, live.mixer!.masterGainDb + GAIN_STEP))} hitSlop={6} style={styles.mixStep}>
              <Ionicons name="add" size={16} color={palette.text} />
            </Pressable>
          </View>
          <Text style={shared.hint}>{t('live.studio.mixerHint', { defaultValue: 'Mic mute is live. Music/media/system mixing lands with native audio (soon).' })}</Text>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  duckChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  duckChipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  duckText: { color: palette.textDim, fontSize: 12, fontWeight: '800' },
  duckTextOn: { color: '#fff' },
  mixRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mixLabel: { color: palette.text, fontSize: 13, fontWeight: '700', width: 58 },
  mixBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.bg, overflow: 'hidden' },
  mixBarFill: { height: 6, borderRadius: 3, backgroundColor: palette.accent },
  mixBarMuted: { backgroundColor: palette.textDim },
  mixStep: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mixDb: { color: palette.text, fontSize: 12, fontWeight: '800', width: 32, textAlign: 'center' },
  msBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: palette.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mBtnOn: { backgroundColor: palette.danger },
  sBtnOn: { backgroundColor: '#f0a022' },
  msText: { color: palette.textDim, fontSize: 12, fontWeight: '900' },
  msTextOn: { color: '#fff' },
});

import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { formatTime } from '@/lib/time';
import { getWaveform, type WaveformData } from '@/lib/waveform';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Clip } from '@/types/project';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** fade-boríték (ugyanaz, mint az AudioLayer/render): 0–1 szorzó az adott időben */
function fadeFactor(t: number, dur: number, fi: number, fo: number): number {
  let f = 1;
  if (fi > 0) {
    f = Math.min(f, clamp(t / fi, 0, 1));
  }
  if (fo > 0) {
    f = Math.min(f, clamp((dur - t) / fo, 0, 1));
  }
  return f;
}

/**
 * 🎧 Hang Stúdió — teljes képernyős, MOBILRA optimalizált audio-szerkesztő.
 *
 * A gyakori műveletek (hangerő, be-/kifedés, hossz-vágás, hang-javítás) AZ
 * ESZKÖZÖN, worker nélkül: az élő előnézet `expo-audio`-val szól, a szerkesztés
 * NEM-destruktív (a klip mezőit állítja `mutateProject`-en át → undo), és a
 * végleges keverés a (szintén eszközön futó) renderben történik. Így az
 * előnézet és az export egyezik, és nem kell külön hang-appot nyitni.
 */
export function HangStudio() {
  const clip = useEditorStore((s) => {
    if (!s.project || !s.audioStudioClipId) {
      return null;
    }
    for (const track of s.project.tracks) {
      const found = track.clips.find((c: Clip) => c.id === s.audioStudioClipId);
      if (found) {
        return found;
      }
    }
    return null;
  });
  const close = useEditorStore((s) => s.closeAudioStudio);
  const open = clip?.kind === 'audio';

  return (
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      {/* saját SafeAreaProvider — a Modal külön natív ablak (lásd Kép Stúdió) */}
      {open ? (
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <HangStudioSession key={clip.id} clip={clip} onClose={close} />
        </SafeAreaProvider>
      ) : null}
    </Modal>
  );
}

function HangStudioSession({ clip, onClose }: { clip: AudioClip; onClose: () => void }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);

  const [volume, setVolume] = useState(clip.volume);
  const [fadeIn, setFadeIn] = useState(clip.fadeIn);
  const [fadeOut, setFadeOut] = useState(clip.fadeOut);
  const [duration, setDuration] = useState(clip.duration);
  const [voiceEnhance, setVoiceEnhance] = useState(!!clip.voiceEnhance);
  const [deReverb, setDeReverb] = useState(!!clip.deReverb);
  const [autoDuck, setAutoDuck] = useState(!!clip.autoDuck);

  const maxDuration = clip.duration; // forrás-hossz nélkül csak rövidíteni tudunk
  const maxFade = Math.min(5, duration / 2);

  // 🎵 on-device hullámforma (react-native-audio-api dekódolás, worker nélkül)
  const [wave, setWave] = useState<WaveformData | null>(null);
  useEffect(() => {
    let alive = true;
    getWaveform(clip.uri)
      .then((w) => {
        if (alive) {
          setWave(w);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [clip.uri]);

  const player = useAudioPlayer({ uri: clip.uri });
  const status = useAudioPlayerStatus(player);
  const playing = status.playing;
  const currentTime = status.currentTime ?? 0;

  // élő előnézet: hangerő + fade-boríték követése; a vágott hossznál megállunk
  useEffect(() => {
    try {
      if (playing && currentTime >= duration - 0.02) {
        player.pause();
        player.seekTo(0).catch(() => {});
        return;
      }
      player.volume = volume * (playing ? fadeFactor(currentTime, duration, fadeIn, fadeOut) : 1);
    } catch {
      // a lejátszó lehet még nem áll készen — a következő tick újrapróbálja
    }
  }, [player, playing, currentTime, volume, fadeIn, fadeOut, duration]);

  // a modal bezárásakor álljon le a hang
  useEffect(() => {
    return () => {
      try {
        player.pause();
      } catch {
        // best-effort
      }
    };
  }, [player]);

  const togglePlay = () => {
    try {
      if (playing) {
        player.pause();
      } else {
        if (currentTime >= duration - 0.02) {
          player.seekTo(0).catch(() => {});
        }
        player.play();
      }
    } catch {
      // ignoráljuk — a gomb újranyomható
    }
  };

  const dirty =
    volume !== clip.volume ||
    fadeIn !== clip.fadeIn ||
    fadeOut !== clip.fadeOut ||
    duration !== clip.duration ||
    voiceEnhance !== !!clip.voiceEnhance ||
    deReverb !== !!clip.deReverb ||
    autoDuck !== !!clip.autoDuck;

  const onReset = () => {
    setVolume(clip.volume);
    setFadeIn(clip.fadeIn);
    setFadeOut(clip.fadeOut);
    setDuration(clip.duration);
    setVoiceEnhance(!!clip.voiceEnhance);
    setDeReverb(!!clip.deReverb);
    setAutoDuck(!!clip.autoDuck);
  };

  const onDone = () => {
    if (dirty) {
      updateClip(clip.id, {
        volume,
        fadeIn: Math.min(fadeIn, duration),
        fadeOut: Math.min(fadeOut, duration),
        duration,
        voiceEnhance,
        deReverb,
        autoDuck,
      } as Partial<AudioClip>);
    }
    onClose();
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.topBtn}>
          <Ionicons name="close" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {clip.label || t('hangStudio.title')}
        </Text>
        <Pressable onPress={onReset} hitSlop={10} style={styles.topBtn} disabled={!dirty}>
          <Text style={[styles.resetText, !dirty && styles.dim]}>{t('common.reset')}</Text>
        </Pressable>
        <Pressable onPress={onDone} hitSlop={10} style={styles.doneBtn}>
          <Ionicons name="checkmark" size={18} color="#fff" />
          <Text style={styles.doneText}>{t('common.done')}</Text>
        </Pressable>
      </View>

      <RegionBar
        duration={duration}
        maxDuration={maxDuration}
        fadeIn={fadeIn}
        fadeOut={fadeOut}
        playhead={currentTime}
        peaks={wave?.peaks ?? null}
        waveDuration={wave?.duration ?? maxDuration}
        onTrim={(d) => {
          setDuration(d);
          setFadeIn((v) => Math.min(v, d / 2));
          setFadeOut((v) => Math.min(v, d / 2));
        }}
      />

      <View style={styles.transport}>
        <Pressable onPress={togglePlay} style={styles.playBtn}>
          <Ionicons name={playing ? 'pause' : 'play'} size={26} color="#fff" />
        </Pressable>
        <Text style={styles.time}>
          {formatTime(Math.min(currentTime, duration))} / {formatTime(duration)}
        </Text>
      </View>

      <View style={styles.controls}>
        <Slider
          label={t('hangStudio.volume')}
          value={volume}
          min={0}
          max={1}
          onChange={setVolume}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label={t('hangStudio.fadeIn')}
          value={fadeIn}
          min={0}
          max={maxFade}
          onChange={setFadeIn}
          format={(v) => `${v.toFixed(1)}s`}
        />
        <Slider
          label={t('hangStudio.fadeOut')}
          value={fadeOut}
          min={0}
          max={maxFade}
          onChange={setFadeOut}
          format={(v) => `${v.toFixed(1)}s`}
        />

        <ToggleRow
          icon="sparkles-outline"
          label={t('hangStudio.enhance')}
          value={voiceEnhance}
          onValueChange={setVoiceEnhance}
        />
        <ToggleRow
          icon="mic-outline"
          label={t('hangStudio.deReverb')}
          value={deReverb}
          onValueChange={setDeReverb}
        />
        <ToggleRow
          icon="volume-low-outline"
          label={t('hangStudio.autoDuck')}
          value={autoDuck}
          onValueChange={setAutoDuck}
        />
        <Text style={styles.hint}>{t('hangStudio.enhanceHint')}</Text>
      </View>
    </SafeAreaView>
  );
}

const REGION_H = 96;

function RegionBar({
  duration,
  maxDuration,
  fadeIn,
  fadeOut,
  playhead,
  peaks,
  waveDuration,
  onTrim,
}: {
  duration: number;
  maxDuration: number;
  fadeIn: number;
  fadeOut: number;
  playhead: number;
  peaks: number[] | null;
  waveDuration: number;
  onTrim: (d: number) => void;
}) {
  const [w, setW] = useState(0);
  const wRef = useRef(w);
  wRef.current = w;
  const durRef = useRef(duration);
  durRef.current = duration;
  const cbRef = useRef(onTrim);
  cbRef.current = onTrim;
  const startRef = useRef(duration);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = durRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const full = Math.max(1, wRef.current);
        const d = startRef.current + (g.dx / full) * maxDuration;
        cbRef.current(clamp(Math.round(d * 10) / 10, 0.5, maxDuration));
      },
    })
  ).current;

  const frac = maxDuration > 0 ? duration / maxDuration : 1;
  const regionW = frac * w;
  const fiW = duration > 0 ? (fadeIn / duration) * regionW : 0;
  const foW = duration > 0 ? (fadeOut / duration) * regionW : 0;
  const phX = duration > 0 ? clamp(playhead / duration, 0, 1) * regionW : 0;

  // a valódi hullámforma-oszlopok (memoizált — a playhead mozgása nem építi újra)
  const waveBars = useMemo(() => {
    if (!peaks || peaks.length === 0 || w <= 0) {
      return null;
    }
    const cols = Math.max(1, Math.floor(w / 3));
    const barW = w / cols;
    const items: ReactElement[] = [];
    for (let i = 0; i < cols; i++) {
      const t0 = (i / cols) * maxDuration;
      const idx = waveDuration > 0 ? Math.floor((t0 / waveDuration) * peaks.length) : 0;
      const v = peaks[Math.min(peaks.length - 1, Math.max(0, idx))] ?? 0;
      const active = (i + 0.5) * barW <= regionW;
      items.push(
        <View
          key={i}
          style={{
            width: Math.max(1, barW - 1),
            height: Math.max(2, v * (REGION_H * 0.82)),
            borderRadius: 1,
            backgroundColor: active ? palette.accent : palette.border,
          }}
        />
      );
    }
    return <View style={styles.waveRow}>{items}</View>;
  }, [peaks, w, regionW, maxDuration, waveDuration]);

  return (
    <View style={styles.regionWrap} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <View style={styles.regionTrack}>
        {/* valódi hullámforma, vagy sima régió amíg dekódol */}
        {waveBars ?? <View style={[styles.region, { width: regionW }]} />}
        {/* fade be-/kifedés */}
        {fiW > 1 ? <View style={[styles.fade, { left: 0, width: fiW }]} /> : null}
        {foW > 1 ? <View style={[styles.fade, { left: Math.max(0, regionW - foW), width: foW }]} /> : null}
        {/* levágott (inaktív) rész sötétítése */}
        {frac < 1 ? <View style={[styles.regionCut, { left: regionW, width: w - regionW }]} /> : null}
        {/* playhead */}
        <View style={[styles.playhead, { left: phX }]} />
        {/* vég-fogó (hossz-vágás) */}
        <View style={[styles.trimHandle, { left: Math.max(0, regionW - 11) }]} {...pan.panHandlers}>
          <View style={styles.trimGrip} />
        </View>
      </View>
    </View>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  const [w, setW] = useState(0);
  const wRef = useRef(w);
  wRef.current = w;
  const vRef = useRef(value);
  vRef.current = value;
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const rangeRef = useRef({ min, max });
  rangeRef.current = { min, max };
  const startRef = useRef(value);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = vRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const { min: lo, max: hi } = rangeRef.current;
        const tw = Math.max(1, wRef.current - 22);
        const d = (g.dx / tw) * (hi - lo);
        const v = clamp(startRef.current + d, lo, hi);
        cbRef.current(Math.round(v * 100) / 100);
      },
    })
  ).current;
  const frac = max > min ? clamp((value - min) / (max - min), 0, 1) : 0;
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHead}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Text style={styles.sliderVal}>{format(value)}</Text>
      </View>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        <View style={styles.trackLine} />
        <View style={[styles.trackFill, { width: frac * Math.max(0, w - 22) + 11 }]} />
        <View style={[styles.thumb, { left: frac * Math.max(0, w - 22) }]} />
      </View>
    </View>
  );
}

function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Ionicons name={icon} size={18} color={palette.textDim} />
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: palette.accent, false: palette.surfaceHigh }}
        thumbColor="#fff"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05060a' },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  topBtn: { padding: 4 },
  title: { flex: 1, color: palette.text, fontSize: 17, fontWeight: '700' },
  resetText: { color: palette.text, fontSize: 14, fontWeight: '600' },
  dim: { color: palette.textDim },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  doneText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  regionWrap: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  regionTrack: { height: 96, borderRadius: 12, backgroundColor: palette.surface, overflow: 'hidden' },
  regionCut: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  region: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: palette.accentSoft,
    borderRightWidth: 2,
    borderRightColor: palette.accent,
  },
  waveRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(124,92,255,0.28)' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
  trimHandle: { position: 'absolute', top: 0, bottom: 0, width: 22, alignItems: 'center', justifyContent: 'center' },
  trimGrip: { width: 5, height: 44, borderRadius: 3, backgroundColor: palette.accent },
  transport: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 6 },
  playBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  time: { color: palette.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  controls: { paddingHorizontal: 16, paddingTop: 10, gap: 14 },
  sliderRow: { gap: 4 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { color: palette.text, fontSize: 13, fontWeight: '600' },
  sliderVal: { color: palette.accent, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 34, justifyContent: 'center' },
  trackLine: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: palette.surfaceHigh },
  trackFill: { position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: palette.accent },
  thumb: { position: 'absolute', top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: palette.accent, borderWidth: 2, borderColor: '#fff' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleLabel: { flex: 1, color: palette.text, fontSize: 14, fontWeight: '600' },
  hint: { color: palette.textDim, fontSize: 11, lineHeight: 16 },
});

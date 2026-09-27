import { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import { type LayoutChangeEvent, PanResponder, StyleSheet, Switch, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { getWaveform, type WaveformData } from '@/lib/waveform';

/**
 * 🎧 Közös hang-stúdió primitívek — a `HangStudio` bevált vezérlőiből kiemelve,
 * hogy a projekt-szintű `AudioStudio` és a videóból nyíló (scoped) mód UGYANAZT
 * használja. Minden vezérlő „kontrollált": az értéket a hívó tartja, ez csak
 * megjeleníti + a húzást jelzi vissza.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** on-device hullámforma-dekódolás (react-native-audio-api), cache-elve. */
export function useWaveform(uri: string | null): WaveformData | null {
  // a URI-t is tároljuk, hogy uri-váltáskor NE egy elavult hullámformát adjunk
  // vissza (és ne kelljen szinkron setState az effektben — azt a lint tiltja)
  const [wave, setWave] = useState<{ uri: string; data: WaveformData } | null>(null);
  useEffect(() => {
    if (!uri) {
      return;
    }
    let alive = true;
    getWaveform(uri)
      .then((w) => {
        if (alive && w) {
          setWave({ uri, data: w });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri]);
  return uri && wave?.uri === uri ? wave.data : null;
}

export function Slider({
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
        cbRef.current(Math.round(clamp(startRef.current + d, lo, hi) * 100) / 100);
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
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.trackLine} />
        <View style={[styles.trackFill, { width: frac * Math.max(0, w - 22) + 11 }]} />
        <View style={[styles.thumb, { left: frac * Math.max(0, w - 22) }]} />
      </View>
    </View>
  );
}

export function ToggleRow({
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

const REGION_H = 96;

/**
 * Hossz-vág + fade-vizualizáció EGY klipre, valódi hullámformával — a FORRÁSON
 * BELÜL (mint a VideoClip.trimIn): a teljes forrás (`sourceDuration`) látszik, az
 * aktív ablak `[trimIn, trimIn+duration]`, KÉT fogóval (bal = trimIn, jobb = vég).
 * A hívó `onChange`-e frame-re illeszti; a kívül eső rész sötétített.
 */
export function RegionBar({
  trimIn,
  duration,
  sourceDuration,
  fadeIn,
  fadeOut,
  playhead,
  peaks,
  waveDuration,
  onChange,
}: {
  trimIn: number;
  duration: number;
  sourceDuration: number;
  fadeIn: number;
  fadeOut: number;
  playhead: number;
  peaks: number[] | null;
  waveDuration: number;
  onChange: (next: { trimIn: number; duration: number }) => void;
}) {
  const [w, setW] = useState(0);
  const src = Math.max(0.1, sourceDuration);
  // élő értékek ref-ben (a PanResponder gesztus alatt olvassa)
  const ref = useRef({ trimIn, duration, w, cb: onChange });
  ref.current = { trimIn, duration, w, cb: onChange };
  const grab = useRef({ trimIn, end: trimIn + duration });

  const mk = (side: 'left' | 'right') =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        grab.current = { trimIn: ref.current.trimIn, end: ref.current.trimIn + ref.current.duration };
      },
      onPanResponderMove: (_e, g) => {
        const full = Math.max(1, ref.current.w);
        const dt = (g.dx / full) * src;
        if (side === 'left') {
          const t = clamp(Math.round((grab.current.trimIn + dt) * 10) / 10, 0, grab.current.end - 0.5);
          ref.current.cb({ trimIn: t, duration: grab.current.end - t });
        } else {
          const end = clamp(Math.round((grab.current.end + dt) * 10) / 10, grab.current.trimIn + 0.5, src);
          ref.current.cb({ trimIn: grab.current.trimIn, duration: end - grab.current.trimIn });
        }
      },
    });
  const panL = useRef(mk('left')).current;
  const panR = useRef(mk('right')).current;

  const pps = w / src; // px / forrás-mp
  const leftX = trimIn * pps;
  const winW = duration * pps;
  const rightX = leftX + winW;
  const fiW = fadeIn * pps;
  const foW = fadeOut * pps;
  const phX = clamp((trimIn + playhead) * pps, leftX, rightX);

  const waveBars = useMemo(() => {
    if (!peaks || peaks.length === 0 || w <= 0) {
      return null;
    }
    const cols = Math.max(1, Math.floor(w / 3));
    const barW = w / cols;
    const items: ReactElement[] = [];
    for (let i = 0; i < cols; i++) {
      const t0 = (i / cols) * src;
      const idx = waveDuration > 0 ? Math.floor((t0 / waveDuration) * peaks.length) : 0;
      const v = peaks[Math.min(peaks.length - 1, Math.max(0, idx))] ?? 0;
      const inWindow = t0 >= trimIn && t0 <= trimIn + duration;
      items.push(
        <View
          key={i}
          style={{
            width: Math.max(1, barW - 1),
            height: Math.max(2, v * (REGION_H * 0.82)),
            borderRadius: 1,
            backgroundColor: inWindow ? palette.accent : palette.border,
          }}
        />
      );
    }
    return <View style={styles.waveRow}>{items}</View>;
  }, [peaks, w, trimIn, duration, src, waveDuration]);

  return (
    <View style={styles.regionWrap} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <View style={styles.regionTrack}>
        {waveBars ?? <View style={[styles.region, { left: leftX, width: winW }]} />}
        {/* a forrás kivágott (inaktív) részei sötétítve */}
        {leftX > 1 ? <View style={[styles.regionCut, { left: 0, width: leftX }]} /> : null}
        {rightX < w - 1 ? <View style={[styles.regionCut, { left: rightX, width: w - rightX }]} /> : null}
        {/* fade be/ki az aktív ablakon belül */}
        {fiW > 1 ? <View style={[styles.fade, { left: leftX, width: fiW }]} /> : null}
        {foW > 1 ? <View style={[styles.fade, { left: Math.max(leftX, rightX - foW), width: foW }]} /> : null}
        <View style={[styles.playhead, { left: phX }]} />
        {/* bal fogó (trimIn) */}
        <View style={[styles.trimHandle, { left: Math.max(0, leftX - 11) }]} {...panL.panHandlers}>
          <View style={styles.trimGrip} />
        </View>
        {/* jobb fogó (vég) */}
        <View style={[styles.trimHandle, { left: Math.max(0, rightX - 11) }]} {...panR.panHandlers}>
          <View style={styles.trimGrip} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
  regionWrap: { paddingVertical: 8 },
  regionTrack: { height: REGION_H, borderRadius: 12, backgroundColor: palette.surface, overflow: 'hidden' },
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
  waveRow: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  fade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(124,92,255,0.28)' },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
  trimHandle: { position: 'absolute', top: 0, bottom: 0, width: 22, alignItems: 'center', justifyContent: 'center' },
  trimGrip: { width: 5, height: 44, borderRadius: 3, backgroundColor: palette.accent },
});

import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { palette } from '@/constants/editor';
import { KF_EPS, PRESET_BEZIER, sampleChannel } from '@/lib/keyframes';
import type { Keyframe, KeyframeEasing } from '@/types/project';

const HEIGHT = 160;
const PAD = 16;
const CURVE_SAMPLES = 72;

const EASINGS: KeyframeEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold', 'bezier'];

interface Props {
  keyframes: Keyframe[];
  /** klip-hossz (mp) — az X-tengely */
  duration: number;
  /** érték-tartomány (Y-tengely) */
  min: number;
  max: number;
  /** kulcskocka nélküli/szél-érték */
  fallback: number;
  /** klip-lokális lejátszófej (mp) — kurzor + „hozzáadás itt" alapja */
  playhead: number;
  onChange: (kfs: Keyframe[]) => void;
  onSeek?: (clipLocalTime: number) => void;
  formatValue?: (v: number) => string;
}

/**
 * 🎞️ Graph Editor — After Effects / Premiere-szerű value/time görbe-szerkesztő.
 *
 * A görbét a `sampleChannel`-lel mintavételezzük (így PONTOSAN a valós
 * interpolációt rajzolja — a köbös-Bézier egyéni görbét is). A kulcskockák és a
 * Bézier-fogók áttetsző hit-target View-kkal húzhatók (a gesztus a
 * CurveEditor-mintát követi: runOnJS az onUpdate-ben, kezdőérték az onStart-kor).
 */
export function KeyframeGraphEditor({
  keyframes,
  duration,
  min,
  max,
  fallback,
  playhead,
  onChange,
  onSeek,
  formatValue,
}: Props) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(keyframes.length ? 0 : null);
  const dragStart = useRef<{ time: number; value: number } | null>(null);
  const bezierStart = useRef<[number, number, number, number] | null>(null);
  // a legfrissebb kulcskockák a gesztus-callbackekhez (a prop záródása elavulhat)
  const kfsRef = useRef(keyframes);
  kfsRef.current = keyframes;

  const innerW = Math.max(1, w - 2 * PAD);
  const innerH = HEIGHT - 2 * PAD;
  const span = Math.max(max - min, 1e-6);
  const dur = Math.max(duration, 0.001);

  const xToPx = (t: number) => PAD + (t / dur) * innerW;
  const vToPx = (v: number) => PAD + (1 - (v - min) / span) * innerH;
  const pxToT = (px: number) => Math.min(dur, Math.max(0, ((px - PAD) / innerW) * dur));
  const pxToV = (py: number) => Math.min(max, Math.max(min, min + (1 - (py - PAD) / innerH) * span));

  const fmt = formatValue ?? ((v: number) => v.toFixed(2));

  const commit = (kfs: Keyframe[]) => onChange([...kfs].sort((a, b) => a.time - b.time));

  // ── görbe-útvonal (a valós interpoláció mintavételezve) ─────────────────────
  let path = '';
  if (w > 0) {
    for (let i = 0; i <= CURVE_SAMPLES; i++) {
      const t = (i / CURVE_SAMPLES) * dur;
      const v = sampleChannel(keyframes, t, fallback);
      path += `${i === 0 ? 'M' : 'L'}${xToPx(t).toFixed(1)},${vToPx(v).toFixed(1)} `;
    }
  }

  // ── kulcskocka húzása ───────────────────────────────────────────────────────
  const beginDrag = (i: number) => {
    const kf = kfsRef.current[i];
    if (kf) {
      dragStart.current = { time: kf.time, value: kf.value };
      setSel(i);
    }
  };
  const moveDrag = (i: number, dx: number, dy: number) => {
    const start = dragStart.current;
    const kfs = kfsRef.current;
    if (!start || !kfs[i]) {
      return;
    }
    const prev = kfs[i - 1];
    const next = kfs[i + 1];
    // idő a szomszédok közé zárva (a rend megmarad); a szélső kf ideje fix marad
    const loT = prev ? prev.time + KF_EPS : 0;
    const hiT = next ? next.time - KF_EPS : dur;
    const isEdge = i === 0 || i === kfs.length - 1;
    const nt = isEdge ? start.time : Math.min(hiT, Math.max(loT, start.time + (dx / innerW) * dur));
    const nv = Math.min(max, Math.max(min, start.value - (dy / innerH) * span));
    onChange(kfs.map((k, j) => (j === i ? { ...k, time: Math.round(nt * 1000) / 1000, value: nv } : k)));
  };

  // ── Bézier-fogó húzása (a kijelölt kf szegmensén) ────────────────────────────
  const beginBezier = () => {
    if (sel == null) {
      return;
    }
    const kf = kfsRef.current[sel];
    bezierStart.current = kf?.bezier ?? PRESET_BEZIER.easeInOut;
  };
  const moveBezier = (handle: 1 | 2, dx: number, dy: number) => {
    if (sel == null) {
      return;
    }
    const kfs = kfsRef.current;
    const a = kfs[sel];
    const b = kfs[sel + 1];
    const start = bezierStart.current;
    if (!a || !b || !start) {
      return;
    }
    const segT = Math.max(b.time - a.time, 1e-6);
    const segV = b.value - a.value;
    // a fogó normalizált (0–1 idő; érték-frakció). segV≈0 esetén az y-frakció
    // instabil → csak az x-et állítjuk, az y-t tartjuk
    const dxN = (dx / innerW) * (dur / segT);
    const dyValFrac = Math.abs(segV) > 1e-6 ? -((dy / innerH) * span) / segV : 0;
    const [x1, y1, x2, y2] = start;
    const next: [number, number, number, number] =
      handle === 1
        ? [Math.min(1, Math.max(0, x1 + dxN)), y1 + dyValFrac, x2, y2]
        : [x1, y1, Math.min(1, Math.max(0, x2 + dxN)), y2 + dyValFrac];
    onChange(kfs.map((k, j) => (j === sel ? { ...k, bezier: next } : k)));
  };

  const endGesture = () => {
    dragStart.current = null;
    bezierStart.current = null;
    Haptics.selectionAsync().catch(() => {});
  };

  const addAt = (px: number, py: number) => {
    const t = Math.round(pxToT(px) * 1000) / 1000;
    if (kfsRef.current.some((k) => Math.abs(k.time - t) <= KF_EPS)) {
      return;
    }
    const next = [...kfsRef.current, { time: t, value: pxToV(py), easing: 'easeInOut' as KeyframeEasing }];
    next.sort((a, b) => a.time - b.time);
    commit(next);
    setSel(next.findIndex((k) => Math.abs(k.time - t) <= KF_EPS));
    Haptics.selectionAsync().catch(() => {});
  };

  const addAtPlayhead = () => {
    const t = Math.round(Math.min(dur, Math.max(0, playhead)) * 1000) / 1000;
    const val = sampleChannel(kfsRef.current, t, fallback);
    const filtered = kfsRef.current.filter((k) => Math.abs(k.time - t) > KF_EPS);
    const next = [...filtered, { time: t, value: val, easing: 'easeInOut' as KeyframeEasing }];
    next.sort((a, b) => a.time - b.time);
    commit(next);
    setSel(next.findIndex((k) => Math.abs(k.time - t) <= KF_EPS));
  };

  const deleteSel = () => {
    if (sel == null) {
      return;
    }
    const next = kfsRef.current.filter((_, j) => j !== sel);
    commit(next);
    setSel(next.length ? Math.max(0, sel - 1) : null);
  };

  const setEasing = (easing: KeyframeEasing) => {
    if (sel == null) {
      return;
    }
    onChange(
      kfsRef.current.map((k, j) =>
        j === sel
          ? { ...k, easing, bezier: easing === 'bezier' ? (k.bezier ?? PRESET_BEZIER[k.easing === 'bezier' ? 'easeInOut' : k.easing]) : k.bezier }
          : k
      )
    );
  };

  const selKf = sel != null ? keyframes[sel] : null;
  const selNext = sel != null ? keyframes[sel + 1] : null;
  const showBezier = !!selKf && !!selNext && selKf.easing === 'bezier';
  const bez = selKf?.bezier ?? PRESET_BEZIER.easeInOut;
  const h1 = showBezier
    ? { x: xToPx(selKf!.time + bez[0] * (selNext!.time - selKf!.time)), y: vToPx(selKf!.value + bez[1] * (selNext!.value - selKf!.value)) }
    : null;
  const h2 = showBezier
    ? { x: xToPx(selKf!.time + bez[2] * (selNext!.time - selKf!.time)), y: vToPx(selKf!.value + bez[3] * (selNext!.value - selKf!.value)) }
    : null;

  const HIT = 30;

  return (
    <View>
      <View style={styles.chart} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        {/* háttér-koppintás: kulcskocka hozzáadása a koppintás pontján */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => addAt(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        />
        {w > 0 ? (
          <Svg width={w} height={HEIGHT} pointerEvents="none" style={StyleSheet.absoluteFill}>
            {/* rács: alap/közép/tető */}
            {[0, 0.5, 1].map((r) => (
              <Line
                key={r}
                x1={PAD}
                x2={w - PAD}
                y1={PAD + r * innerH}
                y2={PAD + r * innerH}
                stroke={palette.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            ))}
            {/* lejátszófej */}
            <Line
              x1={xToPx(Math.min(dur, Math.max(0, playhead)))}
              x2={xToPx(Math.min(dur, Math.max(0, playhead)))}
              y1={0}
              y2={HEIGHT}
              stroke={palette.text}
              strokeWidth={1}
              opacity={0.5}
            />
            {/* a görbe */}
            <Path d={path} stroke={palette.accent} strokeWidth={2} fill="none" />
            {/* Bézier-fogók a kijelölt szegmensen */}
            {showBezier && h1 && h2 ? (
              <>
                <Line x1={xToPx(selKf!.time)} y1={vToPx(selKf!.value)} x2={h1.x} y2={h1.y} stroke={palette.accent2} strokeWidth={1} />
                <Line x1={xToPx(selNext!.time)} y1={vToPx(selNext!.value)} x2={h2.x} y2={h2.y} stroke={palette.accent2} strokeWidth={1} />
                <Circle cx={h1.x} cy={h1.y} r={4} fill={palette.accent2} />
                <Circle cx={h2.x} cy={h2.y} r={4} fill={palette.accent2} />
              </>
            ) : null}
            {/* kulcskockák */}
            {keyframes.map((k, i) => (
              <Circle
                key={i}
                cx={xToPx(k.time)}
                cy={vToPx(k.value)}
                r={i === sel ? 6 : 4}
                fill={i === sel ? palette.text : palette.accent}
                stroke={palette.bg}
                strokeWidth={1.5}
              />
            ))}
          </Svg>
        ) : null}

        {/* húzó hit-targetek a kulcskockákra (a görbe fölött) */}
        {w > 0
          ? keyframes.map((k, i) => {
              const pan = Gesture.Pan()
                .onStart(() => runOnJS(beginDrag)(i))
                .onUpdate((e) => runOnJS(moveDrag)(i, e.translationX, e.translationY))
                .onEnd(() => runOnJS(endGesture)());
              const tap = Gesture.Tap().onEnd(() => runOnJS(setSel)(i));
              return (
                <GestureDetector key={i} gesture={Gesture.Race(pan, tap)}>
                  <View
                    style={[styles.hit, { left: xToPx(k.time) - HIT / 2, top: vToPx(k.value) - HIT / 2, width: HIT, height: HIT }]}
                  />
                </GestureDetector>
              );
            })
          : null}

        {/* Bézier-fogó hit-targetek */}
        {showBezier && h1 && h2
          ? ([[1, h1] as const, [2, h2] as const]).map(([handle, h]) => {
              const pan = Gesture.Pan()
                .onStart(() => runOnJS(beginBezier)())
                .onUpdate((e) => runOnJS(moveBezier)(handle, e.translationX, e.translationY))
                .onEnd(() => runOnJS(endGesture)());
              return (
                <GestureDetector key={`h${handle}`} gesture={pan}>
                  <View style={[styles.hit, { left: h.x - HIT / 2, top: h.y - HIT / 2, width: HIT, height: HIT }]} />
                </GestureDetector>
              );
            })
          : null}
      </View>

      {/* érték-kijelző + hozzáadás/törlés */}
      <View style={styles.row}>
        <Text style={styles.axis}>
          {selKf ? `${selKf.time.toFixed(2)}s · ${fmt(selKf.value)}` : `${fmt(min)} … ${fmt(max)}`}
        </Text>
        <View style={styles.spacer} />
        <Pressable hitSlop={6} onPress={addAtPlayhead} style={styles.iconBtn}>
          <Ionicons name="add-circle-outline" size={20} color={palette.text} />
        </Pressable>
        <Pressable hitSlop={6} onPress={deleteSel} disabled={sel == null} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={18} color={sel == null ? palette.border : palette.danger} />
        </Pressable>
      </View>

      {/* a kijelölt kulcskocka easingje (linear / ease… / egyéni Bézier) */}
      {selKf ? (
        <View style={styles.easeRow}>
          {EASINGS.map((es) => (
            <Pressable
              key={es}
              onPress={() => setEasing(es)}
              hitSlop={4}
              style={[styles.easeChip, selKf.easing === es ? styles.easeChipOn : null]}
            >
              <Text style={[styles.easeChipText, selKf.easing === es ? styles.easeChipTextOn : null]}>{es}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
    height: HEIGHT,
    backgroundColor: palette.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'visible',
  },
  hit: {
    position: 'absolute',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  axis: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  spacer: {
    flex: 1,
  },
  iconBtn: {
    padding: 2,
  },
  easeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  easeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  easeChipOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  easeChipText: {
    color: palette.textDim,
    fontSize: 10,
    fontWeight: '700',
  },
  easeChipTextOn: {
    color: palette.accent,
  },
});

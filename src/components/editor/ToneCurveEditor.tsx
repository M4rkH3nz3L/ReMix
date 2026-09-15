import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { palette } from '@/constants/editor';
import { IDENTITY_CURVE, isIdentityCurve, normalizeCurve, sampleCurvePath } from '@/lib/curves';
import type { CurvePoint, ToneCurves } from '@/types/project';

const HEIGHT = 180;
const PAD = 14;
const HIT = 30;
const MIN_DX = 0.03; // két pont közti minimum x-távolság

type Channel = keyof ToneCurves;

const CHANNELS: { id: Channel; label: string; color: string }[] = [
  { id: 'rgb', label: 'RGB', color: palette.text },
  { id: 'red', label: 'R', color: '#ff5a5a' },
  { id: 'green', label: 'G', color: '#4dd97a' },
  { id: 'blue', label: 'B', color: '#5a9dff' },
];

interface Props {
  value?: ToneCurves;
  onChange: (next: ToneCurves | undefined) => void;
}

/**
 * 📈 Tónusgörbe-szerkesztő (Curves) — Lightroom/Premiere-szerű. Csatornafülek
 * (RGB/R/G/B), koppintás a háttérre → pont, pont húzása, kijelölt pont törlése.
 * A görbét Catmull-Rom spline-nal rajzoljuk (a render `curves`-e köbös spline-t
 * használ — vizuálisan egyezik). Az identitás-görbe nem íródik ki (nincs hatás).
 */
export function ToneCurveEditor({ value, onChange }: Props) {
  const [w, setW] = useState(0);
  const [channel, setChannel] = useState<Channel>('rgb');
  const [sel, setSel] = useState<number | null>(null);
  const dragStart = useRef<CurvePoint | null>(null);

  const points = normalizeCurve(value?.[channel] ?? IDENTITY_CURVE);
  const ptsRef = useRef(points);
  ptsRef.current = points;
  /**
   * 🖐️ Húzás alatti HELYI vázlat (az AKTUÁLIS csatorna pontjai) — a store-ba csak
   * a gesztus VÉGÉN commitolunk. Enélkül minden húzás-frame egy dispatch lenne
   * (60/mp), ami undo-lépést és esemény-napló bejegyzést is gyárt; az 50 lépéses
   * history 0,8 mp alatt elfogyna.
   */
  const [draft, setDraft] = useState<CurvePoint[] | null>(null);
  const draftRef = useRef<CurvePoint[] | null>(null);
  const putDraft = (pts: CurvePoint[]) => {
    draftRef.current = pts;
    setDraft(pts);
  };
  /** amit MUTATUNK: húzás alatt a vázlat, egyébként a value-ból számolt pontok */
  const view = draft ?? points;

  const innerW = Math.max(1, w - 2 * PAD);
  const innerH = HEIGHT - 2 * PAD;
  const chanColor = CHANNELS.find((c) => c.id === channel)!.color;

  const xToPx = (x: number) => PAD + x * innerW;
  const yToPx = (y: number) => PAD + (1 - y) * innerH;
  const pxToX = (px: number) => Math.min(1, Math.max(0, (px - PAD) / innerW));
  const pxToY = (py: number) => Math.min(1, Math.max(0, 1 - (py - PAD) / innerH));

  const commit = (pts: CurvePoint[]) => {
    const norm = normalizeCurve(pts);
    const nextChan = isIdentityCurve(norm) ? undefined : norm;
    const next: ToneCurves = { ...value };
    if (nextChan) {
      next[channel] = nextChan;
    } else {
      delete next[channel];
    }
    const empty = !next.rgb && !next.red && !next.green && !next.blue;
    onChange(empty ? undefined : next);
  };

  const beginDrag = (i: number) => {
    const p = ptsRef.current[i];
    if (p) {
      dragStart.current = { ...p };
      setSel(i);
    }
  };
  const moveDrag = (i: number, dx: number, dy: number) => {
    const start = dragStart.current;
    const pts = ptsRef.current;
    if (!start || !pts[i]) {
      return;
    }
    const isEdge = i === 0 || i === pts.length - 1;
    const prev = pts[i - 1];
    const next = pts[i + 1];
    const loX = prev ? prev.x + MIN_DX : 0;
    const hiX = next ? next.x - MIN_DX : 1;
    const nx = isEdge ? start.x : Math.min(hiX, Math.max(loX, start.x + dx / innerW));
    const ny = Math.min(1, Math.max(0, start.y - dy / innerH));
    // csak a helyi vázlatba (a store-ba az `endGesture` commitol egyszer);
    // húzás alatt NEM normalizálunk — stabil indexek kellenek
    putDraft(pts.map((p, j) => (j === i ? { x: nx, y: ny } : p)));
  };

  const endGesture = () => {
    dragStart.current = null;
    // 🖐️ a gesztus VÉGÉN megy egyetlen commit a store-ba → egy undo-lépés
    const pending = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (pending) {
      commit(pending); // a commit normalizál
    }
    Haptics.selectionAsync().catch(() => {});
  };

  const addAt = (px: number, py: number) => {
    const x = pxToX(px);
    const pts = ptsRef.current;
    if (pts.some((p) => Math.abs(p.x - x) < MIN_DX)) {
      return;
    }
    const next = [...pts, { x, y: pxToY(py) }].sort((a, b) => a.x - b.x);
    commit(next);
    setSel(next.findIndex((p) => Math.abs(p.x - x) < 1e-4));
    Haptics.selectionAsync().catch(() => {});
  };

  const deleteSel = () => {
    if (sel == null) {
      return;
    }
    const pts = ptsRef.current;
    if (sel === 0 || sel === pts.length - 1) {
      return; // szélső pont nem törölhető
    }
    commit(pts.filter((_, j) => j !== sel));
    setSel(null);
  };

  const resetChannel = () => {
    setSel(null);
    commit(IDENTITY_CURVE.map((p) => ({ ...p })));
  };

  // görbe-útvonal (Catmull-Rom mintavétel)
  let path = '';
  if (w > 0) {
    const samples = sampleCurvePath(view);
    path = samples
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xToPx(p.x).toFixed(1)},${yToPx(p.y).toFixed(1)}`)
      .join(' ');
  }

  const modified = CHANNELS.some((c) => !isIdentityCurve(value?.[c.id]));

  return (
    <View>
      <View style={styles.tabs}>
        {CHANNELS.map((c) => {
          const on = channel === c.id;
          const touched = !isIdentityCurve(value?.[c.id]);
          return (
            <Pressable
              key={c.id}
              onPress={() => {
                setChannel(c.id);
                setSel(null);
              }}
              hitSlop={4}
              style={[styles.tab, on ? { borderColor: c.color, backgroundColor: palette.surfaceHigh } : null]}
            >
              <Text style={[styles.tabText, { color: on ? c.color : palette.textDim }]}>
                {c.label}
                {touched ? ' •' : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chart} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => addAt(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        />
        {w > 0 ? (
          <Svg width={w} height={HEIGHT} pointerEvents="none" style={StyleSheet.absoluteFill}>
            {/* rács (negyedek) + átló-referencia */}
            {[0.25, 0.5, 0.75].map((r) => (
              <Line
                key={`h${r}`}
                x1={PAD}
                x2={w - PAD}
                y1={PAD + r * innerH}
                y2={PAD + r * innerH}
                stroke={palette.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            ))}
            {[0.25, 0.5, 0.75].map((r) => (
              <Line
                key={`v${r}`}
                x1={PAD + r * innerW}
                x2={PAD + r * innerW}
                y1={PAD}
                y2={HEIGHT - PAD}
                stroke={palette.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            ))}
            <Line
              x1={xToPx(0)}
              y1={yToPx(0)}
              x2={xToPx(1)}
              y2={yToPx(1)}
              stroke={palette.border}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <Path d={path} stroke={chanColor} strokeWidth={2} fill="none" />
            {view.map((p, i) => (
              <Circle
                key={i}
                cx={xToPx(p.x)}
                cy={yToPx(p.y)}
                r={i === sel ? 6 : 4}
                fill={i === sel ? palette.text : chanColor}
                stroke={palette.bg}
                strokeWidth={1.5}
              />
            ))}
          </Svg>
        ) : null}

        {w > 0
          ? view.map((p, i) => {
              const pan = Gesture.Pan()
                .onStart(() => runOnJS(beginDrag)(i))
                .onUpdate((e) => runOnJS(moveDrag)(i, e.translationX, e.translationY))
                .onEnd(() => runOnJS(endGesture)());
              const tap = Gesture.Tap().onEnd(() => runOnJS(setSel)(i));
              return (
                <GestureDetector key={i} gesture={Gesture.Race(pan, tap)}>
                  <View
                    style={[
                      styles.hit,
                      { left: xToPx(p.x) - HIT / 2, top: yToPx(p.y) - HIT / 2, width: HIT, height: HIT },
                    ]}
                  />
                </GestureDetector>
              );
            })
          : null}
      </View>

      <View style={styles.row}>
        <Text style={styles.axis}>
          {sel != null && view[sel]
            ? `${Math.round(view[sel].x * 255)} → ${Math.round(view[sel].y * 255)}`
            : 'be → ki (0–255)'}
        </Text>
        <View style={styles.spacer} />
        <Pressable
          hitSlop={6}
          onPress={deleteSel}
          disabled={sel == null || sel === 0 || sel === view.length - 1}
          style={styles.iconBtn}
        >
          <Ionicons
            name="trash-outline"
            size={18}
            color={sel == null || sel === 0 || sel === view.length - 1 ? palette.border : palette.danger}
          />
        </Pressable>
        <Pressable hitSlop={6} onPress={resetChannel} disabled={!modified} style={styles.iconBtn}>
          <Ionicons name="refresh-outline" size={18} color={modified ? palette.text : palette.border} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
  },
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
});

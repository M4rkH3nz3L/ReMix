import { Ionicons } from '@expo/vector-icons';
import { haptics } from '@/design';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { palette } from '@/constants/editor';
import { pathData, smoothToBezier } from '@/lib/draw';
import type { PathPoint } from '@/types/project';

const HIT = 30;
const PAD = 12;

interface Props {
  points: PathPoint[];
  closed?: boolean;
  onChange: (points: PathPoint[]) => void;
  onClosedChange: (closed: boolean) => void;
}

/**
 * ✏️ Toll-eszköz / horgonypont-szerkesztő. Négyzetes vászon a klip 0…1 terében:
 * koppintás a háttérre → új horgony; horgony húzása → mozgatás (a fogói vele);
 * a kijelölt horgony Bézier-fogói külön húzhatók. Gombok: törlés · simítás
 * (Catmull-Rom fogók) · sarok (fogók el) · zárás. A render/előnézet a KÖZÖS
 * `pathData`-t használja, így pontosan ezt rajzolja.
 */
export function PathEditor({ points, closed, onChange, onClosedChange }: Props) {
  const [w, setW] = useState(0);
  const [sel, setSel] = useState<number | null>(points.length ? 0 : null);
  const dragStart = useRef<PathPoint | null>(null);
  const ptsRef = useRef(points);
  ptsRef.current = points;
  /**
   * 🖐️ Húzás alatti HELYI vázlat — a store-ba csak a gesztus VÉGÉN commitolunk.
   * Enélkül minden húzás-frame egy dispatch lenne (60/mp), ami undo-lépést és
   * esemény-napló bejegyzést is gyárt; az 50 lépéses history 0,8 mp alatt elfogyna.
   */
  const [draft, setDraft] = useState<PathPoint[] | null>(null);
  const draftRef = useRef<PathPoint[] | null>(null);
  const putDraft = (pts: PathPoint[]) => {
    draftRef.current = pts;
    setDraft(pts);
  };
  /** amit MUTATUNK: húzás alatt a vázlat, egyébként a props */
  const view = draft ?? points;

  const side = Math.max(1, w);
  const toPx = (v: number) => PAD + v * (side - 2 * PAD);
  const toNorm = (px: number) => Math.min(1, Math.max(0, (px - PAD) / (side - 2 * PAD)));

  const commit = (pts: PathPoint[]) => onChange(pts);

  const beginDrag = (i: number) => {
    const p = ptsRef.current[i];
    if (p) {
      dragStart.current = { ...p };
      setSel(i);
    }
  };
  const moveAnchor = (i: number, dx: number, dy: number) => {
    const start = dragStart.current;
    const pts = ptsRef.current;
    if (!start || !pts[i]) {
      return;
    }
    const ndx = dx / (side - 2 * PAD);
    const ndy = dy / (side - 2 * PAD);
    const nx = Math.min(1, Math.max(0, start.x + ndx));
    const ny = Math.min(1, Math.max(0, start.y + ndy));
    // a fogók az elmozdulással együtt mennek
    const next: PathPoint = { x: nx, y: ny };
    if (start.h1) next.h1 = { x: start.h1.x + (nx - start.x), y: start.h1.y + (ny - start.y) };
    if (start.h2) next.h2 = { x: start.h2.x + (nx - start.x), y: start.h2.y + (ny - start.y) };
    putDraft(pts.map((p, j) => (j === i ? next : p)));
  };

  const beginHandle = (i: number) => {
    dragStart.current = ptsRef.current[i] ? { ...ptsRef.current[i] } : null;
  };
  const moveHandle = (i: number, which: 'h1' | 'h2', dx: number, dy: number) => {
    const start = dragStart.current;
    const pts = ptsRef.current;
    if (!start || !pts[i]) {
      return;
    }
    const base = start[which] ?? { x: start.x, y: start.y };
    const nx = Math.min(1, Math.max(0, base.x + dx / (side - 2 * PAD)));
    const ny = Math.min(1, Math.max(0, base.y + dy / (side - 2 * PAD)));
    putDraft(pts.map((p, j) => (j === i ? { ...p, [which]: { x: nx, y: ny } } : p)));
  };

  const endGesture = () => {
    dragStart.current = null;
    // 🖐️ a gesztus VÉGÉN megy egyetlen commit a store-ba → egy undo-lépés
    const pending = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (pending) {
      commit(pending);
    }
    haptics.selection();
  };

  const addAnchor = (px: number, py: number) => {
    const next = [...ptsRef.current, { x: toNorm(px), y: toNorm(py) }];
    commit(next);
    setSel(next.length - 1);
    haptics.selection();
  };

  const deleteSel = () => {
    if (sel == null) {
      return;
    }
    const next = ptsRef.current.filter((_, j) => j !== sel);
    commit(next);
    setSel(next.length ? Math.max(0, sel - 1) : null);
  };

  const smooth = () => {
    // a kijelöltre szimmetrikus fogó a szomszédokból; kijelölés nélkül mind
    commit(smoothToBezier(ptsRef.current, closed));
  };
  const corner = () => {
    if (sel == null) {
      return;
    }
    commit(
      ptsRef.current.map((p, j) => (j === sel ? { x: p.x, y: p.y } : p))
    );
  };

  const selPt = sel != null ? view[sel] : null;
  const d = pathData(view, side, side, closed);

  return (
    <View>
      <View style={[styles.chart, { height: side || 200 }]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(e) => addAnchor(e.nativeEvent.locationX, e.nativeEvent.locationY)}
        />
        {w > 0 ? (
          <Svg width={side} height={side} pointerEvents="none" style={StyleSheet.absoluteFill}>
            {[0.25, 0.5, 0.75].map((r) => (
              <Line key={`h${r}`} x1={PAD} x2={side - PAD} y1={toPx(r)} y2={toPx(r)} stroke={palette.border} strokeWidth={StyleSheet.hairlineWidth} />
            ))}
            {[0.25, 0.5, 0.75].map((r) => (
              <Line key={`v${r}`} x1={toPx(r)} x2={toPx(r)} y1={PAD} y2={side - PAD} stroke={palette.border} strokeWidth={StyleSheet.hairlineWidth} />
            ))}
            <Path d={d} stroke={palette.accent} strokeWidth={2} fill={closed ? palette.accentSoft : 'none'} />
            {/* a kijelölt horgony fogó-vonalai */}
            {selPt?.h1 ? (
              <>
                <Line x1={toPx(selPt.x)} y1={toPx(selPt.y)} x2={toPx(selPt.h1.x)} y2={toPx(selPt.h1.y)} stroke={palette.accent2} strokeWidth={1} />
                <Circle cx={toPx(selPt.h1.x)} cy={toPx(selPt.h1.y)} r={4} fill={palette.accent2} />
              </>
            ) : null}
            {selPt?.h2 ? (
              <>
                <Line x1={toPx(selPt.x)} y1={toPx(selPt.y)} x2={toPx(selPt.h2.x)} y2={toPx(selPt.h2.y)} stroke={palette.accent2} strokeWidth={1} />
                <Circle cx={toPx(selPt.h2.x)} cy={toPx(selPt.h2.y)} r={4} fill={palette.accent2} />
              </>
            ) : null}
            {view.map((p, i) => (
              <Circle key={i} cx={toPx(p.x)} cy={toPx(p.y)} r={i === sel ? 6 : 4} fill={i === sel ? palette.text : palette.accent} stroke={palette.bg} strokeWidth={1.5} />
            ))}
          </Svg>
        ) : null}

        {/* horgony hit-targetek */}
        {w > 0
          ? view.map((p, i) => {
              const pan = Gesture.Pan()
                .onStart(() => runOnJS(beginDrag)(i))
                .onUpdate((e) => runOnJS(moveAnchor)(i, e.translationX, e.translationY))
                .onEnd(() => runOnJS(endGesture)());
              const tap = Gesture.Tap().onEnd(() => runOnJS(setSel)(i));
              return (
                <GestureDetector key={i} gesture={Gesture.Race(pan, tap)}>
                  <View style={[styles.hit, { left: toPx(p.x) - HIT / 2, top: toPx(p.y) - HIT / 2, width: HIT, height: HIT }]} />
                </GestureDetector>
              );
            })
          : null}

        {/* fogó hit-targetek a kijelölt horgonyon */}
        {w > 0 && sel != null && selPt
          ? (['h1', 'h2'] as const).map((which) => {
              const hp = selPt[which];
              if (!hp) {
                return null;
              }
              const pan = Gesture.Pan()
                .onStart(() => runOnJS(beginHandle)(sel))
                .onUpdate((e) => runOnJS(moveHandle)(sel, which, e.translationX, e.translationY))
                .onEnd(() => runOnJS(endGesture)());
              return (
                <GestureDetector key={which} gesture={pan}>
                  <View style={[styles.hit, { left: toPx(hp.x) - HIT / 2, top: toPx(hp.y) - HIT / 2, width: HIT, height: HIT }]} />
                </GestureDetector>
              );
            })
          : null}
      </View>

      <View style={styles.row}>
        <Pressable hitSlop={6} onPress={smooth} style={styles.btn}>
          <Ionicons name="analytics-outline" size={18} color={palette.text} />
        </Pressable>
        <Pressable hitSlop={6} onPress={corner} disabled={sel == null} style={styles.btn}>
          <Ionicons name="git-commit-outline" size={18} color={sel == null ? palette.border : palette.text} />
        </Pressable>
        <Pressable hitSlop={6} onPress={() => onClosedChange(!closed)} style={styles.btn}>
          <Ionicons name={closed ? 'ellipse-outline' : 'git-network-outline'} size={18} color={closed ? palette.accent : palette.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable hitSlop={6} onPress={deleteSel} disabled={sel == null} style={styles.btn}>
          <Ionicons name="trash-outline" size={18} color={sel == null ? palette.border : palette.danger} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: {
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
    gap: 12,
    marginTop: 8,
  },
  btn: {
    padding: 2,
  },
});

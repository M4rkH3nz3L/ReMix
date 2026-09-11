import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Line, Polygon, Polyline } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import { ColorDot } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { BRUSH_COLORS, polylinePoints, simplifyPath, type Point } from '@/lib/draw';
import { getImageSize } from '@/lib/imageEditor';

type Mode = 'pen' | 'highlighter' | 'arrow';
type Rect = { x: number; y: number; w: number; h: number };
type Stroke = { mode: Mode; color: string; widthFrac: number; pts: Point[] };

const MODES: { id: Mode; icon: keyof typeof Ionicons.glyphMap; widthFrac: number; opacity: number }[] = [
  { id: 'pen', icon: 'pencil', widthFrac: 0.008, opacity: 1 },
  { id: 'highlighter', icon: 'color-wand-outline', widthFrac: 0.035, opacity: 0.4 },
  { id: 'arrow', icon: 'arrow-forward-outline', widthFrac: 0.011, opacity: 1 },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function fitRect(cw: number, ch: number, natW: number, natH: number): Rect {
  const scale = Math.min(cw / natW, ch / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/**
 * ✏️ Rajz / Markup — toll, kiemelő, nyíl a képre.
 *
 * A kép + az SVG-vonalak egy nézetbe komponálva, majd az „Alkalmaz" AZ
 * ESZKÖZÖN égeti képfájlba (`react-native-view-shot` captureRef) — worker
 * nélkül. A pontok a kép-téglalaphoz 0–1-re normalizálva tárolódnak, így az
 * SVG pontosan skálázódik a capture-höz.
 */
export function ImageMarkupTool({
  uri,
  onApply,
}: {
  uri: string;
  onApply: (bakedUri: string) => void;
}) {
  const { t } = useTranslation();
  const shotRef = useRef<View>(null);
  const [nat, setNat] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [active, setActive] = useState<Stroke | null>(null);
  const [mode, setMode] = useState<Mode>('pen');
  const [color, setColor] = useState<string>(BRUSH_COLORS[0]);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let alive = true;
    getImageSize(uri)
      .then((s) => {
        if (alive) {
          setNat(s);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri]);

  const rect = area && nat ? fitRect(area.w, area.h, nat.width, nat.height) : null;

  // aktuális értékek ref-ben (a PanResponder egyszer jön létre)
  const rectRef = useRef<Rect | null>(rect);
  rectRef.current = rect;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const colorRef = useRef(color);
  colorRef.current = color;
  const activeRef = useRef<Stroke | null>(active);
  activeRef.current = active;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const r = rectRef.current;
        if (!r) {
          return;
        }
        const m = MODES.find((x) => x.id === modeRef.current)!;
        const p = { x: clamp01(e.nativeEvent.locationX / r.w), y: clamp01(e.nativeEvent.locationY / r.h) };
        setActive({ mode: modeRef.current, color: colorRef.current, widthFrac: m.widthFrac, pts: [p] });
      },
      onPanResponderMove: (e) => {
        const r = rectRef.current;
        const a = activeRef.current;
        if (!r || !a) {
          return;
        }
        const p = { x: clamp01(e.nativeEvent.locationX / r.w), y: clamp01(e.nativeEvent.locationY / r.h) };
        // nyílnál csak a kezdő- és végpont kell; egyébként gyűjtjük a vonalat
        const pts = a.mode === 'arrow' ? [a.pts[0], p] : [...a.pts, p];
        setActive({ ...a, pts });
      },
      onPanResponderRelease: () => {
        const a = activeRef.current;
        if (a && a.pts.length > 0) {
          const pts = a.mode === 'arrow' ? a.pts : simplifyPath(a.pts, 0.004);
          setStrokes((prev) => [...prev, { ...a, pts }]);
        }
        setActive(null);
      },
    })
  ).current;

  const all = active ? [...strokes, active] : strokes;

  const undo = () => setStrokes((prev) => prev.slice(0, -1));
  const clear = () => {
    setStrokes([]);
    setActive(null);
  };

  const apply = async () => {
    if (!rect || strokes.length === 0 || capturing) {
      return;
    }
    setCapturing(true);
    try {
      const baked = await captureRef(shotRef, { format: 'png', quality: 1 });
      onApply(baked);
    } catch {
      // hiba esetén marad a szerkesztő; a felhasználó újrapróbálhatja
    } finally {
      setCapturing(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.area} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {rect ? (
          <>
            <View
              ref={shotRef}
              collapsable={false}
              style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            >
              <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="none" />
              <Svg width={rect.w} height={rect.h} style={StyleSheet.absoluteFill}>
                {all.map((s, i) => (
                  <StrokeShape key={i} stroke={s} w={rect.w} h={rect.h} />
                ))}
              </Svg>
            </View>
            <View
              style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              {...pan.panHandlers}
            />
          </>
        ) : null}
        {capturing ? (
          <View style={styles.busy}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : null}
      </View>

      <View style={styles.controls}>
        <View style={styles.rowBetween}>
          <View style={styles.modeRow}>
            {MODES.map((m) => (
              <Pressable
                key={m.id}
                onPress={() => setMode(m.id)}
                style={[styles.modeBtn, mode === m.id && styles.modeBtnActive]}
              >
                <Ionicons name={m.icon} size={20} color={mode === m.id ? '#fff' : palette.text} />
              </Pressable>
            ))}
          </View>
          <View style={styles.modeRow}>
            <Pressable onPress={undo} disabled={strokes.length === 0} style={styles.iconBtn}>
              <Ionicons name="arrow-undo" size={20} color={strokes.length ? palette.text : palette.textDim} />
            </Pressable>
            <Pressable onPress={clear} disabled={strokes.length === 0} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={20} color={strokes.length ? palette.text : palette.textDim} />
            </Pressable>
          </View>
        </View>
        <View style={styles.colorRow}>
          {BRUSH_COLORS.map((c) => (
            <ColorDot key={c} color={c} active={color === c} onPress={() => setColor(c)} />
          ))}
        </View>
        <Pressable
          onPress={apply}
          disabled={capturing || strokes.length === 0}
          style={[styles.applyBtn, (capturing || strokes.length === 0) && styles.applyOff]}
        >
          <Text style={styles.applyText}>{t('common.apply')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StrokeShape({ stroke, w, h }: { stroke: Stroke; w: number; h: number }) {
  const sw = stroke.widthFrac * h;
  const opacity = stroke.mode === 'highlighter' ? 0.4 : 1;
  if (stroke.mode === 'arrow' && stroke.pts.length >= 2) {
    const s = stroke.pts[0];
    const e = stroke.pts[stroke.pts.length - 1];
    const sx = s.x * w;
    const sy = s.y * h;
    const ex = e.x * w;
    const ey = e.y * h;
    const ang = Math.atan2(ey - sy, ex - sx);
    const head = Math.max(12, sw * 3.5);
    const a1 = ang + Math.PI - 0.45;
    const a2 = ang + Math.PI + 0.45;
    const p1x = ex + head * Math.cos(a1);
    const p1y = ey + head * Math.sin(a1);
    const p2x = ex + head * Math.cos(a2);
    const p2y = ey + head * Math.sin(a2);
    return (
      <>
        <Line x1={sx} y1={sy} x2={ex} y2={ey} stroke={stroke.color} strokeWidth={sw} strokeLinecap="round" />
        <Polygon points={`${ex},${ey} ${p1x},${p1y} ${p2x},${p2y}`} fill={stroke.color} />
      </>
    );
  }
  return (
    <Polyline
      points={polylinePoints(stroke.pts, w, h)}
      fill="none"
      stroke={stroke.color}
      strokeOpacity={opacity}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  area: { flex: 1, margin: 12, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  busy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  controls: { paddingHorizontal: 12, paddingBottom: 6, gap: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: {
    width: 44,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  modeBtnActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorRow: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  applyBtn: {
    alignSelf: 'center',
    backgroundColor: palette.accent,
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 28,
  },
  applyOff: { opacity: 0.5 },
  applyText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});

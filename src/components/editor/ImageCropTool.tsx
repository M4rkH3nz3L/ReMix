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
import { Image } from 'expo-image';

import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { getImageSize, type ImageOp } from '@/lib/imageEditor';

type Rect = { x: number; y: number; w: number; h: number };
type Corner = 'tl' | 'tr' | 'bl' | 'br';

const MIN = 48; // legkisebb vágókeret (pt)
const HANDLE = 28;

const ASPECTS: { id: string; ratio: number | null }[] = [
  { id: 'free', ratio: null },
  { id: '1:1', ratio: 1 },
  { id: '4:5', ratio: 4 / 5 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A contain-fit alapján a KIRAJZOLT kép téglalapja a tartályon belül. */
function fitRect(cw: number, ch: number, natW: number, natH: number): Rect {
  const scale = Math.min(cw / natW, ch / natH);
  const w = natW * scale;
  const h = natH * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/** Adott arányú, középre igazított, a képbe illő legnagyobb keret. */
function centeredAspect(img: Rect, ratio: number | null): Rect {
  if (ratio == null) {
    return { ...img };
  }
  let w = img.w;
  let h = w / ratio;
  if (h > img.h) {
    h = img.h;
    w = h * ratio;
  }
  return { x: img.x + (img.w - w) / 2, y: img.y + (img.h - h) / 2, w, h };
}

/**
 * ✂️ Vágás eszköz — interaktív, MOBILRA optimalizált vágókeret.
 * Húzás középen = mozgatás; sarkok = méretezés; arány-chipek rögzítik a
 * képarányt. Az „Alkalmaz" a képpont-téglalapot adja a szülőnek, ami ESZKÖZÖN
 * (expo-image-manipulator) vágja be — worker nélkül.
 */
export function ImageCropTool({
  uri,
  busy,
  onApplyOps,
}: {
  uri: string;
  busy: boolean;
  onApplyOps: (ops: ImageOp[]) => void;
}) {
  const { t } = useTranslation();
  const [nat, setNat] = useState<{ width: number; height: number } | null>(null);
  const [area, setArea] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [straighten, setStraighten] = useState(0);

  // eredeti pixelméret betöltése (eszközön, dekódolással)
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

  // a kirajzolt kép-téglalap render-időben származtatva (contain-fit)
  const img = area && nat ? fitRect(area.w, area.h, nat.width, nat.height) : null;
  // a vágókeret egyszeri inicializálása (teljes kép), amint a téglalap ismert —
  // állapot-beállítás renderben (a React ezt támogatja érték-megjelenéskor)
  if (img && crop === null) {
    setCrop({ ...img });
  }

  // straighten élő előnézet: a képet θ-val forgatjuk + akkorára nagyítjuk (sK),
  // hogy az arány-őrző, beírt (inscribed) téglalap kitöltse a keretet — így az
  // előnézet PONTOSAN azt mutatja, amit a bake (rotate + inscribe-crop) készít.
  const sK = (() => {
    if (!img || straighten === 0) {
      return 1;
    }
    const th = (Math.abs(straighten) * Math.PI) / 180;
    const c = Math.abs(Math.cos(th));
    const s = Math.abs(Math.sin(th));
    const r = img.w / img.h;
    const a = Math.min(img.w / 2 / (c + s / r), img.h / 2 / (s + c / r));
    return a > 0 ? img.w / (2 * a) : 1;
  })();

  const cropRef = useRef<Rect | null>(crop);
  cropRef.current = crop;
  const imgRef = useRef<Rect | null>(img);
  imgRef.current = img;
  const aspectRef = useRef<number | null>(aspect);
  aspectRef.current = aspect;
  const startRef = useRef<Rect | null>(null);

  const onAreaLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  };

  // — mozgatás (a keret belseje) —
  const bodyResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = cropRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const s = startRef.current;
        const b = imgRef.current;
        if (!s || !b) {
          return;
        }
        setCrop({
          ...s,
          x: clamp(s.x + g.dx, b.x, b.x + b.w - s.w),
          y: clamp(s.y + g.dy, b.y, b.y + b.h - s.h),
        });
      },
    })
  ).current;

  // — méretezés (sarok) —
  function cornerResponder(corner: Corner) {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = cropRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const s = startRef.current;
        const b = imgRef.current;
        if (!s || !b) {
          return;
        }
        const ratio = aspectRef.current;
        const hasL = corner === 'tl' || corner === 'bl';
        const hasR = corner === 'tr' || corner === 'br';
        const hasT = corner === 'tl' || corner === 'tr';
        const hasB = corner === 'bl' || corner === 'br';
        let left = s.x;
        let right = s.x + s.w;
        let top = s.y;
        let bottom = s.y + s.h;
        if (hasL) left = clamp(s.x + g.dx, b.x, right - MIN);
        if (hasR) right = clamp(s.x + s.w + g.dx, left + MIN, b.x + b.w);
        if (hasT) top = clamp(s.y + g.dy, b.y, bottom - MIN);
        if (hasB) bottom = clamp(s.y + s.h + g.dy, top + MIN, b.y + b.h);
        let w = right - left;
        let h = bottom - top;
        if (ratio) {
          // arány tartása: a szélességből számoljuk a magasságot, a mozgó
          // függőleges élt igazítjuk; ha kilóg, a magasságból korrigálunk
          h = w / ratio;
          if (hasT) {
            top = bottom - h;
            if (top < b.y) {
              top = b.y;
              h = bottom - top;
              w = h * ratio;
              if (hasL) left = right - w;
              else right = left + w;
            }
          } else {
            bottom = top + h;
            if (bottom > b.y + b.h) {
              bottom = b.y + b.h;
              h = bottom - top;
              w = h * ratio;
              if (hasL) left = right - w;
              else right = left + w;
            }
          }
        }
        setCrop({ x: left, y: top, w: right - left, h: bottom - top });
      },
    });
  }
  const tl = useRef(cornerResponder('tl')).current;
  const tr = useRef(cornerResponder('tr')).current;
  const bl = useRef(cornerResponder('bl')).current;
  const br = useRef(cornerResponder('br')).current;

  const pickAspect = (ratio: number | null) => {
    if (!img) {
      return;
    }
    setAspect(ratio);
    setCrop(centeredAspect(img, ratio));
  };

  const apply = () => {
    if (!img || !crop || !nat || busy) {
      return;
    }
    if (straighten !== 0) {
      // kiegyenesítés: forgatás θ-val, majd a legnagyobb ARÁNY-ŐRZŐ beírt
      // téglalap közepre-vágása (a sarok-rések eltűnnek, az eredmény álló)
      const th = (Math.abs(straighten) * Math.PI) / 180;
      const c = Math.abs(Math.cos(th));
      const s = Math.abs(Math.sin(th));
      const W = nat.width;
      const H = nat.height;
      const r = W / H;
      const Wr = W * c + H * s; // az elforgatott vászon (bounding box)
      const Hr = W * s + H * c;
      const a = Math.min(W / 2 / (c + s / r), H / 2 / (s + c / r));
      const cw = 2 * a;
      const ch = (2 * a) / r;
      onApplyOps([
        { type: 'rotate', degrees: straighten },
        { type: 'crop', originX: (Wr - cw) / 2, originY: (Hr - ch) / 2, width: cw, height: ch },
      ]);
      return;
    }
    const relX = (crop.x - img.x) / img.w;
    const relY = (crop.y - img.y) / img.h;
    const relW = crop.w / img.w;
    const relH = crop.h / img.h;
    onApplyOps([
      {
        type: 'crop',
        originX: relX * nat.width,
        originY: relY * nat.height,
        width: relW * nat.width,
        height: relH * nat.height,
      },
    ]);
  };

  const ready = !!(img && crop && area);

  return (
    <View style={styles.wrap}>
      <View style={styles.canvas} onLayout={onAreaLayout}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="none" />

        {ready && crop && img ? (
          straighten !== 0 ? (
            <View style={[styles.straightClip, { left: img.x, top: img.y, width: img.w, height: img.h }]}>
              <Image
                source={{ uri }}
                style={{
                  width: img.w,
                  height: img.h,
                  transform: [{ rotate: `${straighten}deg` }, { scale: sK }],
                }}
                contentFit="cover"
                cachePolicy="none"
              />
            </View>
          ) : (
            <>
              {/* elsötétített kívüli terület (4 sáv) */}
              <View style={[styles.dim, { left: 0, top: 0, right: 0, height: crop.y }]} />
              <View style={[styles.dim, { left: 0, top: crop.y + crop.h, right: 0, bottom: 0 }]} />
              <View style={[styles.dim, { left: 0, top: crop.y, width: crop.x, height: crop.h }]} />
              <View style={[styles.dim, { right: 0, top: crop.y, left: crop.x + crop.w, height: crop.h }]} />

              {/* keret + harmadoló rács + mozgató felület */}
              <View
                {...bodyResponder.panHandlers}
                style={[styles.frame, { left: crop.x, top: crop.y, width: crop.w, height: crop.h }]}
              >
                <View style={[styles.grid, { left: crop.w / 3 }]} />
                <View style={[styles.grid, { left: (crop.w * 2) / 3 }]} />
                <View style={[styles.gridH, { top: crop.h / 3 }]} />
                <View style={[styles.gridH, { top: (crop.h * 2) / 3 }]} />
              </View>

              {/* sarok-fogók */}
              <Handle style={{ left: crop.x - HANDLE / 2, top: crop.y - HANDLE / 2 }} responder={tl} c="tl" />
              <Handle style={{ left: crop.x + crop.w - HANDLE / 2, top: crop.y - HANDLE / 2 }} responder={tr} c="tr" />
              <Handle style={{ left: crop.x - HANDLE / 2, top: crop.y + crop.h - HANDLE / 2 }} responder={bl} c="bl" />
              <Handle
                style={{ left: crop.x + crop.w - HANDLE / 2, top: crop.y + crop.h - HANDLE / 2 }}
                responder={br}
                c="br"
              />
            </>
          )
        ) : null}

        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={palette.accent} />
          </View>
        ) : null}
      </View>

      {/* vezérlők: arány-chipek (csak vágásnál) + kiegyenesítés + alkalmaz */}
      <View style={styles.controls}>
        {straighten === 0 ? (
          <View style={styles.aspectRow}>
            {ASPECTS.map((a) => (
              <Chip
                key={a.id}
                label={a.id === 'free' ? t('imageStudio.crop.free') : a.id}
                active={aspect === a.ratio}
                onPress={() => pickAspect(a.ratio)}
              />
            ))}
          </View>
        ) : null}
        <StraightenSlider
          value={straighten}
          onChange={setStraighten}
          label={t('imageStudio.crop.straighten')}
        />
        <Pressable onPress={apply} disabled={busy || !ready} style={[styles.applyBtn, busy && styles.applyOff]}>
          <Text style={styles.applyText}>{t('common.apply')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Handle({
  style,
  responder,
  c,
}: {
  style: object;
  responder: ReturnType<typeof PanResponder.create>;
  c: Corner;
}) {
  const corner = {
    tl: { borderTopWidth: 3, borderLeftWidth: 3 },
    tr: { borderTopWidth: 3, borderRightWidth: 3 },
    bl: { borderBottomWidth: 3, borderLeftWidth: 3 },
    br: { borderBottomWidth: 3, borderRightWidth: 3 },
  }[c];
  return (
    <View {...responder.panHandlers} style={[styles.handle, style]}>
      <View style={[styles.handleMark, corner]} />
    </View>
  );
}

/** Kiegyenesítés-csúszka (−15°…+15°, 0.5° lépés); az érték-kijelzőre koppintva nulláz. */
function StraightenSlider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const MINv = -15;
  const MAXv = 15;
  const [w, setW] = useState(0);
  const wRef = useRef(w);
  wRef.current = w;
  const vRef = useRef(value);
  vRef.current = value;
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const startRef = useRef(value);
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = vRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const tw = Math.max(1, wRef.current - 22);
        const d = (g.dx / tw) * (MAXv - MINv);
        const v = Math.max(MINv, Math.min(MAXv, startRef.current + d));
        cbRef.current(Math.round(v * 2) / 2);
      },
    })
  ).current;
  const frac = (value - MINv) / (MAXv - MINv);
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHead}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Pressable onPress={() => onChange(0)} hitSlop={8}>
          <Text style={styles.sliderVal}>{`${value.toFixed(1)}°`}</Text>
        </Pressable>
      </View>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.trackLine} />
        <View style={styles.trackCenter} />
        <View style={[styles.thumb, { left: frac * Math.max(0, w - 22) }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  straightClip: { position: 'absolute', overflow: 'hidden' },
  sliderRow: { gap: 4, paddingHorizontal: 4 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { color: palette.text, fontSize: 13, fontWeight: '600' },
  sliderVal: { color: palette.accent, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 34, justifyContent: 'center' },
  trackLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.surfaceHigh,
  },
  trackCenter: {
    position: 'absolute',
    left: '50%',
    width: 2,
    height: 12,
    marginLeft: -1,
    backgroundColor: palette.border,
  },
  thumb: {
    position: 'absolute',
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
  wrap: { flex: 1 },
  canvas: {
    flex: 1,
    margin: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.55)' },
  frame: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.95)',
  },
  grid: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.4)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.4)' },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center' },
  handleMark: { width: 18, height: 18, borderColor: '#fff' },
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
  aspectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
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

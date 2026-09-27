import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  type LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { COVER_ASPECT, palette } from '@/constants/editor';
import { bakeImage, getImageSize, type ImageOp } from '@/lib/imageEditor';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Legnagyobb nagyítás — a húzáson felül közelíthet is a jobb kivágásért. */
const MAX_ZOOM = 3;
/** A bevágott borító max. szélessége px-ben (kisebb feltöltés, elég éles). */
const OUTPUT_MAX_W = 1440;

type Frame = { left: number; top: number; w: number; h: number };

/**
 * 🖼️ Borító-igazító — a kiválasztott képet a felhasználó FEL/LE (és oldalra)
 * húzza egy magas, `COVER_ASPECT` arányú vágókeretben, hogy eldöntse, mi
 * látszódjon; a „Kész" ESZKÖZÖN (expo-image-manipulator) pontosan a keretre
 * vágja. A bevágott fájl URI-ját adja vissza a szülőnek, ami feltölti/menti.
 */
export function CoverPhotoEditor({
  uri,
  busy,
  onCancel,
  onConfirm,
}: {
  /** a kiválasztott NYERS (helyi) kép URI-ja; `null` = a modal zárva */
  uri: string | null;
  /** a szülő feltöltése folyamatban (a „Kész" után) */
  busy: boolean;
  onCancel: () => void;
  /** a keretre bevágott, tartós helyi fájl URI-ja */
  onConfirm: (croppedUri: string) => void;
}) {
  const { t } = useTranslation();
  // a méretet az URI-hoz KÖTVE tartjuk — így nem szivárog át egy korábbi kép
  // mérete az újra (nincs szinkron setState az effektben)
  const [natFor, setNatFor] = useState<{ uri: string; width: number; height: number } | null>(null);
  const nat = natFor && natFor.uri === uri ? natFor : null;
  const [canvas, setCanvas] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  // a kép bal-felső sarkának eltolása a keret bal-felső sarkához képest (pt)
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [baking, setBaking] = useState(false);

  // eredeti pixelméret (dekódolással, eszközön) — a vágás-arány ebből jön
  useEffect(() => {
    if (!uri) {
      return;
    }
    let alive = true;
    getImageSize(uri)
      .then((s) => {
        if (alive) {
          setNatFor({ uri, width: s.width, height: s.height });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri]);

  // a keret (vágóablak) a vászonba illesztve, COVER_ASPECT arányban, középen
  const frame: Frame | null = useMemo(() => {
    if (!canvas) {
      return null;
    }
    const pad = 20;
    const maxW = canvas.w - pad * 2;
    const maxH = canvas.h - pad * 2;
    let w = maxW;
    let h = w / COVER_ASPECT;
    if (h > maxH) {
      h = maxH;
      w = h * COVER_ASPECT;
    }
    return { left: (canvas.w - w) / 2, top: (canvas.h - h) / 2, w, h };
  }, [canvas]);

  // a keretet MINIMUM kitöltő méretezés (cover-fit) × a felhasználói zoom
  const baseScale =
    frame && nat ? Math.max(frame.w / nat.width, frame.h / nat.height) : 0;
  const displayScale = baseScale * zoom;
  const dW = nat ? nat.width * displayScale : 0;
  const dH = nat ? nat.height * displayScale : 0;

  // az eltolás megengedett tartománya (a kép mindig fedje a keretet)
  const clampOffsets = (x: number, y: number) => {
    if (!frame) {
      return { x: 0, y: 0 };
    }
    return {
      x: clamp(x, frame.w - dW, 0),
      y: clamp(y, frame.h - dH, 0),
    };
  };

  // első illesztéskor (és a kép betöltésekor) középre igazítjuk a keretben
  const centeredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!frame || !nat) {
      return;
    }
    const key = `${uri}:${frame.w}x${frame.h}:${nat.width}x${nat.height}`;
    if (centeredRef.current === key) {
      return;
    }
    centeredRef.current = key;
    // zoom=1-re számolt méret, hogy a korábbi zoom ne rontsa el a középre igazítást
    const bdW = nat.width * baseScale;
    const bdH = nat.height * baseScale;
    setZoom(1);
    setTx((frame.w - bdW) / 2);
    setTy((frame.h - bdH) / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri, frame?.w, frame?.h, nat?.width, nat?.height]);

  // — húzás (pan) — a scroll/gesztus elől is elveszi a fókuszt
  const txRef = useRef(tx);
  txRef.current = tx;
  const tyRef = useRef(ty);
  tyRef.current = ty;
  const clampRef = useRef(clampOffsets);
  clampRef.current = clampOffsets;
  const startRef = useRef({ x: 0, y: 0 });
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = { x: txRef.current, y: tyRef.current };
      },
      onPanResponderMove: (_e, g) => {
        const next = clampRef.current(startRef.current.x + g.dx, startRef.current.y + g.dy);
        setTx(next.x);
        setTy(next.y);
      },
    })
  ).current;

  // zoom-lépés a keret KÖZEPÉT megtartva (természetes közelítés)
  const applyZoom = (z: number) => {
    if (!frame || !nat) {
      return;
    }
    const nextZoom = clamp(z, 1, MAX_ZOOM);
    const nextScale = baseScale * nextZoom;
    const anchorX = (frame.w / 2 - tx) / displayScale; // px az eredeti képen a keret közepén
    const anchorY = (frame.h / 2 - ty) / displayScale;
    const ndW = nat.width * nextScale;
    const ndH = nat.height * nextScale;
    const rawX = frame.w / 2 - anchorX * nextScale;
    const rawY = frame.h / 2 - anchorY * nextScale;
    setZoom(nextZoom);
    setTx(clamp(rawX, frame.w - ndW, 0));
    setTy(clamp(rawY, frame.h - ndH, 0));
  };

  const apply = async () => {
    if (!frame || !nat || baking || busy) {
      return;
    }
    // a keret által lefedett terület az EREDETI kép pixeleiben
    const originX = (-tx) / displayScale;
    const originY = (-ty) / displayScale;
    const cropW = frame.w / displayScale;
    const cropH = frame.h / displayScale;
    const ops: ImageOp[] = [{ type: 'crop', originX, originY, width: cropW, height: cropH }];
    if (cropW > OUTPUT_MAX_W) {
      ops.push({ type: 'resize', width: OUTPUT_MAX_W });
    }
    setBaking(true);
    try {
      const baked = await bakeImage(uri!, ops, { persist: true });
      onConfirm(baked.uri);
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setBaking(false);
    }
  };

  const ready = !!(frame && nat);
  const working = baking || busy;

  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="slide"
      onRequestClose={working ? undefined : onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} disabled={working} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="close" size={26} color={working ? palette.textDim : palette.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('profile.coverEditor.title')}</Text>
          <Pressable onPress={apply} disabled={!ready || working} hitSlop={10} style={styles.headerBtn}>
            <Text style={[styles.doneText, (!ready || working) && styles.doneOff]}>{t('common.done')}</Text>
          </Pressable>
        </View>

        <View
          style={styles.canvas}
          onLayout={(e: LayoutChangeEvent) =>
            setCanvas({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
          }
          {...pan.panHandlers}
        >
          {ready && frame ? (
            <>
              <Image
                source={{ uri: uri ?? undefined }}
                style={{ position: 'absolute', left: frame.left + tx, top: frame.top + ty, width: dW, height: dH }}
                contentFit="fill"
                cachePolicy="none"
              />
              {/* elsötétített kívüli terület (4 sáv) */}
              <View style={[styles.dim, { left: 0, top: 0, right: 0, height: frame.top }]} />
              <View style={[styles.dim, { left: 0, top: frame.top + frame.h, right: 0, bottom: 0 }]} />
              <View style={[styles.dim, { left: 0, top: frame.top, width: frame.left, height: frame.h }]} />
              <View style={[styles.dim, { right: 0, top: frame.top, left: frame.left + frame.w, height: frame.h }]} />
              {/* keret + harmadoló rács */}
              <View
                pointerEvents="none"
                style={[styles.frame, { left: frame.left, top: frame.top, width: frame.w, height: frame.h }]}
              >
                <View style={[styles.grid, { left: frame.w / 3 }]} />
                <View style={[styles.grid, { left: (frame.w * 2) / 3 }]} />
                <View style={[styles.gridH, { top: frame.h / 3 }]} />
                <View style={[styles.gridH, { top: (frame.h * 2) / 3 }]} />
              </View>
            </>
          ) : (
            <ActivityIndicator color={palette.accent} />
          )}

          {working ? (
            <View style={styles.busy}>
              <ActivityIndicator color={palette.accent} />
            </View>
          ) : null}
        </View>

        <View style={styles.controls}>
          <Text style={styles.hint}>{t('profile.coverEditor.hint')}</Text>
          <ZoomSlider value={zoom} onChange={applyZoom} label={t('profile.coverEditor.zoom')} />
        </View>
      </View>
    </Modal>
  );
}

/** Nagyítás-csúszka (1×…{MAX_ZOOM}×). Az értékre koppintva visszaáll 1×-re. */
function ZoomSlider({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const [w, setW] = useState(0);
  const wRef = useRef(w);
  wRef.current = w;
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const startRef = useRef(value);
  const vRef = useRef(value);
  vRef.current = value;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = vRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const tw = Math.max(1, wRef.current - 22);
        const d = (g.dx / tw) * (MAX_ZOOM - 1);
        cbRef.current(clamp(startRef.current + d, 1, MAX_ZOOM));
      },
    })
  ).current;
  const frac = (value - 1) / (MAX_ZOOM - 1);
  return (
    <View style={styles.sliderRow}>
      <View style={styles.sliderHead}>
        <Text style={styles.sliderLabel}>{label}</Text>
        <Pressable onPress={() => onChange(1)} hitSlop={8}>
          <Text style={styles.sliderVal}>{`${value.toFixed(1)}×`}</Text>
        </Pressable>
      </View>
      <View
        style={styles.track}
        onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
        {...pan.panHandlers}
      >
        <View style={styles.trackLine} />
        <View style={[styles.thumb, { left: frac * Math.max(0, w - 22) }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 52,
    paddingBottom: 12,
  },
  headerBtn: { minWidth: 60, justifyContent: 'center' },
  headerTitle: { color: palette.text, fontSize: 16, fontWeight: '800' },
  doneText: { color: palette.accent, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  doneOff: { opacity: 0.4 },
  canvas: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  frame: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.95)' },
  grid: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.4)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.4)' },
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
  controls: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 34, gap: 10 },
  hint: { color: palette.textDim, fontSize: 13, textAlign: 'center' },
  sliderRow: { gap: 4 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { color: palette.text, fontSize: 13, fontWeight: '600' },
  sliderVal: { color: palette.accent, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: { height: 34, justifyContent: 'center' },
  trackLine: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: palette.surfaceHigh },
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
});

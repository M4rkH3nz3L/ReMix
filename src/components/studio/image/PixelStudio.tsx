import { Ionicons } from '@expo/vector-icons';
import { Canvas, FilterMode, Group, Image as SkiaImage, MipmapMode, Path as SkiaPath, Rect, Skia } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Dimensions, Modal, type LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ColorField } from '@/components/studio/image/ColorField';
import { palette as ui } from '@/constants/editor';
import { logCaught } from '@/lib/logCaught';
import { saveImageToPhotos } from '@/lib/media';
import {
  createPixelArt,
  decodeFrame,
  encodeFrame,
  flipFrame,
  floodFill,
  frameRgba,
  MAX_FRAMES,
  MAX_PALETTE,
  paintLine,
  PIXEL_SIZES,
  removePaletteColor,
  shiftFrame,
  TRANSPARENT,
  type PixelArt,
  type PixelFrame,
} from '@/lib/pixelArt';
import { rgbaImage, writeLayerPng, writePixelGif, writeSpriteSheet } from '@/lib/pixelArtClient';
import { windowControlsInset } from '@/lib/windowControls';

type Tool = 'pencil' | 'eraser' | 'fill' | 'pick';
const TOOLS: { key: Tool; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'pencil', icon: 'pencil' },
  { key: 'eraser', icon: 'backspace-outline' },
  { key: 'fill', icon: 'color-fill-outline' },
  { key: 'pick', icon: 'eyedrop-outline' },
];
const HISTORY = 50;
const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };
const EXPORT_SCALE = 4;

/**
 * 👾 Pixel-szerkesztő: egy ujj rajzol, két ujj nagyít és mozgat. A második ujj érkezésekor a
 * megkezdett vonás visszavonódik, így a nagyítás nem hagy foltot.
 */
export function PixelStudio({
  initial,
  onDone,
  onClose,
}: {
  initial: PixelArt | null;
  onDone: (art: PixelArt, uri: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // a Modal a gyökér sávja fölé nyílik: az ablakgombok helyét itt is ki kell hagyni
  const controlsInset = windowControlsInset(Platform.OS === 'ios' && Platform.isPad, useWindowDimensions(), Dimensions.get('screen'));
  const [size, setSize] = useState<number | null>(initial?.width ?? null);
  const [art] = useState(() => initial);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [frames, setFrames] = useState<PixelFrame[]>(() => (art ? art.frames.map((f) => decodeFrame(f, art.width, art.height)) : []));
  const [colors, setColors] = useState<string[]>(() => art?.palette ?? createPixelArt(1, 1).palette);
  const [fps, setFps] = useState(art?.fps ?? 8);
  const [active, setActive] = useState(0);
  const [color, setColor] = useState(1);
  const [tool, setTool] = useState<Tool>('pencil');
  const [mirror, setMirror] = useState({ x: false, y: false });
  const [onion, setOnion] = useState(false);
  const [grid, setGrid] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [editColor, setEditColor] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tick, setTick] = useState(0);
  const past = useRef<PixelFrame[][]>([]);
  const future = useRef<PixelFrame[][]>([]);
  // a vonás saját másolatba fest: a következő mozdulat az újrarajzolás előtt is megérkezhet
  const stroke = useRef<{ before: PixelFrame; working: PixelFrame; last: { x: number; y: number } } | null>(null);
  const pinchBase = useRef(1);
  const panBase = useRef({ x: 0, y: 0 });

  const w = size ?? 0;
  const h = art?.height ?? size ?? 0;
  const cell = w > 0 ? (Math.min(view.w / w, view.h / h) || 0) * zoom : 0;
  const origin = { x: (view.w - w * cell) / 2 + pan.x, y: (view.h - h * cell) / 2 + pan.y };

  const start = (s: number) => {
    setSize(s);
    setFrames([new Uint8Array(s * s)]);
  };
  const remember = () => {
    past.current = [...past.current.slice(-HISTORY + 1), frames];
    future.current = [];
  };
  const undo = () => {
    const prev = past.current[past.current.length - 1];
    if (prev) {
      future.current = [...future.current, frames];
      past.current = past.current.slice(0, -1);
      setFrames(prev);
      setActive((a) => Math.min(a, prev.length - 1));
    }
  };
  const redo = () => {
    const next = future.current[future.current.length - 1];
    if (next) {
      past.current = [...past.current, frames];
      future.current = future.current.slice(0, -1);
      setFrames(next);
      setActive((a) => Math.min(a, next.length - 1));
    }
  };
  const editFrames = (next: PixelFrame[]) => {
    remember();
    setFrames(next);
  };
  const transform = (fn: (f: PixelFrame) => PixelFrame) => editFrames(frames.map((f, i) => (i === active ? fn(f) : f)));

  const toCell = (px: number, py: number) => ({ x: Math.floor((px - origin.x) / cell), y: Math.floor((py - origin.y) / cell) });
  const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h;

  // a kurrens értékeket a gesztus refből olvassa: egyszer jön létre
  const handlers = useRef({ begin: (_x: number, _y: number) => {}, move: (_x: number, _y: number) => {}, end: (_ok: boolean) => {} });
  handlers.current = {
    begin: (px, py) => {
      const p = toCell(px, py);
      if (!inside(p) || playing) {
        return;
      }
      setHover(p);
      const frame = frames[active];
      if (tool === 'pick') {
        if (frame[p.y * w + p.x] !== TRANSPARENT) {
          setColor(frame[p.y * w + p.x]);
          setTool('pencil');
        }
        return;
      }
      const next = frame.slice();
      if (tool === 'fill') {
        floodFill(next, w, h, p.x, p.y, color, mirror);
        editFrames(frames.map((f, i) => (i === active ? next : f)));
        return;
      }
      stroke.current = { before: frame, working: next, last: p };
      paintLine(next, w, h, p.x, p.y, p.x, p.y, tool === 'eraser' ? TRANSPARENT : color, mirror);
      setFrames(frames.map((f, i) => (i === active ? next : f)));
    },
    move: (px, py) => {
      const p = toCell(px, py);
      const s = stroke.current;
      setHover(inside(p) ? p : null);
      if (!s) {
        return;
      }
      paintLine(s.working, w, h, s.last.x, s.last.y, p.x, p.y, tool === 'eraser' ? TRANSPARENT : color, mirror);
      s.last = p;
      setTick((n) => n + 1);
    },
    end: (ok) => {
      const s = stroke.current;
      stroke.current = null;
      if (!s) {
        return;
      }
      if (ok) {
        past.current = [...past.current.slice(-HISTORY + 1), frames.map((f, i) => (i === active ? s.before : f))];
        future.current = [];
      } else {
        setFrames((list) => list.map((f, i) => (i === active ? s.before : f)));
      }
    },
  };
  const live = useRef({ zoom, pan });
  live.current = { zoom, pan };

  const gesture = useMemo(() => {
    const draw = Gesture.Pan()
      .runOnJS(true)
      .withTestId('pixel-draw')
      .maxPointers(1)
      .minDistance(0)
      .onStart((e) => handlers.current.begin(e.x, e.y))
      .onUpdate((e) => handlers.current.move(e.x, e.y))
      .onEnd((_e, success) => handlers.current.end(success))
      .onFinalize((_e, success) => {
        if (!success) {
          handlers.current.end(false);
        }
      });
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onStart(() => {
        pinchBase.current = live.current.zoom;
      })
      .onUpdate((e) => setZoom(Math.min(32, Math.max(1, pinchBase.current * e.scale))));
    const move = Gesture.Pan()
      .runOnJS(true)
      .minPointers(2)
      .onStart(() => {
        panBase.current = live.current.pan;
      })
      .onUpdate((e) => setPan({ x: panBase.current.x + e.translationX, y: panBase.current.y + e.translationY }));
    return Gesture.Exclusive(Gesture.Simultaneous(pinch, move), draw);
  }, []);

  useEffect(() => {
    if (!playing || frames.length < 2) {
      return;
    }
    const timer = setInterval(() => setActive((a) => (a + 1) % frames.length), 1000 / fps);
    return () => clearInterval(timer);
  }, [playing, frames.length, fps]);

  const image = useMemo(() => (w > 0 && frames[active] ? rgbaImage(frameRgba(frames[active], w, h, colors), w, h) : null), [frames, active, colors, w, h, tick]);
  const ghost = useMemo(() => (onion && active > 0 && !playing ? rgbaImage(frameRgba(frames[active - 1], w, h, colors), w, h) : null), [onion, frames, active, colors, w, h, playing]);
  // ennél kisebb cellán a rács elfedné a rajzot
  const showLines = cell >= 6;
  const lines = useMemo(() => {
    const path = Skia.Path.Make();
    if (showLines) {
      for (let x = 0; x <= w; x++) {
        path.moveTo(x, 0).lineTo(x, h);
      }
      for (let y = 0; y <= h; y++) {
        path.moveTo(0, y).lineTo(w, y);
      }
    }
    return path;
  }, [w, h, showLines]);

  const current = (): PixelArt => ({ width: w, height: h, palette: colors, frames: frames.map(encodeFrame), fps });
  const addFrame = (copy: boolean) => {
    if (frames.length < MAX_FRAMES) {
      editFrames([...frames.slice(0, active + 1), copy ? frames[active].slice() : new Uint8Array(w * h), ...frames.slice(active + 1)]);
      setActive(active + 1);
    }
  };
  const removeFrame = () => {
    if (frames.length > 1) {
      editFrames(frames.filter((_, i) => i !== active));
      setActive(Math.max(0, active - 1));
    }
  };
  const removeColor = (index: number) => {
    if (colors.length <= 1) {
      return;
    }
    const out = removePaletteColor(frames, colors, index);
    editFrames(out.frames);
    setColors(out.palette);
    setColor(1);
  };
  const save = async (write: () => string) => {
    try {
      const result = await saveImageToPhotos(write());
      Alert.alert(t(`studio.image.pixel.save.${result}`));
    } catch (caught) {
      logCaught('components/studio/image/PixelStudio.tsx:save', caught);
      Alert.alert(t('studio.image.pixel.save.failed'));
    }
  };
  const finish = () => {
    try {
      const out = current();
      onDone(out, writeLayerPng(out));
    } catch (caught) {
      logCaught('components/studio/image/PixelStudio.tsx:finish', caught);
      Alert.alert(t('studio.image.pixel.save.failed'));
    }
  };
  const btn = (icon: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, on = false, testID?: string) => (
    <Pressable key={label} testID={testID} style={[styles.btn, on ? styles.on : null]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}>
      <Ionicons name={icon} size={20} color={ui.text} />
    </Pressable>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={[styles.root, { paddingTop: Math.max(insets.top, controlsInset), paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          {btn('close', t('common.cancel'), onClose)}
          <Text style={styles.title}>{t('studio.image.pixel.title')}</Text>
          {size ? (
            <>
              {btn('arrow-undo', t('studio.image.pixel.undo'), undo)}
              {btn('arrow-redo', t('studio.image.pixel.redo'), redo)}
              <Pressable testID="pixel-done" style={styles.done} onPress={finish} accessibilityRole="button">
                <Text style={styles.doneText}>{t('studio.image.pixel.done')}</Text>
              </Pressable>
            </>
          ) : null}
        </View>
        {!size ? (
          <View style={styles.sizes}>
            <Text style={styles.label}>{t('studio.image.pixel.size')}</Text>
            {PIXEL_SIZES.map((s) => (
              <Pressable key={s} testID={`pixel-size-${s}`} style={styles.size} onPress={() => start(s)} accessibilityRole="button">
                <Text style={styles.sizeText}>{`${s} × ${s}`}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <>
            <GestureDetector gesture={gesture}>
              <View style={styles.stage} collapsable={false} onLayout={(e: LayoutChangeEvent) => setView({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
                {cell > 0 ? (
                  <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Group transform={[{ translateX: origin.x }, { translateY: origin.y }, { scale: cell }]}>
                      <Rect x={0} y={0} width={w} height={h} color="#2a2d38" />
                      {ghost ? <SkiaImage image={ghost} x={0} y={0} width={w} height={h} sampling={NEAREST} opacity={0.3} /> : null}
                      {image ? <SkiaImage image={image} x={0} y={0} width={w} height={h} sampling={NEAREST} /> : null}
                      {grid ? <SkiaPath path={lines} style="stroke" strokeWidth={1 / cell} color="#ffffff22" /> : null}
                    </Group>
                  </Canvas>
                ) : null}
              </View>
            </GestureDetector>
            <Text style={styles.coords}>{`${w} × ${h}${hover ? ` · ${hover.x}, ${hover.y}` : ''} · ${t('studio.image.pixel.frame', { n: active + 1, total: frames.length })}`}</Text>
            <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.row} showsHorizontalScrollIndicator={false}>
              {TOOLS.map((b) => btn(b.icon, t(`studio.image.pixel.${b.key}`), () => setTool(b.key), tool === b.key, `pixel-tool-${b.key}`))}
              {btn('swap-horizontal', t('studio.image.pixel.mirrorX'), () => setMirror((m) => ({ ...m, x: !m.x })), mirror.x, 'pixel-mirror-x')}
              {btn('swap-vertical', t('studio.image.pixel.mirrorY'), () => setMirror((m) => ({ ...m, y: !m.y })), mirror.y)}
              {btn('grid-outline', t('studio.image.pixel.grid'), () => setGrid((g) => !g), grid)}
              {btn('resize-outline', t('studio.image.pixel.fit'), () => { setZoom(1); setPan({ x: 0, y: 0 }); })}
              {btn('arrow-back', t('studio.image.pixel.shiftLeft'), () => transform((f) => shiftFrame(f, w, h, -1, 0)))}
              {btn('arrow-forward', t('studio.image.pixel.shiftRight'), () => transform((f) => shiftFrame(f, w, h, 1, 0)))}
              {btn('arrow-up', t('studio.image.pixel.shiftUp'), () => transform((f) => shiftFrame(f, w, h, 0, -1)))}
              {btn('arrow-down', t('studio.image.pixel.shiftDown'), () => transform((f) => shiftFrame(f, w, h, 0, 1)))}
              {btn('reorder-two-outline', t('studio.image.pixel.flipH'), () => transform((f) => flipFrame(f, w, h, 'h')))}
              {btn('reorder-four-outline', t('studio.image.pixel.flipV'), () => transform((f) => flipFrame(f, w, h, 'v')))}
            </ScrollView>
            <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.row} showsHorizontalScrollIndicator={false}>
              {colors.map((c, i) => (
                <Pressable
                  key={`${c}${i}`}
                  testID={`pixel-color-${i + 1}`}
                  style={[styles.swatch, { backgroundColor: c }, color === i + 1 ? styles.swatchOn : null]}
                  onPress={() => { setColor(i + 1); if (tool !== 'fill') setTool('pencil'); }}
                  onLongPress={() => removeColor(i + 1)}
                  accessibilityRole="button"
                  accessibilityLabel={c}
                  accessibilityHint={t('studio.image.pixel.removeHint')}
                />
              ))}
              {btn('color-palette-outline', t('studio.image.pixel.editColor'), () => setEditColor((v) => !v), editColor)}
              {colors.length < MAX_PALETTE ? btn('add', t('studio.image.pixel.addColor'), () => { setColors([...colors, colors[color - 1] ?? '#ffffff']); setColor(colors.length + 1); setEditColor(true); }) : null}
            </ScrollView>
            {editColor ? (
              <View style={styles.editor}>
                <ColorField value={colors[color - 1] ?? '#ffffff'} onChange={(c) => setColors(colors.map((v, i) => (i === color - 1 ? c : v)))} />
              </View>
            ) : null}
            <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.row} showsHorizontalScrollIndicator={false}>
              {btn(playing ? 'pause' : 'play', t('studio.image.pixel.play'), () => setPlaying((v) => !v), playing, 'pixel-play')}
              {btn('add-circle-outline', t('studio.image.pixel.addFrame'), () => addFrame(false), false, 'pixel-add-frame')}
              {btn('copy-outline', t('studio.image.pixel.copyFrame'), () => addFrame(true), false, 'pixel-copy-frame')}
              {btn('trash-outline', t('studio.image.pixel.removeFrame'), removeFrame)}
              {btn('layers-outline', t('studio.image.pixel.onion'), () => setOnion((v) => !v), onion)}
              {frames.map((_, i) => (
                <Pressable key={i} style={[styles.frame, i === active ? styles.on : null]} onPress={() => { setPlaying(false); setActive(i); }} accessibilityRole="button">
                  <Text style={styles.frameText}>{i + 1}</Text>
                </Pressable>
              ))}
              <Pressable style={styles.frame} onPress={() => setFps((f) => (f >= 24 ? 2 : f * 2))} accessibilityRole="button" accessibilityLabel={t('studio.image.pixel.speed')}>
                <Text style={styles.frameText}>{`${fps} fps`}</Text>
              </Pressable>
              <Pressable style={styles.frame} onPress={() => void save(() => writePixelGif(current(), EXPORT_SCALE))} accessibilityRole="button">
                <Text style={styles.frameText}>GIF</Text>
              </Pressable>
              <Pressable style={styles.frame} onPress={() => void save(() => writeSpriteSheet(current(), EXPORT_SCALE))} accessibilityRole="button">
                <Text style={styles.frameText}>{t('studio.image.pixel.sheet')}</Text>
              </Pressable>
            </ScrollView>
          </>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: ui.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 52 },
  title: { flex: 1, color: ui.text, fontSize: 16, fontWeight: '800' },
  done: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, justifyContent: 'center', backgroundColor: ui.accent },
  doneText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  sizes: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  label: { color: ui.textDim, fontSize: 14, fontWeight: '700' },
  size: { minWidth: 180, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.surfaceHigh },
  sizeText: { color: ui.text, fontSize: 16, fontWeight: '700' },
  stage: { flex: 1, overflow: 'hidden' },
  coords: { color: ui.textDim, fontSize: 12, fontWeight: '700', textAlign: 'center', paddingVertical: 6, fontVariant: ['tabular-nums'] },
  strip: { flexGrow: 0 },
  row: { alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6 },
  btn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.surfaceHigh },
  on: { borderWidth: 2, borderColor: ui.text },
  swatch: { width: 44, height: 44, borderRadius: 8, borderWidth: 1, borderColor: ui.border },
  swatchOn: { borderWidth: 3, borderColor: ui.text },
  editor: { paddingHorizontal: 10, paddingBottom: 6 },
  frame: { minWidth: 44, height: 44, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: ui.surfaceHigh },
  frameText: { color: ui.text, fontSize: 13, fontWeight: '700' },
});

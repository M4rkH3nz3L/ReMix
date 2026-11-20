import { Ionicons } from '@expo/vector-icons';
import { type Ref, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

import { type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { CanvasLayerStack } from '@/components/studio/image/canvas/CanvasLayerStack';
import { MultiSelectOutlines, PASTEBOARD, PasteboardVeil, SmartGuideMarks } from '@/components/studio/image/canvas/CanvasMarks';
import { EditOverlays } from '@/components/studio/image/canvas/EditOverlays';
import { GuideOverlays } from '@/components/studio/image/canvas/GuideOverlays';
import { createPathEditActions } from '@/components/studio/image/canvas/pathEditActions';
import { SelectionOverlays } from '@/components/studio/image/canvas/SelectionOverlays';
import { createBackdropTap, createLayerLongPress, createPanGesture, createPinchGesture } from '@/components/studio/image/canvas/viewportGestures';
import { type BrushSettings, DEFAULT_BRUSH } from '@/lib/brushEngine';
import { useUndoRedoGestures } from '@/hooks/useUndoRedoGestures';
import { layerAtPoint, stageToCanvas } from '@/lib/imageMulti';
import type { SkImage } from '@shopify/react-native-skia';
import type { Point, Selection } from '@/lib/selection';
import { aspectValue, palette } from '@/constants/editor';
import { canvasTransform, clampPan, zoomStep } from '@/lib/canvasZoom';
import type { CropRect } from '@/lib/imageCrop';
import { cornerPinTarget, pointOf, resolvePathEdit, snapLayerMove, stageFit, wandHit, withLive } from '@/lib/imageCanvasStage';
import { type SnapLine } from '@/lib/smartGuides';
import { resolveClipMasks } from '@/lib/imageClip';
import { useTextMasks } from '@/store/textMaskStore';
import { updateLayer, visibleLayers } from '@/lib/imageDoc';
import { type LivePatch } from '@/lib/imageLayerClip';
import { DocGrain, DocVignette } from '@/components/studio/image/DocVignette';
import type { CanvasPoint } from '@/lib/penPath';
import { addGuide, moveGuide, removeGuide } from '@/lib/rulers';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { correctionContext, correctionsKey, type CorrectionMap, docVignetteAngles, NO_CORRECTIONS } from '@/lib/imagePixelPipeline';
import type { ClipMask, ImageDoc, PhotoLayer } from '@/types/project';

/**
 * 🖼️ A Kép Stúdió VÁSZNA — a látható rétegeket ALULRÓL FÖLFELÉ rajzolja,
 * PONTOSAN a timeline-előnézet komponenseivel (ShapeOverlay/TextOverlay) →
 * render-paritás. A rétegek húzhatók (move), a kijelölt réteg mérete/forgatása a
 * kijelölő-kereten. Minden módosítás a command-buson megy (undo).
 */
export function ImageCanvas({
  doc,
  selectedId,
  onSelect,
  onRequestEdit,
  commit,
  canvasRef,
  capturing,
  cropRect,
  onCropRectChange,
  penPoints,
  onPenAddPoint,
  onPenClose,
  pathEditId,
  cornerPinId,
  pathEditRing = 0,
  selectedNode,
  onSelectNode,
  selection,
  marquee,
  onSelectionRing,
  lassoActive,
  onLassoComplete,
  onLassoCancel,
  wandActive,
  onWandSeed,
  brushActive,
  brushSettings = DEFAULT_BRUSH,
  brushLayerId,
  brushMaskMode,
  brushSource,
  onBrushNeedSource,
  onBrushHistory,
  brushRef,
  guidesActive,
  initialZoom = 1,
  cropAspect,
  onUndo,
  onRedo,
  onLayerLongPress,
  multiIds,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRequestEdit?: (id: string) => void;
  commit: (next: ImageDoc, label?: string) => void;
  /** a vászon View-ja — az on-device raszterizáláshoz (captureRef fallback) */
  canvasRef?: Ref<View>;
  /** raszterizálás alatt: a kijelölés-krómot (keret/kijelölő-szegély) elrejtjük */
  capturing?: boolean;
  /** ✂️ kivágás-mód: ha megadva, a vásznon a kivágás-overlay jelenik meg (kijelölés nélkül) */
  cropRect?: CropRect | null;
  onCropRectChange?: (rect: CropRect) => void;
  /** ✏️ toll-mód: ha megadva (nem null), a vásznon a toll-overlay jelenik meg */
  penPoints?: CanvasPoint[] | null;
  onPenAddPoint?: (p: CanvasPoint) => void;
  onPenClose?: () => void;
  /** ✏️ toll v2 node-szerkesztő mód: a megadott id-jű path-forma horgonypontjait húzhatja */
  pathEditId?: string | null;
  /** 🔲 S18: 4-sarkos perspektíva mód — ennek a fotónak a sarokfogói */
  cornerPinId?: string | null;
  /** összetett útvonalnál a szerkesztett gyűrű */
  pathEditRing?: number;
  /** ✏️ toll v3: a kijelölt node indexe (ennél jelennek meg a bezier-fogók) */
  selectedNode?: number | null;
  onSelectNode?: (index: number) => void;
  /** 🪢 lasszó-mód: szabadkézi húzás → zárt path-forma */
  /** ✂️ az aktív kijelölés; korlátozza az ecsetet */
  selection?: Selection | null;
  marquee?: 'rect' | 'ellipse' | null;
  onSelectionRing?: (ring: Point[]) => void;
  lassoActive?: boolean;
  onLassoComplete?: (points: CanvasPoint[]) => void;
  onLassoCancel?: () => void;
  /** 🪄 varázspálca-mód: fotóra koppintva szín-szelekció (Skia) */
  wandActive?: boolean;
  onWandSeed?: (
    uri: string,
    u: number,
    v: number,
    layer: PhotoLayer
  ) => void;
  /** 🖌️ ecset-mód: Skia raszter-festés (a snapshotot a szülő fotó-rétegként menti) */
  brushActive?: boolean;
  brushSettings?: BrushSettings;
  /** az ecsettel éppen szerkesztett festett réteg: rejtve, mert az overlay rajzolja */
  brushLayerId?: string | null;
  /** festett maszk: a réteg látszik, az overlay a maszkját szerkeszti */
  brushMaskMode?: boolean;
  /** retus: a vászon pillanatképe */
  brushSource?: SkImage | null;
  onBrushNeedSource?: (needed: boolean) => void;
  onBrushHistory?: (canUndo: boolean, canRedo: boolean) => void;
  brushRef?: Ref<BrushHandle>;
  /** 📐 vonalzók + segédvonalak megjelenítése/szerkesztése */
  guidesActive?: boolean;
  /** induló nagyítás (a munkaterület a csippentéssel/gombokkal változik tovább) */
  initialZoom?: number;
  /** kivágás aránytartása: pixel-arány (w/h), üres = szabad */
  cropAspect?: number | null;
  /** kétujjas koppintás a munkaterületen */
  onUndo?: () => void;
  /** háromujjas koppintás a munkaterületen */
  onRedo?: () => void;
  /** hosszú nyomás egy rétegen */
  onLayerLongPress?: (id: string) => void;
  /** több réteg kijelölése: ezek körvonala látszik */
  multiIds?: string[];
}) {
  const { t } = useTranslation();
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<{ id: string; patch: LivePatch } | null>(null);
  const [liveGuide, setLiveGuide] = useState<{ id: string; pos: number } | null>(null);
  // 🔍 nézegetős zoom/pan — a szerkesztés 1:1-nél, zoom>1-nél a pan-overlay veszi át a gesztust
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // 🧲 smart-guides: a pattintott tengelyek jelző-vonalai (rövid felvillanás a mozgatás után)
  const [smartLines, setSmartLines] = useState<SnapLine[]>([]);
  const smartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (smartTimer.current) {
      clearTimeout(smartTimer.current);
    }
  }, []);

  // a szabad W×H a mérvadó (kép-editor); különben a 3-arányos enum
  const av = doc.width && doc.height ? doc.width / doc.height : aspectValue(doc.aspectRatio);
  const fit = stageFit(container, av);

  // 🔍 munkaterület-nézet (RNGH): a csippentés és a kétujjas húzás a TELJES nézetet mozgatja,
  // egy ujj mindig a szerkesztésé. A gesztusok EGYSZER jönnek létre, a friss értékeket
  // refből olvassák; a csippentés a fókuszpontja körül nagyít.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const containerRef = useRef(container);
  containerRef.current = container;
  const panStart = useRef({ x: 0, y: 0 });
  const pinching = useRef(false);
  const pinchStart = useRef({ zoom: 1, pan: { x: 0, y: 0 }, focal: { x: 0, y: 0 } });
  /** a fókuszpont a munkaterület közepéhez mérve */
  const fromCenter = (e: { focalX: number; focalY: number }) => ({
    x: e.focalX - containerRef.current.w / 2,
    y: e.focalY - containerRef.current.h / 2,
  });
  const panGesture = useRef(createPanGesture({ panStart, panRef, pinching, setPan, zoomRef, fitRef })).current;
  const pinchGesture = useRef(createPinchGesture({ pinching, pinchStart, zoomRef, panRef, fromCenter, fitRef, setZoom, setPan })).current;
  // koppintás a vásznon kívüli üres területre: kijelölés megszüntetése
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const backdropTap = useRef(createBackdropTap({ setZoom, setPan, onSelectRef })).current;
  // hosszú nyomás a rétegen: a menü; a pontot a nézet aktuális állása szerint váltjuk vászon-arányra
  const longPress = useRef({ run: (_x: number, _y: number) => {} });
  const layerLongPress = useRef(createLayerLongPress({ longPress })).current;
  // kétujjas koppintás = visszavonás, háromujjas = újra (a profi rajz-appok szokása)
  const undoRedo = useUndoRedoGestures(() => onUndo?.(), () => onRedo?.());
  const canvasGesture = useRef(Gesture.Simultaneous(pinchGesture, panGesture, undoRedo, layerLongPress)).current;
  const tf = canvasTransform(zoom, pan, fit);
  longPress.current.run = (x, y) => {
    const hit = onLayerLongPress && fit.w > 0 ? layerAtPoint(doc, ...pointOf(stageToCanvas(x, y, container, fit, tf))) : null;
    if (hit) {
      onLayerLongPress?.(hit.id);
    }
  };
  const viewportStyle = capturing
    ? undefined
    : { transform: [{ translateX: tf.translateX }, { translateY: tf.translateY }, { scale: tf.scale }] };
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const applyZoom = (dir: 1 | -1) => {
    const z = zoomStep(zoomRef.current, dir);
    setZoom(z);
    setPan((p) => clampPan(p, z, fitRef.current));
  };

  // 📐 réteg-mozgatás: kézi vonalzó-guide-ok (ha vannak), MAJD 🧲 smart-guides (a többi réteghez + vászonhoz)
  const move = (id: string, position: { x: number; y: number }) => {
    const { pos, lines } = snapLayerMove(doc, id, position);
    if (lines) {
      // rövid jelző-vonal-felvillanás a pattintott tengely(ek)en
      if (smartTimer.current) {
        clearTimeout(smartTimer.current);
      }
      setSmartLines(lines);
      if (lines.length) {
        smartTimer.current = setTimeout(() => setSmartLines([]), 800);
      }
    }
    commit(updateLayer(doc, id, { position: pos }), 'move');
  };

  // 📐 segédvonal-műveletek (hozzáadás / élő-mozgatás / rögzítés|törlés)
  const guides = doc.guides ?? [];
  const displayGuides = liveGuide
    ? guides.map((g) => (g.id === liveGuide.id ? { ...g, pos: liveGuide.pos } : g))
    : guides;
  const onAddGuide = (axis: 'x' | 'y', pos: number) =>
    commit({ ...doc, guides: addGuide(guides, axis, pos) }, 'guide-add');
  const onCommitGuide = (id: string, pos: number | null) => {
    setLiveGuide(null);
    commit(
      { ...doc, guides: pos == null ? removeGuide(guides, id) : moveGuide(guides, id, pos) },
      'guide'
    );
  };

  // ✂️ S18: a vágómaszkok feloldva — a forma élő húzása (keret-fogó) közben is követi a vágás
  const textMasks = useTextMasks((s) => s.map);
  const clipped = useMemo(() => resolveClipMasks(live ? { ...doc, layers: doc.layers.map((l) => (l.id === live.id ? withLive(l, live.patch) : l)) } : doc, textMasks), [doc, live, textMasks]);
  const layers = visibleLayers(clipped);
  // ⚡ a rétegek memoizáltak: a kellékeik csak akkor változhatnak, ha tényleg más a rajzuk
  const box = useMemo(() => ({ w: fit.w, h: fit.h }), [fit.w, fit.h]);
  const { width: canvasW, height: canvasH } = effectiveCanvas(doc);
  const docCanvas = useMemo(() => ({ width: canvasW, height: canvasH }), [canvasW, canvasH]);
  const correctionMap = useRef<{ key: string; map: CorrectionMap<ClipMask> } | null>(null);
  const correctionKey = correctionsKey(doc);
  if (correctionMap.current?.key !== correctionKey) {
    correctionMap.current = { key: correctionKey, map: correctionContext<ClipMask>(doc) };
  }
  const corrections = (id: string) => correctionMap.current?.map.get(id) ?? NO_CORRECTIONS;
  const latest = useRef({ move, onSelect, onRequestEdit });
  latest.current = { move, onSelect, onRequestEdit };
  const stable = useRef({
    move: (id: string, position: { x: number; y: number }) => latest.current.move(id, position),
    select: (id: string | null) => latest.current.onSelect(id),
    edit: (id: string) => latest.current.onRequestEdit?.(id),
  }).current;
  const brushTarget = layers.find((l) => l.id === brushLayerId) as PhotoLayer | undefined;
  const selectedLayer = doc.layers.find((l) => l.id === selectedId) ?? null;

  // ✏️ node-szerkesztő: a kijelölt path-forma (committed = a moveAnchor stabil alapja)
  const cornerPinLayer = cornerPinTarget(doc, cornerPinId);
  const { rawPathShape, pathEditShape, pathEditLive } = resolvePathEdit(doc, pathEditId, pathEditRing, live);
  const pathEdit = createPathEditActions({ doc, commit, setLive, rawPathShape, pathEditShape, pathEditRing });

  // 🪄 varázspálca: a koppintás alatti LEGFELSŐ fotó-réteg + a dobozon belüli lokális (0–1) pont
  const onWandTap = (nx: number, ny: number) => {
    const hit = wandHit(doc, nx, ny);
    if (hit) {
      onWandSeed?.(hit.layer.uri, hit.u, hit.v, hit.layer);
    }
  };

  return (
    <GestureDetector gesture={canvasGesture}>
    <View
      style={styles.stage}
      collapsable={false}
      onLayout={(e: LayoutChangeEvent) =>
        setContainer({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      <GestureDetector gesture={backdropTap}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>
      {fit.w > 0 ? (
        <View style={[{ width: fit.w, height: fit.h }, viewportStyle]} pointerEvents="box-none">
        {/* a vászon NEM vág: a túllógó réteg a munkaterületen is látszik és megfogható;
            csak a raszterizálás idejére vág, keret és háttér nélkül */}
        <View ref={canvasRef} style={[{ width: fit.w, height: fit.h }, capturing && styles.canvasCapture]} collapsable={false}>
          {!capturing ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.paper]} /> : null}
          <CanvasLayerStack
            layers={layers}
            doc={doc}
            live={live}
            brushActive={brushActive}
            brushMaskMode={brushMaskMode}
            brushLayerId={brushLayerId}
            box={box}
            docCanvas={docCanvas}
            zoom={zoom}
            capturing={capturing}
            selectedId={selectedId}
            corrections={corrections}
            stable={stable}
            onRequestEdit={onRequestEdit}
          />

          {!capturing ? <MultiSelectOutlines multiIds={multiIds} doc={doc} docCanvas={docCanvas} fit={fit} zoom={zoom} /> : null}

          <DocVignette angles={docVignetteAngles(doc as Parameters<typeof docVignetteAngles>[0])} box={fit} />
          <DocGrain grain={doc.grain ?? 0} cell={fit.w / (doc.width || fit.w)} />

          {/* a vásznon kívüli rész halványan látszik; a fátyol nem fogja el az érintést */}
          {!capturing ? <PasteboardVeil zoom={zoom} /> : null}

          {/* 🧲 smart-guide jelző-vonalak (a pattintott tengelyeken, rövid felvillanás) */}
          {!capturing && <SmartGuideMarks lines={smartLines} fit={fit} />}

          <EditOverlays
            capturing={capturing}
            doc={doc}
            fit={fit}
            zoom={zoom}
            docCanvas={docCanvas}
            live={live}
            setLive={setLive}
            commit={commit}
            selectedLayer={selectedLayer}
            cropRect={cropRect}
            onCropRectChange={onCropRectChange}
            cropAspect={cropAspect}
            penPoints={penPoints}
            onPenAddPoint={onPenAddPoint}
            onPenClose={onPenClose}
            pathEditId={pathEditId}
            cornerPinId={cornerPinId}
            marquee={marquee}
            lassoActive={lassoActive}
            wandActive={wandActive}
            brushActive={brushActive}
            cornerPinLayer={cornerPinLayer}
            pathEditLive={pathEditLive}
            selectedNode={selectedNode}
            onSelectNode={onSelectNode}
            pathEdit={pathEdit}
          />

          <SelectionOverlays
            capturing={capturing}
            fit={fit}
            lassoActive={lassoActive}
            onLassoComplete={onLassoComplete}
            onLassoCancel={onLassoCancel}
            wandActive={wandActive}
            onWandTap={onWandTap}
            marquee={marquee}
            onSelectionRing={onSelectionRing}
            brushActive={brushActive}
            brushRef={brushRef}
            brushSettings={brushSettings}
            brushMaskMode={brushMaskMode}
            brushTarget={brushTarget}
            brushSource={brushSource}
            onBrushNeedSource={onBrushNeedSource}
            onBrushHistory={onBrushHistory}
            selection={selection}
          />

          <GuideOverlays
            capturing={capturing}
            doc={doc}
            fit={fit}
            zoom={zoom}
            guidesActive={guidesActive}
            guides={guides}
            displayGuides={displayGuides}
            onAddGuide={onAddGuide}
            onMoveGuide={(id, pos) => setLiveGuide({ id, pos })}
            onCommitGuide={onCommitGuide}
          />
        </View>
        </View>
      ) : null}

      {/* 🔍 zoom-vezérlők (jobb-fönt): nagyítás / kicsinyítés / vissza 1:1-re.
          Kivágás közben rejtve: a vágókeret jobb-felső sarokfogóját takarnák (élő teszt K1) */}
      {!capturing && !cropRect ? (
        <View style={styles.zoomBar} pointerEvents="box-none">
          <Pressable style={styles.zoomBtn} onPress={() => applyZoom(1)} accessibilityRole="button" accessibilityLabel={t('studio.image.zoomIn')}>
            <Ionicons name="add" size={18} color={palette.text} />
          </Pressable>
          <Pressable style={styles.zoomBtn} onPress={() => applyZoom(-1)} accessibilityRole="button" accessibilityLabel={t('studio.image.zoomOut')}>
            <Ionicons name="remove" size={18} color={palette.text} />
          </Pressable>
          {zoom !== 1 || pan.x !== 0 || pan.y !== 0 ? (
            <Pressable style={styles.zoomBtn} onPress={resetZoom} accessibilityRole="button" accessibilityLabel={t('studio.image.zoomFit')}>
              <Ionicons name="scan-outline" size={15} color={palette.accent} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: PASTEBOARD },
  paper: { backgroundColor: '#0b0c12' },
  // I12: az on-device kép a dokumentum, keret és szerkesztő-háttér nélkül; csak itt vág
  canvasCapture: { overflow: 'hidden', backgroundColor: 'transparent' },
  zoomBar: { position: 'absolute', top: 8, right: 8, gap: 6 },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: `${palette.surfaceHigh}ee`,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

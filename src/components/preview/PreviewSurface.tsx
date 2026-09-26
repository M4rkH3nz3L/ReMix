import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useIsFocused } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Polyline } from 'react-native-svg';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { HotspotOverlay } from '@/components/preview/HotspotOverlay';
import { MaskOverlay } from '@/components/preview/MaskOverlay';
import { PipLayer } from '@/components/preview/PipLayer';
import { SafeZoneOverlay } from '@/components/preview/SafeZoneOverlay';
import { TransitionLayer } from '@/components/preview/TransitionLayer';
import { ShapeOverlay } from '@/components/preview/ShapeOverlay';
import { TextOverlay } from '@/components/preview/TextOverlay';
import { aspectValue, filters, palette } from '@/constants/editor';
import { gradeTint } from '@/constants/grades';
import {
  hasKeyframes,
  sampleChannel,
  sampleClipTransform,
  setChannelKeyframe,
  shiftPositionKeyframes,
} from '@/lib/keyframes';
import { adjustTintLayers } from '@/lib/adjustPreview';
import { pathBounds, polylinePoints, simplifyPath, toBoxSpace } from '@/lib/draw';
import { addMaskKeyframe, hasMaskTrack, sampleMaskAt } from '@/lib/maskAnim';
import { maskFromStroke } from '@/lib/maskEdit';
import { makeId } from '@/lib/id';
import { ensureProxy, getProxyUriSync } from '@/lib/proxy';
import { snapPosition } from '@/lib/snapping';
import {
  activeAdjustClips,
  activeVisualClip,
  clipsAt,
  findClip,
  sourceTimeAt,
  trackOf,
} from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type {
  CanvasTransform,
  ImageClip,
  InteractiveClip,
  ShapeClip,
  TextClip,
  VideoClip,
} from '@/types/project';

const IDENTITY: CanvasTransform = { scale: 1, x: 0, y: 0 };

/** 💡 lighting-előnézet tintek — a valódi split-tone grade a renderben ég be */
const LIGHTING_TINTS: Record<string, { color: string; opacity: number }> = {
  studio: { color: '#fff6e8', opacity: 0.07 },
  sunset: { color: '#ff8a3d', opacity: 0.16 },
  neon: { color: '#c74dff', opacity: 0.14 },
  cyberpunk: { color: '#1ad1c4', opacity: 0.14 },
};

// adjustTintLayers → @/lib/adjustPreview (megosztva a Kép Stúdió Korrekcióval)

interface Props {
  mode: 'edit' | 'play';
  onHotspotPress?: (clip: InteractiveClip) => void;
}

/**
 * Az előnézet: a playhead alatti videó/kép klip + a szöveg- és hotspot-overlay-ek.
 * A videólejátszó a rAF-órához szinkronizál (forráscsere, seek, drift-korrekció).
 */
export function PreviewSurface({ mode, onHotspotPress }: Props) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const showSafeZones = useEditorStore((s) => s.showSafeZones);
  const toggleSafeZones = useEditorStore((s) => s.toggleSafeZones);
  const playhead = useEditorStore((s) => s.playhead);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  // a takart képernyő (push-navigáció mögött) ne játsszon — lásd a play/pause effektet
  const isFocused = useIsFocused();
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const focusMode = useEditorStore((s) => s.focusMode);
  const comparingOriginal = useEditorStore((s) => s.comparingOriginal);
  const setComparingOriginal = useEditorStore((s) => s.setComparingOriginal);
  const compareSplit = useEditorStore((s) => s.compareSplit);
  const setCompareSplit = useEditorStore((s) => s.setCompareSplit);
  const selectClip = useEditorStore((s) => s.selectClip);
  const updateClip = useEditorStore((s) => s.updateClip);
  const drawBrush = useEditorStore((s) => s.drawBrush);
  const drawMaskMode = useEditorStore((s) => s.drawMaskMode);
  const maskEdit = useEditorStore((s) => s.maskEdit);
  const rotoMask = useEditorStore((s) => s.rotoMask);
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  // 👁️ elrejtett (vizuális) sávok — az előnézetből kimaradnak (monitorozás, nem render)
  const hiddenTracks = useEditorStore((s) => s.hiddenTracks);
  // 🎙️ ha a JAVÍTOTT hang szól külön lejátszóról (AudioLayer/VideoVoice), a
  // videó saját sávját némítani kell — különben a kettő egyszerre szólna
  const videoVoiceActive = useEditorStore((s) => s.videoVoiceActive);
  const videoAudible =
    !videoVoiceActive &&
    (soloTracks.length > 0 ? soloTracks.includes('video') : !mutedTracks.includes('video'));

  const [container, setContainer] = useState({ w: 0, h: 0 });
  // smart guides: húzás közben aktív segédvonalak (vászon-normalizált)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  /**
   * A snap-kontextus: a TÖBBI overlay/szöveg-réteg középpontja a playheadnél
   * (a húzott kivételével) — ezekre igazodik és köztük egyenlő térközre ugrik
   * a húzott réteg. A rács a felhasználó kapcsolójától függ.
   */
  const snapContext = () => {
    const state = useEditorStore.getState();
    const dragged = state.selectedClipId;
    const peers = (state.project?.tracks ?? [])
      .filter((t) => t.type === 'overlay' || t.type === 'text' || t.type === 'captions')
      .flatMap((t) => t.clips)
      .filter(
        (c) =>
          c.id !== dragged &&
          'position' in c &&
          c.start <= state.playhead &&
          c.start + c.duration >= state.playhead
      )
      .map((c) => (c as { position: { x: number; y: number } }).position);
    return { peers, grid: state.snapGrid };
  };

  const handleDragLive = (position: { x: number; y: number } | null) => {
    if (!position) {
      setGuides({ x: null, y: null });
      return;
    }
    const snap = snapPosition(position.x, position.y, undefined, snapContext());
    setGuides({ x: snap.guideX, y: snap.guideY });
  };

  /** elengedéskor a kitüntetett vonalakra illesztett pozíció */
  const snapped = (position: { x: number; y: number }) => {
    const snap = snapPosition(position.x, position.y, undefined, snapContext());
    return { x: snap.x, y: snap.y };
  };

  // 👁️ a fő videó/kép sáv elrejtve → nincs vizuális klip az előnézetben
  const visual = project && !hiddenTracks.includes('video') ? activeVisualClip(project, playhead) : null;
  const videoClip = visual?.kind === 'video' ? (visual as VideoClip) : null;
  const imageClip = visual?.kind === 'image' ? (visual as ImageClip) : null;

  // vászon-transzform gesztusok (kijelölt vizuális klipen)
  const gestureScale = useSharedValue(1);
  const gestureDX = useSharedValue(0);
  const gestureDY = useSharedValue(0);
  const splitStartX = useSharedValue(0);

  const player = useVideoPlayer(null);
  const loadedUriRef = useRef<string | null>(null);

  // az előnézet a 720p vágási proxyt játssza, ha már elkészült — a klip
  // uri-ja (és így a render) mindig az eredeti marad
  const playbackUri = videoClip ? (getProxyUriSync(videoClip.uri) ?? videoClip.uri) : null;

  // háttérben elindítjuk a proxy-készítést a következő lejátszáshoz
  useEffect(() => {
    if (videoClip) {
      ensureProxy(videoClip.uri).catch(() => {});
    }
  }, [videoClip]);

  // forráscsere, ha másik videófájl klipjére ér a lejátszófej
  useEffect(() => {
    if (!videoClip || !playbackUri) {
      if (loadedUriRef.current !== null) {
        loadedUriRef.current = null;
        player.replaceAsync(null).catch(() => {});
      }
      return;
    }
    if (loadedUriRef.current === playbackUri) {
      return;
    }
    loadedUriRef.current = playbackUri;
    player
      .replaceAsync(playbackUri)
      .then(() => {
        const state = useEditorStore.getState();
        player.currentTime = sourceTimeAt(videoClip, state.playhead);
        if (state.isPlaying) {
          player.play();
        }
      })
      .catch(() => {});
  }, [player, videoClip, playbackUri]);

  // sebesség + hangerő követése (🎚️ volume-automációval a playheadből).
  // ⚡ A playhead ~60×/mp változik, de a hangerő általában NEM — ezért csak
  // érdemi eltérésnél írunk a natív lejátszóra (a fölösleges bridge-hívás a
  // JS-szálat és a natív oldalt is terheli). A küszöb hallhatatlanul kicsi.
  const lastVolRef = useRef<number | null>(null);
  useEffect(() => {
    if (!videoClip) {
      return;
    }
    player.playbackRate = videoClip.speed;
    // 🎚️ a videósáv némítása/solója is csak az előnézetre hat
    const vol = videoAudible
      ? clamp(
          sampleChannel(videoClip.keyframes?.volume, playhead - videoClip.start, videoClip.volume),
          0,
          1
        )
      : 0;
    if (lastVolRef.current === null || Math.abs(vol - lastVolRef.current) > 0.005) {
      player.volume = vol;
      lastVolRef.current = vol;
    }
  }, [player, videoClip, playhead, videoAudible]);

  // play/pause követése — ⚠️ csak a FÓKUSZÁLT képernyőn. A szerkesztő mountolva
  // marad a lejátszó képernyő mögött (`push`), kapu nélkül tehát két videó szólna
  // egyszerre ugyanarra az `isPlaying` állapotra.
  useEffect(() => {
    if (isPlaying && videoClip && isFocused) {
      player.play();
    } else {
      player.pause();
    }
  }, [player, isPlaying, videoClip, isFocused]);

  // 🔒 a natív lejátszó néha MAGÁTÓL elindul (iOS AVPlayer seek után) — ilyenkor a
  // store SZÜNETEL, a mesteróra áll (a lejátszófej/timeline nem mozog), a gomb
  // szünetet mutat, mégis megy a videó („árva" lejátszás). A playhead-alapú
  // effektek nem fogják meg, mert a fej ÁLL — ezért közvetlenül a lejátszó
  // állapot-eseményére iratkozunk fel, és ha a store szünetel, visszapauzáljuk.
  useEffect(() => {
    const sub = player.addListener('playingChange', ({ isPlaying: nowPlaying }) => {
      if (nowPlaying && !useEditorStore.getState().isPlaying) {
        try {
          player.pause();
        } catch {
          // a lejátszó épp cserélődik/tölt — a play/pause effekt úgyis rendezi
        }
      }
    });
    return () => sub.remove();
  }, [player]);

  // álló lejátszófejnél (görgetés/vágás) pontos seek. FONTOS: a natív lejátszót
  // PAUZÁLTAN is tartjuk — különben (pl. iOS AVPlayer seek-viselkedés miatt) a
  // videó tovább játszhat, miközben a store/gomb szünetet mutat (playhead-scrub
  // desync). A hang-réteg (AudioLayer) is így tesz minden seeknél.
  useEffect(() => {
    if (!videoClip || isPlaying) {
      return;
    }
    try {
      if (player.playing) {
        player.pause();
      }
      player.currentTime = sourceTimeAt(videoClip, playhead);
    } catch {
      // a forrás még töltődik — a replaceAsync utáni seek rendezi
    }
  }, [player, playhead, isPlaying, videoClip]);

  // lejátszás közben csak nagy eltérésnél nyúlunk bele (drift-korrekció)
  useEffect(() => {
    if (!videoClip || !isPlaying) {
      return;
    }
    const want = sourceTimeAt(videoClip, playhead);
    try {
      if (Math.abs(player.currentTime - want) > 0.35) {
        player.currentTime = want;
      }
    } catch {
      // forrás töltés alatt
    }
  }, [player, playhead, isPlaying, videoClip]);

  // a vászon méretre igazítása a rendelkezésre álló területhez
  const ar = project ? aspectValue(project.aspectRatio) : 0;
  let boxW = container.w;
  let boxH = ar > 0 ? boxW / ar : 0;
  if (boxH > container.h) {
    boxH = container.h;
    boxW = boxH * ar;
  }
  const box = { w: boxW, h: boxH };
  // 🅱️ before/after slider: a look-rétegek CSAK az elválasztótól jobbra fedjenek
  // (bal fél = nyers forrás). Slider nélkül teljes vászon. Nem-vizuális módban null.
  const sliderX = compareSplit != null ? Math.round(compareSplit * boxW) : 0;
  const lookGeom =
    compareSplit != null
      ? ({ position: 'absolute', top: 0, bottom: 0, left: sliderX, right: 0 } as const)
      : StyleSheet.absoluteFill;

  // minden szöveg-jellegű réteg: címek + feliratok + matricák
  const textClips = project
    ? (['text', 'captions', 'overlay'] as const).flatMap((type) => {
        if (hiddenTracks.includes(type)) {
          return []; // 👁️ elrejtett sáv kimarad az előnézetből
        }
        const track = project.tracks.find((t) => t.type === type);
        return track
          ? clipsAt<TextClip>(track, playhead).filter((c) => c.kind === 'text')
          : [];
      })
    : [];
  const interactiveClips =
    project && !hiddenTracks.includes('interactive')
      ? clipsAt<InteractiveClip>(trackOf(project, 'interactive'), playhead).filter(
          (c) => c.kind === 'interactive'
        )
      : [];
  const shapeClips =
    project && !hiddenTracks.includes('overlay')
      ? clipsAt<ShapeClip>(trackOf(project, 'overlay'), playhead).filter((c) => c.kind === 'shape')
      : [];
  // 🎨 grade-réteg(ek) a playheadnél: a teljes kompozitra ható tint-közelítés
  const adjustClips = project && !hiddenTracks.includes('adjust') ? activeAdjustClips(project, playhead) : [];

  const filterId = videoClip?.filterId ?? imageClip?.filterId ?? 'none';
  const filter = filters.find((f) => f.id === filterId);
  const filterIntensity =
    (videoClip ?? imageClip)?.filterIntensity ?? 1;

  // vászon-transzform: a kijelölt videó/kép klip csippentéssel nagyítható,
  // húzással pozicionálható; dupla koppintás visszaállítja. Kulcskockás klipen
  // a megjelenítés a playheadből interpolál, a gesztus pedig kulcskockát ír
  // a playhead időpontjára (nem a statikus transformot).
  const visualId = (videoClip ?? imageClip)?.id ?? null;
  const visualForTransform = videoClip ?? imageClip;
  const committed = visualForTransform
    ? sampleClipTransform(visualForTransform, playhead - visualForTransform.start)
    : IDENTITY;
  const canTransform =
    mode === 'edit' && visualId !== null && selectedClipId === visualId;

  const commitTransform = () => {
    const state = useEditorStore.getState();
    if (!state.project || !visualId) {
      return;
    }
    const clip = findClip(state.project, visualId)?.clip;
    if (!clip || (clip.kind !== 'video' && clip.kind !== 'image')) {
      return;
    }
    const tInClip = clamp(state.playhead - clip.start, 0, clip.duration);
    const current = sampleClipTransform(clip, tInClip);
    const scale = clamp(current.scale * gestureScale.value, 0.5, 4);
    const x = clamp(current.x + gestureDX.value / Math.max(boxW, 1), -0.75, 0.75);
    const y = clamp(current.y + gestureDY.value / Math.max(boxH, 1), -0.75, 0.75);
    gestureScale.value = 1;
    gestureDX.value = 0;
    gestureDY.value = 0;
    if (hasKeyframes(clip)) {
      const k = clip.keyframes ?? {};
      state.updateClip(visualId, {
        keyframes: {
          scale: setChannelKeyframe(k.scale, tInClip, scale, 'easeInOut'),
          x: setChannelKeyframe(k.x, tInClip, x, 'easeInOut'),
          y: setChannelKeyframe(k.y, tInClip, y, 'easeInOut'),
        },
      });
      return;
    }
    const t = clip.transform ?? IDENTITY;
    // a forgatást a gesztus nem módosítja, megőrizzük
    state.updateClip(visualId, { transform: { ...t, scale, x, y } });
  };

  const resetTransform = () => {
    if (visualId) {
      updateClip(visualId, { transform: undefined, keyframes: undefined });
    }
  };

  const pinch = Gesture.Pinch()
    .enabled(canTransform)
    .onUpdate((e) => {
      gestureScale.value = e.scale;
    })
    .onEnd(() => {
      runOnJS(commitTransform)();
    });

  /**
   * ✏️ Rajzoló-mód: a húzás pontjait gyűjtjük, felengedéskor egyszerűsítjük és
   * forma-klippé (`shape: 'path'`) alakítjuk. A pontok a VÁSZONRA normalizáltak;
   * a klip a saját befoglaló dobozába kerül, hogy utána húzható/méretezhető legyen.
   */
  const strokeRef = useRef<{ x: number; y: number }[]>([]);
  const [strokeLive, setStrokeLive] = useState<{ x: number; y: number }[]>([]);

  const addStrokePoint = (px: number, py: number) => {
    const p = {
      x: clamp(px / Math.max(boxW, 1), 0, 1),
      y: clamp(py / Math.max(boxH, 1), 0, 1),
    };
    strokeRef.current.push(p);
    setStrokeLive([...strokeRef.current]);
  };

  const commitStroke = () => {
    const state = useEditorStore.getState();
    const brush = state.drawBrush;
    const raw = strokeRef.current;
    strokeRef.current = [];
    setStrokeLive([]);
    if (!state.project) {
      return;
    }
    // ✂️ szabadkézi maszk: a zárt pálya a kijelölt videó/kép klip poligon-maszkja
    if (state.drawMaskMode) {
      if (raw.length < 3 || !visualId) {
        return;
      }
      const mask = maskFromStroke(simplifyPath(raw));
      if (mask) {
        state.updateClip(visualId, { mask });
        state.setDrawMaskMode(false); // egy rajz → kész; a fogantyúkkal finomítható
        state.setMaskEdit(true);
      }
      return;
    }
    if (!brush || raw.length < 2) {
      return;
    }
    const simplified = simplifyPath(raw);
    const aspect = boxW / Math.max(boxH, 1);
    const bounds = pathBounds(simplified, brush.width, aspect);
    if (!bounds) {
      return;
    }
    const id = makeId('clip');
    state.addClip('overlay', {
      kind: 'shape',
      id,
      start: state.playhead,
      duration: 3,
      shape: 'path',
      position: { x: bounds.x, y: bounds.y },
      w: bounds.w,
      h: bounds.h,
      fill: brush.color,
      points: toBoxSpace(simplified, bounds),
      strokeWidth: brush.width,
      opacity: brush.style === 'highlighter' ? 0.42 : 1,
      glow: brush.glow ? { color: brush.color, size: 1.6 } : undefined,
      blendMode: brush.style === 'highlighter' ? 'multiply' : undefined,
    });
  };

  // 🅱️ before/after slider elválasztójának húzása (a fogantyún, nem a vásznon)
  const dividerPan = Gesture.Pan()
    .onBegin(() => {
      splitStartX.value = sliderX;
    })
    .onUpdate((e) => {
      const frac = Math.min(1, Math.max(0, (splitStartX.value + e.translationX) / Math.max(boxW, 1)));
      runOnJS(setCompareSplit)(frac);
    });

  const drawPan = Gesture.Pan()
    .enabled(Boolean(drawBrush) || drawMaskMode)
    .minDistance(0)
    .onBegin((e) => {
      runOnJS(addStrokePoint)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(addStrokePoint)(e.x, e.y);
    })
    .onEnd(() => {
      runOnJS(commitStroke)();
    });

  const panCanvas = Gesture.Pan()
    .enabled(canTransform)
    .onUpdate((e) => {
      gestureDX.value = e.translationX;
      gestureDY.value = e.translationY;
    })
    .onEnd(() => {
      runOnJS(commitTransform)();
    });

  const doubleTapReset = Gesture.Tap()
    .numberOfTaps(2)
    .enabled(canTransform)
    .onEnd(() => {
      runOnJS(resetTransform)();
    });

  /** 🎯 téma-kijelölő mód: a koppintás pontja megy vissza a kérő panelnek */
  const handleCanvasTap = (px: number, py: number) => {
    const pick = useEditorStore.getState().pickTarget;
    if (pick) {
      pick({
        x: clamp(px / Math.max(boxW, 1), 0, 1),
        y: clamp(py / Math.max(boxH, 1), 0, 1),
      });
      useEditorStore.getState().setPickTarget(null);
      return;
    }
    if (visualId) {
      selectClip(visualId);
    }
  };

  const tapSelect = Gesture.Tap()
    .enabled(mode === 'edit')
    .onEnd((e) => {
      runOnJS(handleCanvasTap)(e.x, e.y);
    });

  // rajzoló-módban a rajzolás mindent megelőz (különben a húzás a klipet
  // mozgatná, a csippentés pedig zoomolna a vonal helyett)
  const canvasGesture =
    drawBrush || drawMaskMode
      ? drawPan
      : Gesture.Race(
          Gesture.Simultaneous(pinch, panCanvas),
          Gesture.Exclusive(doubleTapReset, tapSelect)
        );

  // a worklet minden renderben újraépül, a committed/boxW értékek frissek.
  // Térbeli döntésnél (🧊 3D V1) a sorrend a renderrel egyezik: a 2D-forgatás
  // a legbelső (arra vetül a perspektíva), a scale/translate a döntött képre hat.
  const committedRotation = committed.rotation ?? 0;
  const tiltRotX = visualForTransform?.tilt3d?.rotX ?? 0;
  const tiltRotY = visualForTransform?.tilt3d?.rotY ?? 0;
  const hasTilt = tiltRotX !== 0 || tiltRotY !== 0;
  const transformStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: committed.x * boxW + gestureDX.value },
      { translateY: committed.y * boxH + gestureDY.value },
      { scale: committed.scale * gestureScale.value },
      ...(hasTilt
        ? [
            { perspective: Math.max(boxH, 1) * 1.2 },
            { rotateX: `${tiltRotX}deg` },
            { rotateY: `${tiltRotY}deg` },
          ]
        : []),
      { rotate: `${committedRotation}deg` },
    ],
  }));

  // 🎞️ átlátszóság-automáció: az opacity-csatorna a playheadből (kf nélkül a statikus opacity)
  const mediaOpacity = visualForTransform
    ? sampleChannel(
        visualForTransform.keyframes?.opacity,
        playhead - visualForTransform.start,
        visualForTransform.opacity ?? 1
      )
    : (videoClip ?? imageClip)?.opacity ?? 1;

  // áttűnés feketéből/feketébe a vizuális klip szélein
  const visualClip = videoClip ?? imageClip;
  let fadeOpacity = 0;
  if (visualClip) {
    const tIn = playhead - visualClip.start;
    const tOut = visualClip.start + visualClip.duration - playhead;
    const fadeIn = visualClip.fadeInSec ?? 0;
    const fadeOut = visualClip.fadeOutSec ?? 0;
    if (fadeIn > 0) {
      fadeOpacity = Math.max(fadeOpacity, 1 - Math.min(Math.max(tIn / fadeIn, 0), 1));
    }
    if (fadeOut > 0) {
      fadeOpacity = Math.max(fadeOpacity, 1 - Math.min(Math.max(tOut / fadeOut, 0), 1));
    }
  }

  // az onLayout az első mounttól a konténeren van — ha csak a projekt
  // betöltése után kerülne rá, a már lezajlott layoutról sosem kapnánk eseményt
  return (
    <View
      style={styles.container}
      onLayout={(e) =>
        setContainer({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {project && boxW > 0 && boxH > 0 ? (
        <GestureDetector gesture={canvasGesture}>
          <View
            style={[
              styles.canvas,
              { width: boxW, height: boxH },
              canTransform ? styles.canvasSelected : null,
            ]}
          >
          {/* blur-háttér: a sávok kitöltése a klip cover-változatával — képnél
              valódi blur, videónál ambient-közelítés (ugyanaz a player, a
              valódi blur a renderben ég be). A transzform nem érinti. */}
          {(videoClip ?? imageClip)?.backgroundFill === 'blur' ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {videoClip ? (
                <VideoView
                  player={player}
                  style={[StyleSheet.absoluteFill, { opacity: 0.55 }]}
                  contentFit="cover"
                  nativeControls={false}
                />
              ) : imageClip ? (
                <Image
                  source={{ uri: imageClip.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  blurRadius={24}
                />
              ) : null}
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: '#00000055' }]}
              />
            </View>
          ) : null}

          {videoClip || imageClip ? (
            <Animated.View
              style={[StyleSheet.absoluteFill, { opacity: mediaOpacity }, transformStyle]}
            >
              {videoClip ? (
                <VideoView
                  player={player}
                  style={StyleSheet.absoluteFill}
                  contentFit="contain"
                  nativeControls={false}
                />
              ) : imageClip ? (
                <Image
                  // 🌫️ mélység-fókusznál a worker portré-blur változata megy
                  source={{ uri: imageClip.depthFocus?.previewUri ?? imageClip.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit={imageClip.backgroundFill === 'blur' ? 'contain' : 'cover'}
                />
              ) : null}
            </Animated.View>
          ) : (
            <View style={styles.empty}>
              {mode === 'edit' ? (
                <Text style={styles.emptyText}>
                  {t('editor.preview.emptyNoClip')}
                  {'\n'}
                  {t('editor.preview.emptyHint')}
                </Text>
              ) : null}
            </View>
          )}

          {/* maszk-közelítés (P0‑10): körvonal + a takart terület sötétítése —
              a valódi lágy szélű alfa-kivágás a renderben készül */}
          {(() => {
            const mask = (videoClip ?? imageClip)?.mask;
            if (!mask) {
              return null;
            }
            const mw = mask.w * boxW;
            const mh = mask.h * boxH;
            const left = mask.x * boxW - mw / 2;
            const top = mask.y * boxH - mh / 2;
            const radius = mask.shape === 'ellipse' ? Math.max(mw, mh) : 8;
            const shade = '#000000a8';
            return (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {mask.invert ? (
                  <View
                    style={{
                      position: 'absolute',
                      left,
                      top,
                      width: mw,
                      height: mh,
                      borderRadius: radius,
                      backgroundColor: shade,
                    }}
                  />
                ) : (
                  <>
                    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, height: Math.max(0, top), backgroundColor: shade }} />
                    <View style={{ position: 'absolute', left: 0, top: top + mh, right: 0, bottom: 0, backgroundColor: shade }} />
                    <View style={{ position: 'absolute', left: 0, top, width: Math.max(0, left), height: mh, backgroundColor: shade }} />
                    <View style={{ position: 'absolute', left: left + mw, top, right: 0, height: mh, backgroundColor: shade }} />
                  </>
                )}
                <View
                  style={{
                    position: 'absolute',
                    left,
                    top,
                    width: mw,
                    height: mh,
                    borderRadius: radius,
                    borderWidth: 1,
                    borderColor: palette.accent,
                    borderStyle: 'dashed',
                  }}
                />
              </View>
            );
          })()}

          {!comparingOriginal && filter && filter.overlay ? (
            <View
              pointerEvents="none"
              style={[
                lookGeom,
                { backgroundColor: filter.overlay, opacity: filter.opacity * filterIntensity },
              ]}
            />
          ) : null}

          {/* 🙈 arc-elmosás jelölése (a valódi blur a renderben ég be) */}
          {(() => {
            const fb = (videoClip ?? imageClip)?.faceBlur;
            return fb ? (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: (fb.x - fb.w / 2) * boxW,
                  top: (fb.y - fb.h / 2) * boxH,
                  width: fb.w * boxW,
                  height: fb.h * boxH,
                  backgroundColor: '#0b0f1acc',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: palette.accent,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: palette.text, fontSize: 11, fontWeight: '700' }}>
                  🙈 elmosás
                </Text>
              </View>
            ) : null;
          })()}

          {/* 💡 lighting-közelítés: hangulat-tint (a split-tone a renderben) */}
          {(() => {
            if (comparingOriginal) {
              return null;
            }
            const lighting = (videoClip ?? imageClip)?.lighting;
            const tint = lighting ? LIGHTING_TINTS[lighting] : null;
            return tint ? (
              <View
                pointerEvents="none"
                style={[
                  lookGeom,
                  { backgroundColor: tint.color, opacity: tint.opacity },
                ]}
              />
            ) : null;
          })()}

          {/* képjavítás-közelítés (Creative Canvas): fényerő/hőmérséklet/
              szaturáció rétegekkel — a pontos korrekció a renderben készül */}
          {(() => {
            const adjust = (videoClip ?? imageClip)?.adjust;
            if (!adjust || comparingOriginal) {
              return null;
            }
            return adjustTintLayers(adjust).map((l, i) => (
              <View
                key={i}
                pointerEvents="none"
                style={[
                  lookGeom,
                  { backgroundColor: l.color, opacity: l.opacity },
                ]}
              />
            ));
          })()}

          {fadeOpacity > 0 ? (
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: fadeOpacity }]}
            />
          ) : null}

          {/* 🎬 átmenet-előnézet: a klip-átmenet ablakában a következő klip beúszik
              (kereszttűnés/csúszás közelítés — a pontos xfade a renderben) */}
          <TransitionLayer box={box} />

          {/* 🎯 fókusz mód (#27): diszkrét overlay szerkesztésekor a base média
              elhalványul, hogy a szerkesztett elem kiemelkedjen (a scrim a média
              fölött, de az overlay-k ALATT van) */}
          {(() => {
            const selTrack =
              project && selectedClipId ? findClip(project, selectedClipId)?.track.type : undefined;
            const overlayTracks = ['text', 'captions', 'overlay', 'interactive', 'pip'];
            const dimBase =
              mode === 'edit' && focusMode && !!selTrack && overlayTracks.includes(selTrack);
            return dimBase ? (
              <View
                pointerEvents="none"
                style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0.5 }]}
              />
            ) : null;
          })()}

          {textClips.map((clip) => (
            <TextOverlay
              key={clip.id}
              clip={clip}
              // szerkesztésben álló lejátszófejnél a belépő-animáció "beállt"
              // állapota látszik — különben a klip elején láthatatlan lenne a szöveg
              t={
                mode === 'edit' && !isPlaying
                  ? Math.max(playhead - clip.start, 0.45)
                  : playhead - clip.start
              }
              box={box}
              editable={mode === 'edit'}
              selected={clip.id === selectedClipId}
              onSelect={selectClip}
              onDragLive={handleDragLive}
              onMove={(id, rawPosition) => {
                const position = snapped(rawPosition);
                // követett szövegnél a teljes pálya együtt mozog a húzással
                const state = useEditorStore.getState();
                const found = state.project ? findClip(state.project, id)?.clip : null;
                if (found?.kind === 'text' && found.keyframes) {
                  const dx = position.x - found.position.x;
                  const dy = position.y - found.position.y;
                  updateClip(id, {
                    position,
                    keyframes: shiftPositionKeyframes(found.keyframes, dx, dy),
                  });
                  return;
                }
                updateClip(id, { position });
              }}
              onEdit={(id) => {
                const state = useEditorStore.getState();
                state.selectClip(id);
                state.setPanel('text');
              }}
            />
          ))}

          {shapeClips.map((clip) => (
            <ShapeOverlay
              key={clip.id}
              clip={clip}
              box={box}
              editable={mode === 'edit'}
              selected={clip.id === selectedClipId}
              onSelect={selectClip}
              onDragLive={handleDragLive}
              onMove={(id, position) => updateClip(id, { position: snapped(position) })}
            />
          ))}

          {/* 🎬 PiP-réteg: a pip-sáv aktív klipje a fő videó fölé (2. szinkron videó) */}
          {hiddenTracks.includes('pip') ? null : <PipLayer box={box} editable={mode === 'edit'} />}

          {/* 🎨 grade-réteg-közelítés: az adjust-sáv aktív klipjei a TELJES
              kompozitot tintelik — előbb a filmes preset (grade), majd a kézi
              adjust (a valódi eq/colorbalance/vignette a renderben) */}
          {!comparingOriginal && adjustClips.flatMap((clip) => {
            // effektív erősség: strength × fade-burkológörbe (a klip elején/végén)
            const tLocal = playhead - clip.start;
            const inR = clip.fadeInSec ? clamp(tLocal / clip.fadeInSec, 0, 1) : 1;
            const outR = clip.fadeOutSec
              ? clamp((clip.duration - tLocal) / clip.fadeOutSec, 0, 1)
              : 1;
            const eff = (clip.strength ?? 1) * inR * outR;
            return [...gradeTint(clip.grade), ...adjustTintLayers(clip.adjust)].map((l, i) => (
              <View
                key={`${clip.id}-${i}`}
                pointerEvents="none"
                style={[
                  lookGeom,
                  { backgroundColor: l.color, opacity: l.opacity * eff },
                ]}
              />
            ));
          })}

          {/* smart guides: aktív segédvonalak húzás közben */}
          {guides.x !== null ? (
            <View
              pointerEvents="none"
              style={[styles.guideV, { left: guides.x * boxW - 0.5 }]}
            />
          ) : null}
          {guides.y !== null ? (
            <View
              pointerEvents="none"
              style={[styles.guideH, { top: guides.y * boxH - 0.5 }]}
            />
          ) : null}

          {interactiveClips.map((clip) => (
            <HotspotOverlay
              key={clip.id}
              clip={clip}
              t={playhead - clip.start}
              box={box}
              mode={mode}
              selected={clip.id === selectedClipId}
              onSelect={selectClip}
              onChangeRect={(id, rect) => updateClip(id, { rect })}
              onPress={onHotspotPress}
            />
          ))}

          {/* ✂️ maszk-fogantyúk a kijelölt klip maszkján; 🎬 rotoszkóp-módban a
              lejátszófejnél interpolált maszk látszik, és a szerkesztés kulcskockát ír */}
          {maskEdit && selectedClipId && visual && 'mask' in visual && visual.mask
            ? (() => {
                const baseMask = visual.mask;
                const tInClip = clamp(playhead - visual.start, 0, visual.duration);
                const shown = hasMaskTrack(baseMask) ? sampleMaskAt(baseMask, tInClip) : baseMask;
                return (
                  <MaskOverlay
                    mask={shown}
                    box={{ w: boxW, h: boxH }}
                    onChange={(next) =>
                      updateClip(visual.id, {
                        mask: rotoMask ? addMaskKeyframe(baseMask, tInClip, next) : next,
                      })
                    }
                  />
                );
              })()
            : null}

          {/* ✏️ a húzás közben rajzolódó vonal (forma VAGY szabadkézi maszk) */}
          {(drawBrush || drawMaskMode) && strokeLive.length >= 2 ? (
            <Svg
              pointerEvents="none"
              width={boxW}
              height={boxH}
              style={StyleSheet.absoluteFill}
            >
              <Polyline
                points={polylinePoints(strokeLive, boxW, boxH)}
                fill={drawMaskMode ? `${palette.accent}22` : 'none'}
                stroke={drawBrush?.color ?? palette.accent}
                strokeWidth={Math.max(1, ((drawBrush?.width ?? 2) / 100) * boxH)}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={drawBrush?.style === 'highlighter' ? 0.42 : 1}
              />
            </Svg>
          ) : null}

          {/* 🛡️ safe-zone overlay — csak szerkesztésben, kapcsolóra (pointerEvents none) */}
          {mode === 'edit' && showSafeZones ? (
            <SafeZoneOverlay width={boxW} height={boxH} aspect={project.aspectRatio} />
          ) : null}

          {/* 🅱️ before/after slider: elválasztó vonal + húzható fogantyú + oldal-címkék */}
          {mode === 'edit' && compareSplit != null ? (
            <>
              <View pointerEvents="none" style={[styles.splitLine, { left: sliderX }]} />
              <View pointerEvents="none" style={[styles.splitBadge, styles.splitBadgeLeft]}>
                <Text style={styles.splitBadgeText}>{t('editor.preview.original')}</Text>
              </View>
              <View pointerEvents="none" style={[styles.splitBadge, styles.splitBadgeRight]}>
                <Text style={styles.splitBadgeText}>{t('editor.preview.edited')}</Text>
              </View>
              <GestureDetector gesture={dividerPan}>
                <View style={[styles.splitHandle, { left: sliderX - 14 }]}>
                  <Ionicons name="code-outline" size={16} color="#fff" />
                </View>
              </GestureDetector>
            </>
          ) : null}
          </View>
        </GestureDetector>
      ) : null}

      {/* safe-zone kapcsoló (bal felső sarok, csak szerkesztésben) */}
      {mode === 'edit' && project ? (
        <Pressable
          onPress={toggleSafeZones}
          hitSlop={8}
          style={[styles.safeToggle, showSafeZones ? styles.safeToggleOn : null]}
          accessibilityRole="button"
          accessibilityState={{ selected: showSafeZones }}
          accessibilityLabel={t('editor.preview.safeZones')}
        >
          <Ionicons
            name="scan-outline"
            size={16}
            color={showSafeZones ? palette.accent : palette.textDim}
          />
        </Pressable>
      ) : null}

      {/* 🅱️ before/after: nyomva tartva a NYERS forrás látszik (look nélkül) */}
      {mode === 'edit' && project ? (
        <Pressable
          onPressIn={() => setComparingOriginal(true)}
          onPressOut={() => setComparingOriginal(false)}
          hitSlop={8}
          style={[styles.compareBtn, comparingOriginal ? styles.compareBtnOn : null]}
          accessibilityRole="button"
          accessibilityLabel={t('editor.preview.compareOriginal')}
        >
          <Ionicons
            name="git-compare-outline"
            size={16}
            color={comparingOriginal ? palette.accent : palette.textDim}
          />
        </Pressable>
      ) : null}

      {/* 🅱️ before/after SLIDER kapcsoló (eredeti | szerkesztett, húzható elválasztóval) */}
      {mode === 'edit' && project ? (
        <Pressable
          onPress={() => setCompareSplit(compareSplit == null ? 0.5 : null)}
          hitSlop={8}
          style={[styles.sliderToggle, compareSplit != null ? styles.compareBtnOn : null]}
          accessibilityRole="button"
          accessibilityState={{ selected: compareSplit != null }}
          accessibilityLabel={t('editor.preview.compareSlider')}
        >
          <Ionicons
            name="contrast-outline"
            size={16}
            color={compareSplit != null ? palette.accent : palette.textDim}
          />
        </Pressable>
      ) : null}

      {comparingOriginal ? (
        <View pointerEvents="none" style={styles.originalBadge}>
          <Text style={styles.originalBadgeText}>{t('editor.preview.original')}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  canvas: {
    backgroundColor: '#05060a',
    overflow: 'hidden',
  },
  safeToggle: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  safeToggleOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  compareBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  compareBtnOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  originalBadge: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: palette.accent,
  },
  originalBadgeText: {
    color: palette.text,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sliderToggle: {
    position: 'absolute',
    top: 44,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  splitLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: '#fff',
    opacity: 0.9,
  },
  splitHandle: {
    position: 'absolute',
    top: '50%',
    marginTop: -14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.accent,
    borderWidth: 2,
    borderColor: '#fff',
  },
  splitBadge: {
    position: 'absolute',
    top: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  splitBadgeLeft: {
    left: 8,
  },
  splitBadgeRight: {
    right: 8,
  },
  splitBadgeText: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  canvasSelected: {
    borderWidth: 1,
    borderColor: palette.accent,
    borderStyle: 'dashed',
  },
  guideV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: palette.accent,
    opacity: 0.9,
  },
  guideH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: palette.accent,
    opacity: 0.9,
  },
  empty: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: palette.textDim,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 20,
  },
});

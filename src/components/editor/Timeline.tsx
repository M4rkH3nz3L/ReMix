import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';

import { PacingLane } from '@/components/editor/PacingLane';
import { StoryLane } from '@/components/editor/StoryLane';
import { TimelineClip } from '@/components/editor/TimelineClip';
import { TimelineMinimap } from '@/components/editor/TimelineMinimap';
import { nextMarkerColor } from '@/components/editor/TransportBar';
import {
  BASE_PX_PER_SEC,
  palette,
  trackColors,
  trackHeights,
  trackLabels,
  trackOrder,
} from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { detectBeats, timelineBeats } from '@/lib/beats';
import { projectDuration } from '@/lib/projectUtils';
import { formatRuler } from '@/lib/time';
import { clipInWindow, windowFor } from '@/lib/virtualize';
import { useEditorStore } from '@/store/editorStore';
import type { Project, TrackType } from '@/types/project';

/** ezeken a sávokon van hang — csak ezek kapnak némítás/solo gombot */
const AUDIBLE_TRACKS: TrackType[] = ['video', 'music', 'voiceover', 'sfx'];

/** vizuális sávok — ezek kapnak láthatóság (szem) kapcsolót az előnézethez */
const VISUAL_TRACKS: TrackType[] = [
  'video',
  'pip',
  'adjust',
  'text',
  'captions',
  'overlay',
  'interactive',
];

/**
 * 📏 Automatikus sáv-magasság szorzói: a hang-sávok magasabbak a hullámformának,
 * a videó/PiP a filmstripnek, a vékony overlay/felirat/grade alacsonyabb.
 */
const AUTO_HEIGHT_FACTOR: Record<TrackType, number> = {
  video: 1.3,
  pip: 1.1,
  adjust: 0.8,
  text: 0.8,
  captions: 0.8,
  overlay: 0.8,
  interactive: 0.8,
  music: 1.4,
  voiceover: 1.3,
  sfx: 1,
};

/** sáv-ikonok a tablet-fejléchez (látványterv: ikon + címke oszlop) */
const trackIcons: Record<TrackType, keyof typeof Ionicons.glyphMap> = {
  video: 'videocam',
  pip: 'albums',
  adjust: 'color-filter',
  text: 'text',
  captions: 'chatbox-ellipses',
  overlay: 'happy',
  interactive: 'sparkles',
  music: 'musical-notes',
  voiceover: 'mic',
  sfx: 'volume-high',
};

/**
 * 🪟 Klip-virtualizáció küszöbei. Ennyi klip FÖLÖTT kapcsol be a windowing (ez
 * alatt a rövid projekt a régi, „mindent renderel + nulla re-render" úton marad),
 * és ennyi viewport-nyi overscan puffer van az ablak két szélén.
 */
const VIRTUALIZE_MIN_CLIPS = 60;
const OVERSCAN_FACTOR = 1.5;

/**
 * A video-sáv klipek közti (és vezető) hézagai — CSAK a fő videósávon jelent ez
 * fekete képkockát az exportban (overlay/text/audio sávon a hézag szándékos).
 */
function videoTrackGaps(
  clips: { id: string; start: number; duration: number }[]
): { start: number; end: number; nextId: string }[] {
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number; nextId: string }[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start - cursor > 0.2) {
      gaps.push({ start: cursor, end: c.start, nextId: c.id });
    }
    cursor = Math.max(cursor, c.start + c.duration);
  }
  return gaps;
}

/**
 * A zenesáv legkorábbi hangklipje — a beat-rács forrása. Azért van a komponensen
 * KÍVÜL, hogy a render és a beat-effekt ugyanazt a szabályt használja anélkül,
 * hogy az effektnek a render-beli objektum-referenciára kellene hivatkoznia.
 */
function firstMusicClip(project: Project | null | undefined) {
  const clip = project?.tracks
    .find((t) => t.type === 'music')
    ?.clips.filter((c) => c.kind === 'audio')
    .sort((a, b) => a.start - b.start)[0];
  return clip?.kind === 'audio' ? clip : undefined;
}

/**
 * CapCut-mintájú idővonal: a lejátszófej középen áll, a tartalom görgetésével
 * léptetünk (scroll offset ↔ playhead). Kétujjas csippentés = zoom.
 */
export function Timeline() {
  const { t } = useTranslation();
  const L = useLayout();
  const project = useEditorStore((s) => s.project);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  // 🎚️ sáv-monitorozás (előnézet-szintű) + 🔒 zárolás
  const mutedTracks = useEditorStore((s) => s.mutedTracks);
  const soloTracks = useEditorStore((s) => s.soloTracks);
  const lockedTracks = useEditorStore((s) => s.lockedTracks);
  const collapsedTracks = useEditorStore((s) => s.collapsedTracks);
  const trackHeightScale = useEditorStore((s) => s.trackHeightScale);
  const toggleTrackFlag = useEditorStore((s) => s.toggleTrackFlag);
  const cycleTrackHeight = useEditorStore((s) => s.cycleTrackHeight);
  const closeGapBefore = useEditorStore((s) => s.closeGapBefore);
  const suggestedCuts = useEditorStore((s) => s.suggestedCuts);
  const searchMatchTimes = useEditorStore((s) => s.searchMatchTimes);
  const insightLane = useEditorStore((s) => s.insightLane);
  const setInsightLane = useEditorStore((s) => s.setInsightLane);
  const addRegion = useEditorStore((s) => s.addRegion);
  const removeRegion = useEditorStore((s) => s.removeRegion);
  const recolorRegion = useEditorStore((s) => s.recolorRegion);
  const snapStrength = useEditorStore((s) => s.snapStrength);
  const cycleSnapStrength = useEditorStore((s) => s.cycleSnapStrength);
  const snapTargets = useEditorStore((s) => s.snapTargets);
  const toggleSnapTarget = useEditorStore((s) => s.toggleSnapTarget);
  // ✂️ borotva-mód (koppintásra vág) + képkocka-pontos split
  const razorMode = useEditorStore((s) => s.razorMode);
  const toggleRazorMode = useEditorStore((s) => s.toggleRazorMode);
  const splitClipAt = useEditorStore((s) => s.splitClipAt);
  // ✂️ trim-mód (normal/ripple/roll/slip/slide) — a fogantyú/test-húzás viselkedése
  const trimMode = useEditorStore((s) => s.trimMode);
  const cycleTrimMode = useEditorStore((s) => s.cycleTrimMode);
  // 👁️ láthatóság + 📏 automatikus magasság
  const hiddenTracks = useEditorStore((s) => s.hiddenTracks);
  const autoTrackHeight = useEditorStore((s) => s.autoTrackHeight);
  const toggleAutoTrackHeight = useEditorStore((s) => s.toggleAutoTrackHeight);
  // 🅸🅾 tartomány-kijelölés
  const rangeIn = useEditorStore((s) => s.rangeIn);
  const rangeOut = useEditorStore((s) => s.rangeOut);
  const setRangeIn = useEditorStore((s) => s.setRangeIn);
  const setRangeOut = useEditorStore((s) => s.setRangeOut);
  const clearRange = useEditorStore((s) => s.clearRange);
  const deleteRange = useEditorStore((s) => s.deleteRange);
  const regionFromRange = useEditorStore((s) => s.regionFromRange);

  /**
   * Telefonon nincs fejléc-oszlop, ezért a lebegő sáv-címke koppintása nyitja
   * a sáv-menüt. (Tableten ugyanezek külön ikongombok a fejlécben.)
   */
  const openTrackMenu = (type: TrackType) => {
    const muted = mutedTracks.includes(type);
    const solo = soloTracks.includes(type);
    const locked = lockedTracks.includes(type);
    const collapsed = collapsedTracks.includes(type);
    const hidden = hiddenTracks.includes(type);
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [];
    if (AUDIBLE_TRACKS.includes(type)) {
      buttons.push(
        {
          text: muted ? t('editor.timeline.unmute') : t('editor.timeline.mute'),
          onPress: () => toggleTrackFlag(type, 'mute'),
        },
        {
          text: solo ? t('editor.timeline.soloOff') : t('editor.timeline.soloOn'),
          onPress: () => toggleTrackFlag(type, 'solo'),
        }
      );
    }
    if (VISUAL_TRACKS.includes(type)) {
      buttons.push({
        text: hidden ? t('editor.timeline.show') : t('editor.timeline.hide'),
        onPress: () => toggleTrackFlag(type, 'hidden'),
      });
    }
    buttons.push(
      {
        text: locked ? t('editor.timeline.unlock') : t('editor.timeline.lock'),
        onPress: () => toggleTrackFlag(type, 'lock'),
      },
      {
        text: collapsed ? t('editor.timeline.expand') : t('editor.timeline.collapse'),
        onPress: () => toggleTrackFlag(type, 'collapse'),
      },
      {
        text: t('editor.timeline.height'),
        onPress: () => cycleTrackHeight(type),
      },
      {
        text: autoTrackHeight ? t('editor.timeline.autoHeightOff') : t('editor.timeline.autoHeightOn'),
        onPress: () => toggleAutoTrackHeight(),
      },
      { text: t('common.cancel'), style: 'cancel' }
    );
    Alert.alert(t(trackLabels[type]), t('editor.timeline.trackMenuMessage'), buttons);
  };

  /** ✂️ borotva-vágás: az adott sávon a `time`-nál elvágja a lefedő klipet */
  const razorCutAt = (type: TrackType, time: number) => {
    if (lockedTracks.includes(type)) {
      return;
    }
    const track = project?.tracks.find((tk) => tk.type === type);
    const clip = track?.clips.find((c) => c.start + 0.05 < time && time < c.start + c.duration - 0.05);
    if (clip) {
      splitClipAt(clip.id, Math.round(time * 100) / 100);
    }
  };

  /** 🧲 illesztési célpont-fajták kapcsolója (a magnet hosszú nyomására) */
  const openSnapMenu = () => {
    const row = (key: keyof typeof snapTargets, labelKey: string) => ({
      text: `${snapTargets[key] ? '✓ ' : '  '}${t(labelKey)}`,
      onPress: () => toggleSnapTarget(key),
    });
    Alert.alert(t('editor.snap.targetsTitle'), t('editor.snap.targetsMessage'), [
      row('playhead', 'editor.snap.targetPlayhead'),
      row('clips', 'editor.snap.targetClips'),
      row('markers', 'editor.snap.targetMarkers'),
      row('beats', 'editor.snap.targetBeats'),
      row('regions', 'editor.snap.targetRegions'),
      { text: t('common.done'), style: 'cancel' },
    ]);
  };

  /** 🅸🅾 tartomány-műveletek (a range-sávra koppintva) */
  const openRangeMenu = () => {
    Alert.alert(t('editor.range.title'), t('editor.range.message'), [
      { text: t('editor.range.region'), onPress: () => regionFromRange() },
      { text: t('editor.range.delete'), style: 'destructive', onPress: () => deleteRange() },
      { text: t('editor.range.clear'), onPress: () => clearRange() },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  /** 🔖 jelölő-menü (átnevezés / jegyzet / átszínezés / törlés) — a zászló hosszú nyomására */
  const openMarkerMenu = (markerId: string) => {
    const state = useEditorStore.getState();
    const markers = state.project?.markers ?? [];
    const m = markers.find((x) => x.id === markerId);
    if (!m) {
      return;
    }
    const save = (patch: Partial<typeof m>) =>
      state.dispatch({
        type: 'SET_MARKERS',
        markers: markers.map((x) => (x.id === markerId ? { ...x, ...patch } : x)),
      });
    const promptNote = () => {
      if (typeof Alert.prompt === 'function') {
        Alert.prompt(
          t('editor.marker.noteTitle'),
          undefined,
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.save'), onPress: (v?: string) => save({ note: (v ?? '').trim() || undefined }) },
          ],
          'plain-text',
          m.note ?? ''
        );
      }
    };
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' | 'destructive' }[] = [];
    if (typeof Alert.prompt === 'function') {
      buttons.push({
        text: t('editor.marker.rename'),
        onPress: () =>
          Alert.prompt(
            t('editor.marker.renameTitle'),
            undefined,
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.save'), onPress: (v?: string) => save({ label: (v ?? '').trim() || m.label }) },
            ],
            'plain-text',
            m.label
          ),
      });
      buttons.push({ text: m.note ? t('editor.marker.editNote') : t('editor.marker.addNote'), onPress: promptNote });
    }
    buttons.push(
      {
        text: t('editor.transportBar.recolorMarker'),
        onPress: () => save({ color: nextMarkerColor(m.color) }),
      },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () =>
          state.dispatch({ type: 'SET_MARKERS', markers: markers.filter((x) => x.id !== markerId) }),
      },
      { text: t('common.cancel'), style: 'cancel' }
    );
    Alert.alert(m.label, m.note ?? t('editor.marker.menuMessage'), buttons);
  };

  const scrollRef = useRef<ScrollView>(null);
  const scrubbing = useRef(false);
  const scrubEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrollX = useRef(0);
  const [viewportW, setViewportW] = useState(0);
  const zoomStart = useRef(zoom);
  // 🪟 a virtualizációs ablak (px, a belső view lokális koordinátájában) — chunkolt
  const [clipWindow, setClipWindow] = useState<{ start: number; end: number } | null>(null);
  const winCenterRef = useRef(0);

  const pps = BASE_PX_PER_SEC * zoom;
  const duration = project ? projectDuration(project) : 0;
  const contentW = Math.max(duration + 3, 8) * pps;

  // beat-rács a zenesáv első klipjéből — jelölők a vonalzón + snap-célpontok
  const beatTimes = useEditorStore((s) => s.beatTimes);
  const downbeatTimes = useEditorStore((s) => s.downbeatTimes);
  const musicClip = firstMusicClip(project);
  const musicKey = musicClip
    ? `${musicClip.uri}|${musicClip.start}|${musicClip.duration}`
    : null;
  /**
   * A klipet az effekt a STORE-ból veszi elő, nem a render-beli `musicClip`-ből.
   * Így a dep-lista őszintén `[musicKey]` lehet, és nem kell elnémítani a
   * hook-szabályt — korábban egy ilyen elnémítás miatt a React Compiler a
   * TELJES Timeline-t kihagyta az optimalizálásból.
   *
   * ⚠️ A fordító a KOMMENTEKBEN is keresi az elnémító direktívát, ezért ide
   * szándékosan nincs kiírva szó szerint: már a leírása is újra kiváltaná.
   */
  useEffect(() => {
    const { setBeatGrid, project: cur } = useEditorStore.getState();
    const clip = firstMusicClip(cur);
    if (!clip) {
      setBeatGrid([], []);
      return;
    }
    let alive = true;
    detectBeats(clip.uri).then((grid) => {
      if (!alive || !grid || grid.beats.length === 0) {
        return;
      }
      setBeatGrid(timelineBeats(clip, grid.beats), timelineBeats(clip, grid.downbeats));
    });
    return () => {
      alive = false;
    };
  }, [musicKey]);

  /**
   * ⚡ A scroll IMPERATÍVAN követi a lejátszófejet — a Timeline NEM iratkozik fel
   * a `playhead`-re.
   *
   * A playhead lejátszás közben ~60×/mp változik, de ebben a komponensben az
   * EGYETLEN felhasználása ez a `scrollTo` volt. Feliratkozva minden tick
   * újraépítette a teljes fát (vonalzó-osztások, beat-pontok — egy 3 perces,
   * 120 BPM-es zenénél ~450 View —, régiók, jelölők, vágás-javaslatok, keresési
   * találatok). A store-feliratkozás React-render NÉLKÜL fut le.
   */
  const ppsRef = useRef(pps);
  // a frissítés effektben, nem a render törzsében: a render-közbeni ref-írás
  // React-anti-minta, és a fordító emiatt is kihagyná a komponenst. A zoom
  // váltása amúgy is ritka, és a lenti `[pps]` effekt újra is pozicionál.
  useEffect(() => {
    ppsRef.current = pps;
  }, [pps]);
  useEffect(
    () =>
      useEditorStore.subscribe((s, prev) => {
        if (s.playhead === prev.playhead || scrubbing.current) {
          return;
        }
        const target = s.playhead * ppsRef.current;
        if (Math.abs(target - lastScrollX.current) > 2) {
          scrollRef.current?.scrollTo({ x: target, animated: false });
        }
      }),
    []
  );

  // zoom-váltáskor (pps változik) egyszer újra pozicionálunk — ez ritka esemény
  useEffect(() => {
    if (scrubbing.current) {
      return;
    }
    const target = useEditorStore.getState().playhead * pps;
    if (Math.abs(target - lastScrollX.current) > 2) {
      scrollRef.current?.scrollTo({ x: target, animated: false });
    }
  }, [pps]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    lastScrollX.current = x;
    if (scrubbing.current && !isPlaying) {
      setPlayhead(x / pps);
    }
    // 🪟 virtualizációs ablak: CHUNKOLT frissítés (csak fél viewportnyi elmozdulás
    // után) és CSAK sok klipnél — így a rövid projekt „nulla re-render" viselkedése
    // (a lejátszófej-scroll React-render nélkül fut) érintetlen marad.
    if (viewportW > 0 && Math.abs(x - winCenterRef.current) >= viewportW * 0.5) {
      const proj = useEditorStore.getState().project;
      const count = proj ? proj.tracks.reduce((n, tk) => n + tk.clips.length, 0) : 0;
      if (count > VIRTUALIZE_MIN_CLIPS) {
        winCenterRef.current = x;
        setClipWindow(windowFor(x, viewportW, OVERSCAN_FACTOR));
      }
    }
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      zoomStart.current = useEditorStore.getState().zoom;
    })
    .onUpdate((e) => {
      // 🔍 KVANTÁLT commit: a store-t (és így a teljes Timeline re-rendert) csak
      // érdemi (~4%) skálaváltozásnál írjuk — a pontos érték a pinch végén jön.
      // Így csippentés közben a re-renderek száma töredékére esik; a 2.1 klip-
      // virtualizációval együtt a hosszú idővonal csippentése is folyamatos marad.
      const next = zoomStart.current * e.scale;
      const cur = useEditorStore.getState().zoom;
      if (cur <= 0 || Math.abs(next - cur) / cur >= 0.04) {
        setZoom(next);
      }
    })
    .onEnd((e) => {
      setZoom(zoomStart.current * e.scale);
    })
    .runOnJS(true);

  if (!project) {
    return null;
  }

  const rulerStep = pps >= 90 ? 1 : pps >= 40 ? 2 : pps >= 18 ? 5 : 10;
  const rulerMarks: number[] = [];
  for (let t = 0; t <= Math.max(duration + 3, 8); t += rulerStep) {
    rulerMarks.push(t);
  }

  // csak a videó sáv + a tartalommal bíró sávok látszanak — 8 üres sáv helyett
  // kompakt idővonal, a sávok használatba vételkor jelennek meg
  const visibleTracks = trackOrder.filter((type) => {
    if (type === 'video') {
      return true;
    }
    return (project.tracks.find((t) => t.type === type)?.clips.length ?? 0) > 0;
  });

  // nagyobb kijelzőn vastagabb sávok — könnyebb célozni és olvasni
  // 🔽 összecsukott sáv: vékony „lane" marad (a klip-terület elrejtve)
  const COLLAPSED_H = 18;
  const th = (t: TrackType) =>
    collapsedTracks.includes(t)
      ? COLLAPSED_H
      : Math.round(
          trackHeights[t] *
            L.editor.trackScale *
            (autoTrackHeight ? AUTO_HEIGHT_FACTOR[t] : trackHeightScale[t] ?? 1)
        );

  const totalTracksHeight = visibleTracks.reduce((sum, t) => sum + th(t), 0);

  // 🪟 klip-virtualizáció: hosszú projekten (sok klip) csak a látható ABLAK +
  // overscan klipjeit rendereljük — a mountolt klip-komponensek száma korlátos
  // marad, akárhány klip is van. Rövid projekten `virtualize=false` → mindent
  // renderel (0 regresszió). Az ablak a lejátszófej-középhez képest centrált
  // (a paddingHorizontal=viewportW/2 miatt a lokális ablak scrollX körül szimmetrikus).
  const totalClipCount = project.tracks.reduce((n, tk) => n + tk.clips.length, 0);
  const virtualize = viewportW > 0 && totalClipCount > VIRTUALIZE_MIN_CLIPS;
  const clipWin = virtualize
    ? (clipWindow ?? windowFor(lastScrollX.current, viewportW, OVERSCAN_FACTOR))
    : null;
  const clipVisible = (c: { start: number; duration: number }) => clipInWindow(c, clipWin, pps);

  // 🖥️ tablet/széles kijelző: fix fejléc-oszlop ikon+címkével a sávok elején;
  // a görgethető terület a saját szélességét méri, a scroll-matek változatlan.
  // A küszöb a közös méret-osztályból jön (nem külön 700px-es szabály).
  const showHeaders = L.editor.trackHeaderWidth > 0;

  return (
    <View>
      {/* 🔎 insight-sáv: egyszerre EGY nézet (story / minimap / pacing) — kevés chrome */}
      <View style={styles.insightTabs}>
        {(['story', 'map', 'pacing'] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setInsightLane(k)}
            hitSlop={4}
            style={[styles.insightTab, insightLane === k ? styles.insightTabActive : null]}
          >
            <Text
              style={[
                styles.insightTabText,
                insightLane === k ? styles.insightTabTextActive : null,
              ]}
            >
              {t('editor.insight.' + k)}
            </Text>
          </Pressable>
        ))}
        {/* ✂️ trim-mód: normal → ripple → roll → slip → slide (a fogantyú/test-húzás viselkedése) */}
        <Pressable
          onPress={cycleTrimMode}
          hitSlop={4}
          style={[styles.snapBtn, { marginLeft: 'auto' }, trimMode !== 'normal' ? styles.iconBtnActive : null]}
          accessibilityLabel={t('editor.trim.label')}
        >
          <Ionicons
            name="git-compare-outline"
            size={12}
            color={trimMode === 'normal' ? palette.textDim : palette.accent}
          />
          <Text style={[styles.regionAddText, trimMode === 'normal' ? { color: palette.textDim } : { color: palette.accent }]}>
            {t('editor.trim.' + trimMode)}
          </Text>
        </Pressable>
        {/* ✂️ borotva-mód: koppintásra vág az idővonalon */}
        <Pressable
          onPress={toggleRazorMode}
          hitSlop={4}
          style={[styles.iconBtn, razorMode ? styles.iconBtnActive : null]}
          accessibilityLabel={t('editor.razor.label')}
        >
          <Ionicons name="cut" size={13} color={razorMode ? palette.accent : palette.textDim} />
        </Pressable>
        {/* 🅸🅾 tartomány kezdet/vég a lejátszófejnél */}
        <Pressable
          onPress={setRangeIn}
          hitSlop={4}
          style={[styles.iconBtn, rangeIn != null ? styles.iconBtnActive : null]}
          accessibilityLabel={t('editor.range.setIn')}
        >
          <Text style={[styles.ioText, rangeIn != null ? { color: palette.accent } : null]}>I</Text>
        </Pressable>
        <Pressable
          onPress={setRangeOut}
          hitSlop={4}
          style={[styles.iconBtn, rangeOut != null ? styles.iconBtnActive : null]}
          accessibilityLabel={t('editor.range.setOut')}
        >
          <Text style={[styles.ioText, rangeOut != null ? { color: palette.accent } : null]}>O</Text>
        </Pressable>
        {/* 🧲 illesztés-erősség: normál → erős → ki (hosszú nyomás: célpont-menü) */}
        <Pressable
          onPress={cycleSnapStrength}
          onLongPress={openSnapMenu}
          hitSlop={4}
          style={styles.snapBtn}
          accessibilityLabel={t('editor.snap.label')}
        >
          <Ionicons
            name={snapStrength === 'off' ? 'magnet-outline' : 'magnet'}
            size={12}
            color={snapStrength === 'off' ? palette.textDim : palette.accent2}
          />
          <Text style={[styles.regionAddText, snapStrength === 'off' ? { color: palette.textDim } : null]}>
            {t('editor.snap.' + snapStrength)}
          </Text>
        </Pressable>
        {/* 🏷️ régió a kijelölt klipből / a lejátszófejnél */}
        <Pressable
          onPress={addRegion}
          hitSlop={4}
          style={styles.regionAddBtn}
          accessibilityLabel={t('editor.regions.add')}
        >
          <Ionicons name="bookmarks-outline" size={12} color={palette.accent2} />
          <Text style={styles.regionAddText}>{t('editor.regions.add')}</Text>
        </Pressable>
      </View>
      {insightLane === 'story' ? (
        <StoryLane />
      ) : insightLane === 'map' ? (
        <TimelineMinimap viewportW={viewportW} pps={pps} />
      ) : (
        <PacingLane />
      )}
      <GestureDetector gesture={pinch}>
        <View style={styles.outerRow}>
        {showHeaders ? (
          <View style={[styles.headerCol, { width: L.editor.trackHeaderWidth }]}>
            <View style={{ height: RULER_HEIGHT }} />
            {visibleTracks.map((type) => (
              <View
                key={type}
                style={[styles.headerRow, { height: th(type) }]}
              >
                <Ionicons name={trackIcons[type]} size={L.isExpanded ? 16 : 13} color={trackColors[type]} />
                <Text
                  style={[styles.headerText, { color: trackColors[type], fontSize: L.font(10) }]}
                  numberOfLines={1}
                >
                  {t(trackLabels[type])}
                </Text>
                <View style={styles.headerBtns}>
                  {AUDIBLE_TRACKS.includes(type) ? (
                    <>
                      <Pressable
                        hitSlop={6}
                        onPress={() => toggleTrackFlag(type, 'mute')}
                        style={styles.headerBtn}
                      >
                        <Ionicons
                          name={mutedTracks.includes(type) ? 'volume-mute' : 'volume-medium-outline'}
                          size={12}
                          color={mutedTracks.includes(type) ? palette.accent2 : palette.textDim}
                        />
                      </Pressable>
                      <Pressable
                        hitSlop={6}
                        onPress={() => toggleTrackFlag(type, 'solo')}
                        style={styles.headerBtn}
                      >
                        <Ionicons
                          name={soloTracks.includes(type) ? 'star' : 'star-outline'}
                          size={12}
                          color={soloTracks.includes(type) ? palette.accent : palette.textDim}
                        />
                      </Pressable>
                    </>
                  ) : null}
                  {VISUAL_TRACKS.includes(type) ? (
                    <Pressable
                      hitSlop={6}
                      onPress={() => toggleTrackFlag(type, 'hidden')}
                      style={styles.headerBtn}
                    >
                      <Ionicons
                        name={hiddenTracks.includes(type) ? 'eye-off-outline' : 'eye-outline'}
                        size={12}
                        color={hiddenTracks.includes(type) ? palette.accent2 : palette.textDim}
                      />
                    </Pressable>
                  ) : null}
                  <Pressable
                    hitSlop={6}
                    onPress={() => toggleTrackFlag(type, 'lock')}
                    style={styles.headerBtn}
                  >
                    <Ionicons
                      name={lockedTracks.includes(type) ? 'lock-closed' : 'lock-open-outline'}
                      size={12}
                      color={lockedTracks.includes(type) ? palette.accent2 : palette.textDim}
                    />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <View
          style={styles.container}
          onLayout={(e) => setViewportW(e.nativeEvent.layout.width)}
        >
        <ScrollView
          ref={scrollRef}
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onScrollBeginDrag={() => {
            scrubbing.current = true;
            if (scrubEndTimer.current) {
              clearTimeout(scrubEndTimer.current);
            }
            if (useEditorStore.getState().isPlaying) {
              setPlaying(false);
            }
          }}
          onScrollEndDrag={() => {
            // ha nem indul momentum, rövid idő után visszaadjuk az auto-követést
            scrubEndTimer.current = setTimeout(() => {
              scrubbing.current = false;
            }, 120);
          }}
          onMomentumScrollBegin={() => {
            if (scrubEndTimer.current) {
              clearTimeout(scrubEndTimer.current);
            }
            scrubbing.current = true;
          }}
          onMomentumScrollEnd={() => {
            scrubbing.current = false;
          }}
          contentContainerStyle={{ paddingHorizontal: viewportW / 2 }}
        >
          <View style={{ width: contentW }}>
            <View style={styles.ruler}>
              {rulerMarks.map((t) => (
                <View key={t} style={[styles.rulerMark, { left: t * pps }]}>
                  <View style={styles.tick} />
                  <Text style={styles.rulerText}>{formatRuler(t)}</Text>
                </View>
              ))}
              {/* beat-jelölők: pötty minden beatre, erősebb a downbeatre */}
              {beatTimes.map((t) => (
                <View key={`b${t}`} style={[styles.beatDot, { left: t * pps - 1.5 }]} />
              ))}
              {downbeatTimes.map((t) => (
                <View key={`d${t}`} style={[styles.downbeatDot, { left: t * pps - 2 }]} />
              ))}
              {/* 🏷️ régiók: halvány, teljes-magas sáv (a klipek mögött, nem fog gesztust) */}
              {(project.regions ?? []).map((r) => (
                <View
                  key={`rb-${r.id}`}
                  pointerEvents="none"
                  style={[
                    styles.regionBand,
                    {
                      left: r.start * pps,
                      width: Math.max(2, (r.end - r.start) * pps),
                      height: RULER_HEIGHT + totalTracksHeight,
                      backgroundColor: `${r.color}1f`,
                      borderColor: r.color,
                    },
                  ]}
                />
              ))}
              {/* régió-címkék a tetején: tap = ugrás, hosszú-nyomás = átszínez/törlés */}
              {(project.regions ?? []).map((r) => (
                <Pressable
                  key={`rl-${r.id}`}
                  hitSlop={6}
                  onPress={() => useEditorStore.getState().setPlayhead(r.start)}
                  onLongPress={() =>
                    Alert.alert(r.label, t('editor.regions.menuMessage'), [
                      { text: t('editor.regions.recolor'), onPress: () => recolorRegion(r.id) },
                      { text: t('common.delete'), style: 'destructive', onPress: () => removeRegion(r.id) },
                      { text: t('common.cancel'), style: 'cancel' },
                    ])
                  }
                  style={[styles.regionLabel, { left: r.start * pps, borderColor: r.color, backgroundColor: `${r.color}33` }]}
                >
                  <Text style={styles.regionLabelText} numberOfLines={1}>
                    {r.label}
                  </Text>
                </Pressable>
              ))}
              {/* 🔖 szerkezeti jelölők: zászló + felirat, koppintásra odaugrik, hosszú nyomásra menü */}
              {(project.markers ?? []).map((m) => (
                <Pressable
                  key={m.id}
                  hitSlop={8}
                  onPress={() => useEditorStore.getState().setPlayhead(m.time)}
                  onLongPress={() => openMarkerMenu(m.id)}
                  style={[styles.markerFlag, { left: m.time * pps }]}
                >
                  <View style={[styles.markerStem, m.color ? { backgroundColor: m.color } : null]} />
                  <Text
                    style={[styles.markerText, m.color ? { color: m.color } : null]}
                    numberOfLines={1}
                  >
                    {m.label}
                  </Text>
                  {/* 📝 jegyzet-jelző pötty */}
                  {m.note ? (
                    <View style={[styles.markerNoteDot, m.color ? { backgroundColor: m.color } : null]} />
                  ) : null}
                </Pressable>
              ))}
              {/* 🅸🅾 tartomány-kijelölés: teljes-magas sáv + kezdet/vég vonal + fogantyú-chip */}
              {rangeIn != null ? (
                <View
                  pointerEvents="none"
                  style={[styles.rangeEdge, { left: rangeIn * pps, height: RULER_HEIGHT + totalTracksHeight }]}
                />
              ) : null}
              {rangeOut != null ? (
                <View
                  pointerEvents="none"
                  style={[styles.rangeEdge, { left: rangeOut * pps, height: RULER_HEIGHT + totalTracksHeight }]}
                />
              ) : null}
              {rangeIn != null && rangeOut != null && rangeOut > rangeIn ? (
                <>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.rangeBand,
                      {
                        left: rangeIn * pps,
                        width: (rangeOut - rangeIn) * pps,
                        height: RULER_HEIGHT + totalTracksHeight,
                      },
                    ]}
                  />
                  <Pressable
                    hitSlop={6}
                    onPress={openRangeMenu}
                    style={[styles.rangeChip, { left: rangeIn * pps }]}
                  >
                    <Ionicons name="scan-outline" size={10} color={palette.accent} />
                    <Text style={styles.rangeChipText}>{(rangeOut - rangeIn).toFixed(1)}s</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            {visibleTracks.map((type) => {
              const track = project.tracks.find((t) => t.type === type);
              return (
                <View
                  key={type}
                  style={[
                    styles.trackRow,
                    // halvány, sáv-színű "lane" háttér (látványterv szerint)
                    {
                      height: th(type),
                      backgroundColor: `${trackColors[type]}0d`,
                    },
                  ]}
                >
                  {track && !collapsedTracks.includes(type)
                    ? track.clips.filter(clipVisible).map((clip) => (
                        <TimelineClip
                          key={clip.id}
                          clip={clip}
                          trackType={type}
                          pps={pps}
                          height={th(type)}
                          selected={clip.id === selectedClipId}
                          multiSelected={multiSelectIds.includes(clip.id)}
                        />
                      ))
                    : null}
                  {/* ⚠️ hézag-jelző a fő videósávon: koppintásra bezárul (visszavonható) */}
                  {type === 'video' && track && !collapsedTracks.includes(type)
                    ? videoTrackGaps(track.clips).map((g, i) => (
                        <Pressable
                          key={`gap-${i}`}
                          hitSlop={6}
                          onPress={() => closeGapBefore(g.nextId)}
                          accessibilityRole="button"
                          accessibilityLabel={t('editor.timeline.gapRemove', {
                            seconds: (g.end - g.start).toFixed(1),
                          })}
                          style={[
                            styles.gap,
                            { left: g.start * pps, width: (g.end - g.start) * pps, height: th(type) },
                          ]}
                        >
                          <Ionicons name="warning" size={11} color={palette.danger} />
                          {(g.end - g.start) * pps > 46 ? (
                            <Text style={styles.gapText}>{(g.end - g.start).toFixed(1)}s</Text>
                          ) : null}
                        </Pressable>
                      ))
                    : null}
                  {/* ✂️ borotva-réteg: koppintásra elvágja a lefedő klipet ezen a sávon */}
                  {razorMode && !collapsedTracks.includes(type) && !lockedTracks.includes(type) ? (
                    <Pressable
                      style={styles.razorLayer}
                      onPress={(e) => razorCutAt(type, e.nativeEvent.locationX / pps)}
                    />
                  ) : null}
                </View>
              );
            })}
            {/* ✂️ javasolt vágások (#36): szaggatott, teljes-magas, nem-destruktív */}
            {suggestedCuts.map((cutT, i) => (
              <View
                key={`cut-${i}`}
                pointerEvents="none"
                style={[
                  styles.suggestedCut,
                  { left: cutT * pps, height: RULER_HEIGHT + totalTracksHeight },
                ]}
              />
            ))}
            {/* 🔎 Smart Search találatok (Phase 2.2): teljes-magas kiemelő vonal */}
            {searchMatchTimes.map((mt, i) => (
              <View
                key={`match-${i}`}
                pointerEvents="none"
                style={[
                  styles.searchMatch,
                  { left: mt * pps, height: RULER_HEIGHT + totalTracksHeight },
                ]}
              />
            ))}
          </View>
        </ScrollView>

        {/* sáv-címkék (nem görgetődnek) — fejléc-oszlopos módban rejtve */}
        {showHeaders ? null : (
          <View pointerEvents="box-none" style={styles.trackLabels}>
            <View pointerEvents="none" style={{ height: RULER_HEIGHT }} />
            {visibleTracks.map((type) => (
              <View
                key={type}
                pointerEvents="box-none"
                style={[styles.trackLabelRow, { height: th(type) }]}
              >
                <Pressable
                  hitSlop={6}
                  onPress={() => openTrackMenu(type)}
                  style={[styles.trackLabelChip, { borderColor: trackColors[type] }]}
                >
                  <Text style={[styles.trackLabelText, { color: trackColors[type], fontSize: L.font(8) }]}>
                    {t(trackLabels[type])}
                  </Text>
                  {mutedTracks.includes(type) ? (
                    <Ionicons name="volume-mute" size={9} color={palette.accent2} />
                  ) : null}
                  {soloTracks.includes(type) ? (
                    <Ionicons name="star" size={9} color={palette.accent} />
                  ) : null}
                  {lockedTracks.includes(type) ? (
                    <Ionicons name="lock-closed" size={9} color={palette.accent2} />
                  ) : null}
                  {collapsedTracks.includes(type) ? (
                    <Ionicons name="chevron-expand" size={9} color={palette.textDim} />
                  ) : null}
                  {hiddenTracks.includes(type) ? (
                    <Ionicons name="eye-off-outline" size={9} color={palette.accent2} />
                  ) : null}
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* középre rögzített lejátszófej */}
        <View
          pointerEvents="none"
          style={[
            styles.playhead,
            { left: viewportW / 2 - 1, height: RULER_HEIGHT + totalTracksHeight },
          ]}
        />
        </View>
      </View>
      </GestureDetector>
    </View>
  );
}

const RULER_HEIGHT = 22;

const styles = StyleSheet.create({
  outerRow: {
    flexDirection: 'row',
  },
  headerCol: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    borderRightWidth: 1,
    borderRightColor: palette.border,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    // a sávokkal azonos elválasztó, hogy a fejléc-sorok pixelre igazodjanak
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  headerText: {
    fontWeight: '700',
    flexShrink: 1,
  },
  container: {
    flex: 1,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingBottom: 8,
  },
  ruler: {
    height: RULER_HEIGHT,
  },
  rulerMark: {
    position: 'absolute',
    top: 0,
    alignItems: 'flex-start',
  },
  tick: {
    width: 1,
    height: 6,
    backgroundColor: palette.textDim,
  },
  rulerText: {
    color: palette.textDim,
    fontSize: 9,
    marginTop: 1,
  },
  trackRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  gap: {
    position: 'absolute',
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: '#ff5c7222',
    borderWidth: 1,
    borderColor: '#ff5c7266',
    borderStyle: 'dashed',
    borderRadius: 4,
  },
  gapText: {
    color: palette.danger,
    fontSize: 9,
    fontWeight: '700',
  },
  suggestedCut: {
    position: 'absolute',
    top: 0,
    width: 0,
    borderLeftWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.accent,
  },
  searchMatch: {
    position: 'absolute',
    top: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: palette.accent2,
    opacity: 0.75,
  },
  regionBand: {
    position: 'absolute',
    top: 0,
    borderLeftWidth: 2,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  regionLabel: {
    position: 'absolute',
    top: 1,
    maxWidth: 130,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  regionLabelText: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '700',
  },
  snapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  regionAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  regionAddText: {
    color: palette.accent2,
    fontSize: 11,
    fontWeight: '700',
  },
  insightTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: 4,
    gap: 6,
    marginHorizontal: 8,
    marginBottom: 3,
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 24,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  iconBtnActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  ioText: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '800',
  },
  razorLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  rangeEdge: {
    position: 'absolute',
    top: 0,
    width: 1.5,
    marginLeft: -0.75,
    backgroundColor: palette.accent,
    opacity: 0.9,
  },
  rangeBand: {
    position: 'absolute',
    top: 0,
    backgroundColor: `${palette.accent}22`,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: palette.accent,
  },
  rangeChip: {
    position: 'absolute',
    top: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.accent,
    backgroundColor: `${palette.accent}33`,
  },
  rangeChipText: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  markerNoteDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: palette.accent2,
  },
  insightTab: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  insightTabActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  insightTabText: {
    color: palette.textDim,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  insightTabTextActive: {
    color: palette.accent,
  },
  markerFlag: {
    position: 'absolute',
    top: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: 110,
  },
  markerStem: {
    width: 2,
    height: 10,
    borderRadius: 1,
    backgroundColor: palette.accent2,
  },
  markerText: {
    color: palette.accent2,
    fontSize: 9,
    fontWeight: '700',
    flexShrink: 1,
  },
  beatDot: {
    position: 'absolute',
    bottom: 1,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: `${palette.accent2}aa`,
  },
  downbeatDot: {
    position: 'absolute',
    bottom: 0,
    width: 4,
    height: 6,
    borderRadius: 2,
    backgroundColor: palette.accent2,
  },
  trackLabels: {
    position: 'absolute',
    left: 6,
    top: 0,
  },
  trackLabelRow: {
    justifyContent: 'center',
  },
  headerBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  headerBtn: {
    padding: 2,
  },
  trackLabelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
    backgroundColor: `${palette.bg}cc`,
  },
  trackLabelText: {
    fontWeight: '700',
  },
  playhead: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: palette.text,
    borderRadius: 1,
  },
});

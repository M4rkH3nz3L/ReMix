import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, ScrollView } from 'react-native-gesture-handler';

import { PacingLane } from '@/components/editor/PacingLane';
import { StoryLane } from '@/components/editor/StoryLane';
import { TimelineMinimap } from '@/components/editor/TimelineMinimap';
import { FloatingTrackLabels } from '@/components/editor/timeline/FloatingTrackLabels';
import {
  TimelineControlsBar,
  type ControlsScrollState,
} from '@/components/editor/timeline/TimelineControlsBar';
import { TimelineGuideLines } from '@/components/editor/timeline/TimelineGuideLines';
import { TimelineRuler } from '@/components/editor/timeline/TimelineRuler';
import { TimelineTrackRow } from '@/components/editor/timeline/TimelineTrackRow';
import { TrackHeaderColumn } from '@/components/editor/timeline/TrackHeaderColumn';
import { useTimelineBeatGrid } from '@/components/editor/timeline/useTimelineBeatGrid';
import { useTimelinePinch } from '@/components/editor/timeline/useTimelinePinch';
import { useTimelineScroll } from '@/components/editor/timeline/useTimelineScroll';
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { BASE_PX_PER_SEC, palette } from '@/constants/editor';
import { useLayout } from '@/hooks/useLayout';
import { projectDuration } from '@/lib/projectUtils';
import {
  contentWidthFor,
  countClips,
  OVERSCAN_FACTOR,
  razorCutTarget,
  RULER_HEIGHT,
  trackHeightFor,
  VIRTUALIZE_MIN_CLIPS,
  visibleTrackTypes,
} from '@/lib/timelineLayout';
import { clipInWindow, windowFor } from '@/lib/virtualize';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { useEditorStore } from '@/store/editorStore';
import type { TrackType } from '@/types/project';

/**
 * CapCut-mintájú idővonal: a lejátszófej középen áll, a tartalom görgetésével
 * léptetünk (scroll offset ↔ playhead). Kétujjas csippentés = zoom.
 *
 * Kompozíciós gyökér: a részek a `timeline/` mappában (tiszta geometria, menük,
 * scroll/pinch/beat hookok, vezérlősor, vonalzó, sávsorok, fejlécek).
 */
export function Timeline({ compact = false }: { compact?: boolean } = {}) {
  const L = useLayout();
  const project = useEditorStore((s) => s.project);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  // 🔒 zárolás + 🔽 összecsukás + 📏 sáv-magasság
  const lockedTracks = useEditorStore((s) => s.lockedTracks);
  const collapsedTracks = useEditorStore((s) => s.collapsedTracks);
  const trackHeightScale = useEditorStore((s) => s.trackHeightScale);
  const insightLane = useEditorStore((s) => s.insightLane);
  // 🎚️ kezelési beállítások (eszköz-szintű): szerkesztési mód + kiegészítő sorok
  const editMode = useEditorPrefs((st) => st.editMode);
  const timelineExtras = useEditorPrefs((st) => st.timelineExtras);
  // a vezérlősor görgetés-állapota (a jobb oldali „van még” jelzéshez) — itt él, nem a
  // vezérlősorban, hogy a compact ki-be kapcsolása ne nullázza
  const [controls, setControls] = useState<ControlsScrollState>({ w: 0, content: 0, x: 0 });
  // ✂️ borotva-mód (koppintásra vág) + képkocka-pontos split
  const razorMode = useEditorStore((s) => s.razorMode);
  const splitClipAt = useEditorStore((s) => s.splitClipAt);
  // 📏 automatikus magasság
  const autoTrackHeight = useEditorStore((s) => s.autoTrackHeight);

  /** ✂️ borotva-vágás: az adott sávon a `time`-nál elvágja a lefedő klipet */
  const razorCutAt = (type: TrackType, time: number) => {
    const target = razorCutTarget(project, lockedTracks, type, time);
    if (target) {
      splitClipAt(target.clipId, target.time);
    }
  };

  const pps = BASE_PX_PER_SEC * zoom;
  const duration = project ? projectDuration(project) : 0;
  const contentW = contentWidthFor(duration, pps);

  useTimelineBeatGrid(project);

  // a virtualizációs ablak a renderben is olvassa (lásd lent) — ezért él itt, nem a hookban
  const lastScrollX = useRef(0);
  const {
    scrollRef,
    viewportW,
    setViewportW,
    clipWindow,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
  } = useTimelineScroll({ lastScrollX, pps, isPlaying, setPlayhead, setPlaying });

  const pinch = useTimelinePinch(zoom, setZoom);

  if (!project) {
    return null;
  }

  // csak a videó sáv + a tartalommal bíró sávok látszanak
  const visibleTracks = visibleTrackTypes(project);

  // nagyobb kijelzőn vastagabb sávok — könnyebb célozni és olvasni
  const th = (t: TrackType) =>
    trackHeightFor(t, { collapsedTracks, trackScale: L.editor.trackScale, autoTrackHeight, trackHeightScale });

  const totalTracksHeight = visibleTracks.reduce((sum, t) => sum + th(t), 0);

  // 🪟 klip-virtualizáció: hosszú projekten (sok klip) csak a látható ABLAK +
  // overscan klipjeit rendereljük — a mountolt klip-komponensek száma korlátos
  // marad, akárhány klip is van. Rövid projekten `virtualize=false` → mindent
  // renderel (0 regresszió). Az ablak a lejátszófej-középhez képest centrált
  // (a paddingHorizontal=viewportW/2 miatt a lokális ablak scrollX körül szimmetrikus).
  const totalClipCount = countClips(project);
  const virtualize = viewportW > 0 && totalClipCount > VIRTUALIZE_MIN_CLIPS;
  const clipWin = virtualize
    ? (clipWindow ?? windowFor(lastScrollX.current, viewportW, OVERSCAN_FACTOR))
    : null;
  // a kijelölt (és így a húzott) klipeket MINDIG rendereljük, akkor is, ha kigörögtek
  // a virtualizációs ablakból — különben eltűnnének a trim-fogantyúk / megszakadna a
  // folyó gesztus. (Kevés kijelölt klip van, a windowing haszna megmarad.)
  const clipVisible = (c: { id: string; start: number; duration: number }) =>
    clipInWindow(c, clipWin, pps) || c.id === selectedClipId || multiSelectIds.includes(c.id);

  // 🖥️ tablet/széles kijelző: fix fejléc-oszlop ikon+címkével a sávok elején;
  // a görgethető terület a saját szélességét méri, a scroll-matek változatlan.
  // A küszöb a közös méret-osztályból jön (nem külön 700px-es szabály).
  const showHeaders = L.editor.trackHeaderWidth > 0;

  return (
    <TutorialTarget id="timeline">
      {/* 🔎 insight-sáv: egyszerre EGY nézet (story / pacing) — kevés chrome. A
          térkép (minimap) NEM fül többé: állandó scrubber-csík közvetlenül az
          idővonal fölött (lásd lentebb). */}
      {/* ↔️ a vezérlők EGY sorban: ha nem fér ki (keskeny kijelző), VÍZSZINTESEN
          GÖRGETHETŐ — a Snap/Region SOHA nem törik külön új sorba. Normál kijelzőn
          a `minWidth:100%` + a trim `marginLeft:auto` ugyanúgy jobbra igazít. */}
      {/* 📐 nyitott panel mellett (compact) a kiegészítő sorok — insight-sáv, sztori/tempó-sáv,
          térkép — rejtve: a hely a preview-é, a sávok és a lejátszófej maradnak (MOBILE-UI T1/1) */}
      {compact ? null : <TimelineControlsBar controls={controls} setControls={setControls} />}
      {compact || editMode === 'quick' || !timelineExtras ? null : insightLane === 'pacing' ? <PacingLane /> : <StoryLane />}
      {/* 🗺️ állandó scrubber KÖZVETLENÜL az idővonal fölött: az egész projekt
          kicsinyített térképe — koppintás/húzás a lejátszófejet mozgatja végig,
          így az idővonal „végignézhető" (a középre rögzített fej auto-scrollja
          igazítja a nagy idővonalat). Gyors módban / összecsukva rejtve (D6). */}
      {compact || editMode === 'quick' || !timelineExtras ? null : <TimelineMinimap viewportW={viewportW} pps={pps} />}
      <GestureDetector gesture={pinch}>
        <View style={styles.outerRow}>
        {showHeaders ? <TrackHeaderColumn visibleTracks={visibleTracks} th={th} /> : null}
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
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onMomentumScrollEnd={onMomentumScrollEnd}
          contentContainerStyle={{ paddingHorizontal: viewportW / 2 }}
        >
          <View style={{ width: contentW }}>
            <TimelineRuler project={project} pps={pps} duration={duration} totalTracksHeight={totalTracksHeight} />
            {visibleTracks.map((type) => (
              <TimelineTrackRow
                key={type}
                type={type}
                track={project.tracks.find((t) => t.type === type)}
                height={th(type)}
                pps={pps}
                clipVisible={clipVisible}
                selectedClipId={selectedClipId}
                multiSelectIds={multiSelectIds}
                collapsed={collapsedTracks.includes(type)}
                locked={lockedTracks.includes(type)}
                razorMode={razorMode}
                onRazorCut={razorCutAt}
              />
            ))}
            <TimelineGuideLines pps={pps} totalTracksHeight={totalTracksHeight} />
          </View>
        </ScrollView>

        {/* sáv-címkék (nem görgetődnek) — fejléc-oszlopos módban rejtve */}
        {showHeaders ? null : <FloatingTrackLabels visibleTracks={visibleTracks} th={th} />}

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
    </TutorialTarget>
  );
}

const styles = StyleSheet.create({
  outerRow: {
    flexDirection: 'row',
  },
  container: {
    flex: 1,
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingBottom: 8,
  },
  playhead: {
    position: 'absolute',
    top: 0,
    width: 2,
    backgroundColor: palette.text,
    borderRadius: 1,
  },
});

import { StyleSheet, View } from 'react-native';

import { palette } from '@/constants/editor';
import { RULER_HEIGHT } from '@/lib/timelineLayout';
import { useCollabLive } from '@/store/collabLiveStore';
import { useEditorStore } from '@/store/editorStore';

/**
 * 📍 Teljes-magas, gesztust nem fogó segédvonalak a görgethető tartalomban:
 * javasolt vágások, keresési találatok, kollaborátor-kurzorok.
 */
export function TimelineGuideLines({ pps, totalTracksHeight }: { pps: number; totalTracksHeight: number }) {
  // 👥 kollaborátor-kurzorok (a többi szerkesztő lejátszófeje) — a tartalomba
  // rajzoljuk, így a lokális playhead-görgetéssel EGYÜTT mozog, re-render nélkül;
  // csak a résztvevők (throttle-olt) frissülésekor renderel újra
  const collabCursors = useCollabLive((s) => s.participants);
  const suggestedCuts = useEditorStore((s) => s.suggestedCuts);
  const searchMatchTimes = useEditorStore((s) => s.searchMatchTimes);

  return (
    <>
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
      {/* 👥 kollaborátor-kurzorok: a többi szerkesztő lejátszófeje, saját színnel */}
      {collabCursors.map((p) => (
        <View
          key={`cursor-${p.id}`}
          pointerEvents="none"
          style={[
            styles.remoteCursor,
            { left: p.playhead * pps, height: RULER_HEIGHT + totalTracksHeight, backgroundColor: p.color },
          ]}
        >
          <View style={[styles.remoteCursorDot, { backgroundColor: p.color }]} />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
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
  remoteCursor: {
    position: 'absolute',
    top: 0,
    width: 2,
    borderRadius: 1,
    opacity: 0.9,
  },
  remoteCursorDot: {
    position: 'absolute',
    top: -2,
    left: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});

import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette, trackColors } from '@/constants/editor';
import { projectDuration } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🗺️ Idővonal-minimap (#42/43): a TELJES projekt kicsinyített térképe + a
 * jelenlegi nézet (viewport) kiemelése — „hol vagyok a projektben?".
 *
 * Mindig látszik (kiválasztott fül soha ne legyen üres → nem tűnik hibának):
 * tartalom hiányában halvány súgó, egyébként a kicsinyített térkép. A viewport-
 * téglalap csak akkor jelenik meg, ha a tartalom túllóg a látható idővonalon
 * (van mit navigálni). Koppintásra a lejátszófej odaugrik; a középre rögzített
 * playhead miatt a meglévő auto-scroll effekt igazítja a nagy idővonalat.
 */
export function TimelineMinimap({ viewportW, pps }: { viewportW: number; pps: number }) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const playhead = useEditorStore((s) => s.playhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const [mapW, setMapW] = useState(0);

  if (!project) {
    return null;
  }
  const totalDur = Math.max(projectDuration(project), 0.001);
  // a viewport-téglalapnak csak akkor van értelme, ha a tartalom túllóg
  const overflows = viewportW > 0 && totalDur * pps > viewportW + 4;

  const secToX = mapW > 0 ? mapW / totalDur : 0;
  const videoClips = project.tracks.find((tk) => tk.type === 'video')?.clips ?? [];
  const markers = project.markers ?? [];
  const hasContent = videoClips.length > 0 || markers.length > 0;

  // viewport (a látható ablak) — a playheadre centrálva (középre rögzített fej)
  const windowSec = viewportW / pps;
  const vpLeft = clamp((playhead - windowSec / 2) * secToX, 0, Math.max(0, mapW - 4));
  const vpW = clamp(windowSec * secToX, 8, mapW);

  const seek = (e: GestureResponderEvent) => {
    if (secToX <= 0) {
      return;
    }
    setPlayhead(clamp(e.nativeEvent.locationX / secToX, 0, totalDur));
  };

  return (
    <Pressable
      style={styles.strip}
      onPress={seek}
      onLayout={(e) => setMapW(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={t('editor.timeline.minimap')}
    >
      {!hasContent ? (
        <Text style={styles.hint} pointerEvents="none">
          {t('editor.insight.mapEmpty')}
        </Text>
      ) : mapW > 0 ? (
        <>
          {/* videó-klipek mint tartalom-sűrűség */}
          {videoClips.map((c) => (
            <View
              key={c.id}
              style={{
                position: 'absolute',
                left: c.start * secToX,
                width: Math.max(1, c.duration * secToX),
                top: 5,
                bottom: 5,
                backgroundColor: trackColors.video,
                borderRadius: 2,
              }}
            />
          ))}
          {/* markerek */}
          {markers.map((m) => (
            <View
              key={m.id}
              style={{ position: 'absolute', left: m.time * secToX - 0.5, top: 0, bottom: 0, width: 1, backgroundColor: m.color ?? palette.accent2 }}
            />
          ))}
          {/* viewport-téglalap — csak túllógásnál (különben a teljes sáv, felesleges) */}
          {overflows ? (
            <View style={[styles.viewport, { left: vpLeft, width: vpW }]} pointerEvents="none" />
          ) : null}
          {/* playhead */}
          <View style={[styles.playhead, { left: playhead * secToX - 0.5 }]} pointerEvents="none" />
        </>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    height: 26,
    marginHorizontal: 8,
    marginBottom: 4,
    borderRadius: 6,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  viewport: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderWidth: 1.5,
    borderColor: palette.accent,
    borderRadius: 4,
    backgroundColor: '#7c5cff22',
  },
  playhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: palette.text,
  },
  hint: {
    color: palette.textDim,
    fontSize: 10,
    paddingHorizontal: 8,
    lineHeight: 24,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { projectDuration } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

/** ennél hosszabb, vágatlan videóklip „lassú" szakasznak számít (short-form). */
const SLOW_SEC = 6;

/**
 * 📈 Pacing / energia-sáv (#68/69): a videó vágás-ritmusának heurisztikus képe
 * — rövid klipek = pörgős, magas energia; hosszú, vágatlan klipek = lassú
 * („boring") szakasz, pirosan jelölve. Kliens-oldali (klip-hosszokból), worker
 * nélkül; tap = ugrás a szakasz elejére.
 */
export function PacingLane() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const suggestedCuts = useEditorStore((s) => s.suggestedCuts);
  const setSuggestedCuts = useEditorStore((s) => s.setSuggestedCuts);
  const applySuggestedCuts = useEditorStore((s) => s.applySuggestedCuts);
  const clearSuggestedCuts = useEditorStore((s) => s.clearSuggestedCuts);
  const [laneW, setLaneW] = useState(0);

  if (!project) {
    return null;
  }
  const videoClips = (project.tracks.find((tk) => tk.type === 'video')?.clips ?? []).filter(
    (c): c is VideoClip => c.kind === 'video'
  );
  if (videoClips.length < 2) {
    return null; // egyetlen klipnél nincs érdemi ritmus-információ
  }
  const totalDur = Math.max(projectDuration(project), 0.001);
  const secToX = laneW > 0 ? laneW / totalDur : 0;

  // energia: rövid klip → magas (1), hosszú → alacsony (0.15) — a vágás-tempó proxyja
  const energyOf = (durSec: number) => clamp(1 - (durSec - 1.5) / (8 - 1.5), 0.15, 1);

  // ✂️ javasolt vágások (#36): a lassú, hosszú klipek felezőpontja — pörgősebb tempó
  const slowCutTimes = videoClips
    .filter((c) => c.duration > SLOW_SEC)
    .map((c) => Math.round((c.start + c.duration / 2) * 100) / 100);
  const hasSuggestions = suggestedCuts.length > 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.lane} onLayout={(e) => setLaneW(e.nativeEvent.layout.width)}>
        {laneW > 0
          ? videoClips.map((c) => {
              const e = energyOf(c.duration);
              const slow = c.duration > SLOW_SEC;
              const w = Math.max(2, c.duration * secToX);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setPlayhead(c.start)}
                  style={[styles.slot, { left: c.start * secToX, width: w }]}
                >
                  <View
                    style={[
                      styles.fill,
                      {
                        height: `${Math.round(e * 100)}%`,
                        backgroundColor: slow ? palette.danger : palette.accent,
                        opacity: slow ? 0.7 : 0.55,
                      },
                    ]}
                  />
                  {slow && w > 42 ? (
                    <Text style={styles.slowLabel} numberOfLines={1}>
                      {t('editor.pacing.slow')}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          : null}
      </View>

      {hasSuggestions ? (
        <>
          <Pressable
            onPress={applySuggestedCuts}
            hitSlop={6}
            style={[styles.actionBtn, styles.applyBtn]}
            accessibilityLabel={t('editor.pacing.applyCuts', { count: suggestedCuts.length })}
          >
            <Ionicons name="checkmark" size={15} color={palette.ok} />
          </Pressable>
          <Pressable
            onPress={clearSuggestedCuts}
            hitSlop={6}
            style={styles.actionBtn}
            accessibilityLabel={t('editor.pacing.clearCuts')}
          >
            <Ionicons name="close" size={15} color={palette.textDim} />
          </Pressable>
        </>
      ) : slowCutTimes.length > 0 ? (
        <Pressable
          onPress={() => setSuggestedCuts(slowCutTimes)}
          hitSlop={6}
          style={styles.actionBtn}
          accessibilityLabel={t('editor.pacing.suggestCuts', { count: slowCutTimes.length })}
        >
          <Ionicons name="cut-outline" size={14} color={palette.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 8,
    marginBottom: 4,
  },
  lane: {
    flex: 1,
    height: 22,
    borderRadius: 6,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  actionBtn: {
    width: 26,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  applyBtn: {
    borderColor: palette.ok,
    backgroundColor: '#2ecc8f22',
  },
  slot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#0b0f1a',
  },
  fill: {
    alignSelf: 'stretch',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  slowLabel: {
    position: 'absolute',
    top: 2,
    color: palette.danger,
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});

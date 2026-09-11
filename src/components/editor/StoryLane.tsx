import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { projectDuration } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { ChapterKind } from '@/types/project';

/** fejezet-fajta → szín (short-form dramaturgia színkódja) */
const KIND_COLOR: Record<ChapterKind, string> = {
  hook: '#ff5ca8',
  context: '#4a9eff',
  value: palette.accent,
  cta: palette.ok,
  other: '#6b7280',
};

/**
 * 🎬 Story-struktúra sáv (#66/67): a videó „térképe" az idővonal fölött —
 * Hook → Context → Value → CTA. A user nem csak klipeket lát, hanem a
 * videója TÖRTÉNETÉT szerkeszti. Tap = ugrás a fejezethez, hosszú-nyomás =
 * fajta-váltás / törlés, „+" = fejezet a lejátszófejnél.
 *
 * Perzisztált + undo-zható (SET_CHAPTERS command); csak akkor foglal helyet,
 * ha van fejezet (különben csak a „+" gomb egy vékony sávban).
 */
export function StoryLane() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const addChapterAt = useEditorStore((s) => s.addChapterAt);
  const cycleChapterKind = useEditorStore((s) => s.cycleChapterKind);
  const removeChapter = useEditorStore((s) => s.removeChapter);
  const [laneW, setLaneW] = useState(0);

  if (!project) {
    return null;
  }
  const totalDur = Math.max(projectDuration(project), 0.001);
  const chapters = [...(project.chapters ?? [])].sort((a, b) => a.start - b.start);
  const secToX = laneW > 0 ? laneW / totalDur : 0;

  const kindLabel = (k: ChapterKind) => t('editor.story.kind_' + k);

  const onChapterLongPress = (id: string, kind: ChapterKind) => {
    Alert.alert(kindLabel(kind), t('editor.story.menuMessage'), [
      { text: t('editor.story.changeType'), onPress: () => cycleChapterKind(id) },
      { text: t('common.delete'), style: 'destructive', onPress: () => removeChapter(id) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.lane} onLayout={(e) => setLaneW(e.nativeEvent.layout.width)}>
        {laneW > 0 && chapters.length > 0
          ? chapters.map((c, i) => {
              const end = i + 1 < chapters.length ? chapters[i + 1].start : totalDur;
              const w = Math.max(3, (end - c.start) * secToX);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => setPlayhead(c.start)}
                  onLongPress={() => onChapterLongPress(c.id, c.kind)}
                  style={[
                    styles.segment,
                    { left: c.start * secToX, width: w, backgroundColor: KIND_COLOR[c.kind] },
                  ]}
                >
                  {w > 34 ? (
                    <Text style={styles.segLabel} numberOfLines={1}>
                      {kindLabel(c.kind)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          : null}
        {chapters.length === 0 ? (
          <Text style={styles.hint}>{t('editor.story.empty')}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => addChapterAt(chapters.length === 0 ? 'hook' : 'other')}
        hitSlop={6}
        style={styles.addBtn}
        accessibilityRole="button"
        accessibilityLabel={t('editor.story.addChapter')}
      >
        <Ionicons name="add" size={16} color={palette.accent} />
      </Pressable>
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
    height: 20,
    borderRadius: 6,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  segment: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: '#0b0f1a',
  },
  segLabel: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 3,
  },
  hint: {
    color: palette.textDim,
    fontSize: 10,
    paddingHorizontal: 8,
    lineHeight: 20,
  },
  addBtn: {
    width: 26,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
});

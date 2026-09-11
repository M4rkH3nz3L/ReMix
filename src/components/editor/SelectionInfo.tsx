import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { findClip } from '@/lib/projectUtils';
import { formatTime } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, TrackType } from '@/types/project';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/** Hang-sávok — ezekre a „nem látható a képkockán" figyelmeztetés nem vonatkozik. */
const AUDIO_TRACKS: TrackType[] = ['music', 'voiceover', 'sfx'];

/** Sáv-típus → ikon (a kijelölt elem fajtájának azonnali felismeréséhez). */
const TRACK_ICON: Record<TrackType, IoniconName> = {
  video: 'videocam',
  pip: 'albums',
  adjust: 'color-palette',
  text: 'text',
  captions: 'chatbox-ellipses',
  overlay: 'happy',
  interactive: 'radio-button-on',
  music: 'musical-notes',
  voiceover: 'mic',
  sfx: 'pulse',
};

/** A kijelölt klip rövid, emberi neve (szöveg / címke / fájlnév). */
function clipName(clip: Clip): string {
  if ('text' in clip && typeof clip.text === 'string') {
    return clip.text.trim();
  }
  if ('label' in clip && typeof clip.label === 'string') {
    return clip.label;
  }
  if ('uri' in clip && typeof clip.uri === 'string') {
    return decodeURIComponent(clip.uri.split('/').pop() ?? '');
  }
  return '';
}

/**
 * 🧭 „What am I editing?" — a kijelölt elem fajtája, neve és idő-tartománya.
 *
 * A kontextusfüggő eszköztár tetején jelenik meg (minden elrendezésben), hogy a
 * felhasználó MINDIG lássa, PONTOSAN mit szerkeszt, és az az idővonalon hol van.
 */
export function SelectionInfo() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const multiCount = useEditorStore((s) => s.multiSelectIds.length);
  const playhead = useEditorStore((s) => s.playhead);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const focusMode = useEditorStore((s) => s.focusMode);
  const toggleFocusMode = useEditorStore((s) => s.toggleFocusMode);

  if (!project || !selectedClipId) {
    return null;
  }
  const found = findClip(project, selectedClipId);
  if (!found) {
    return null;
  }
  const { track, clip } = found;
  const name = clipName(clip);
  const start = clip.start;
  const end = clip.start + clip.duration;

  // 👁 vizuális elem, ami a jelenlegi képkockán nincs képen (a playhead a
  // tartományán kívül) — a felhasználó azt hiheti, „nem működik", pedig csak
  // máshol van az idővonalon. Egy koppintással odaugrik.
  const visual = !AUDIO_TRACKS.includes(track.type);
  const notVisible = visual && (playhead + 0.05 < start || playhead - 0.05 > end);

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Ionicons name={TRACK_ICON[track.type]} size={14} color={palette.accent} />
        <Text style={styles.type}>{t('editor.track.' + track.type)}</Text>
        {name ? (
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        ) : null}
        <View style={{ flex: 1 }} />
        {multiCount > 0 ? (
          <Text style={styles.badge}>+{multiCount}</Text>
        ) : (
          <Text style={styles.time}>
            {formatTime(start)}–{formatTime(end)} · {clip.duration.toFixed(1)}s
          </Text>
        )}
        {/* 🎯 fókusz mód: a többi idővonal-klip elhalványul, kiemelve az aktívat */}
        <Pressable
          onPress={toggleFocusMode}
          hitSlop={6}
          style={[styles.focusBtn, focusMode ? styles.focusBtnOn : null]}
          accessibilityRole="button"
          accessibilityState={{ selected: focusMode }}
          accessibilityLabel={t('editor.selection.focusMode')}
        >
          <Ionicons
            name="contract-outline"
            size={14}
            color={focusMode ? palette.accent : palette.textDim}
          />
        </Pressable>
      </View>

      {notVisible ? (
        <Pressable
          style={styles.warn}
          onPress={() => setPlayhead(start)}
          accessibilityRole="button"
        >
          <Ionicons name="eye-off-outline" size={13} color={palette.danger} />
          <Text style={styles.warnText}>{t('editor.selection.notVisible')}</Text>
          <Ionicons name="play-skip-forward-outline" size={13} color={palette.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 8,
    marginBottom: 6,
    gap: 4,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
  },
  warn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#ff5c7218',
    borderWidth: 1,
    borderColor: '#ff5c7255',
  },
  warnText: {
    flex: 1,
    color: palette.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  type: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  name: {
    color: palette.textDim,
    fontSize: 12,
    flexShrink: 1,
  },
  time: {
    color: palette.textDim,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '800',
  },
  focusBtn: {
    width: 26,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  focusBtnOn: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
});

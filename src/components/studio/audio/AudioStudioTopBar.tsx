import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';

import { CollabPresence } from '@/components/editor/CollabPresence';
import { palette } from '@/constants/editor';
import { songCount } from '@/lib/albumDoc';
import { AUDIO_STUDIO_MODES, type AudioStudioMode } from '@/lib/audioStudioModes';
import type { Project } from '@/types/project';

/** 🎛️ V10: a stúdió-módok ikonjai */
const MODE_ICON: Record<AudioStudioMode, keyof typeof Ionicons.glyphMap> = {
  quick: 'flash-outline',
  mix: 'options-outline',
  music: 'musical-notes-outline',
  ai: 'sparkles-outline',
};

/**
 * 🎧 A hang-stúdió fejléce: kilépés, a stúdió-mód választója (V10) + a cím, forrás-mappa, album (projekt-módban),
 * a közös szerkesztés résztvevői és az Export / Kész gomb; alatta — nyitva — a négy mód sora.
 */
export function AudioStudioTopBar({
  mode,
  title,
  studioMode,
  modePicker,
  album,
  albumSharing,
  onExit,
  onToggleModePicker,
  onChooseMode,
  onSource,
  onAlbum,
  onExport,
  onLayout,
}: {
  mode: 'project' | 'scoped';
  title: string;
  studioMode: AudioStudioMode;
  modePicker: boolean;
  album: Project['album'];
  albumSharing: boolean;
  onExit: () => void;
  onToggleModePicker: () => void;
  onChooseMode: (m: AudioStudioMode) => void;
  onSource: () => void;
  onAlbum: () => void;
  onExport?: () => void;
  /** a fejléc mért magassága (a lapok detentjeihez) */
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <View style={styles.topBar} onLayout={onLayout}>
        <Pressable onPress={onExit} hitSlop={10} style={styles.topBtn} accessibilityRole="button" accessibilityLabel={mode === 'scoped' ? t('common.close') : t('studio.audio.a11y.exitStudio')}>
          <Ionicons name={mode === 'scoped' ? 'close' : 'chevron-back'} size={26} color={palette.text} />
        </Pressable>
        <View style={styles.titleWrap}>
          {/* 🎛️ V10: a stúdió-mód választója (koppintásra a négy mód) */}
          <Pressable
            testID="audio-mode-picker"
            style={styles.kindTag}
            onPress={onToggleModePicker}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`${t('studio.audio.studioMode.choose')}: ${t(`studio.audio.studioMode.${studioMode}`)}`}
          >
            <Ionicons name={MODE_ICON[studioMode]} size={12} color={palette.accent} />
            <Text style={styles.kindTagText}>{t(`studio.audio.studioMode.${studioMode}`)}</Text>
            <Ionicons name={modePicker ? 'chevron-up' : 'chevron-down'} size={11} color={palette.accent} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Pressable
          onPress={onSource}
          hitSlop={10}
          style={styles.srcBtn}
          accessibilityRole="button"
          accessibilityLabel={t('source.title')}
        >
          <Ionicons name="folder-open-outline" size={15} color={palette.textDim} />
        </Pressable>
        {mode === 'project' ? (
          <Pressable
            onPress={onAlbum}
            hitSlop={8}
            style={styles.srcBtn}
            accessibilityRole="button"
            accessibilityLabel={t('studio.audio.album.title', { defaultValue: 'Album' })}
          >
            {albumSharing ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <>
                <Ionicons name="albums-outline" size={15} color={album ? palette.accent : palette.textDim} />
                {album ? <Text style={styles.albumCount}>{songCount(album)}</Text> : null}
              </>
            )}
          </Pressable>
        ) : null}
        {/* 👥 a közös szerkesztés résztvevői (megosztott projektnél) */}
        <CollabPresence />
        {mode === 'scoped' ? (
          <Pressable onPress={onExit} hitSlop={10} style={styles.exportBtn}>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.exportText}>{t('common.done')}</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onExport} hitSlop={10} style={styles.exportBtn}>
            <Ionicons name="share-outline" size={16} color="#fff" />
            <Text style={styles.exportText}>{t('studio.export')}</Text>
          </Pressable>
        )}
      </View>

      {modePicker ? (
        <View style={styles.modeRow} accessibilityRole="radiogroup">
          {AUDIO_STUDIO_MODES.map((m) => (
            <Pressable
              key={m}
              testID={`audio-mode-${m}`}
              onPress={() => onChooseMode(m)}
              style={[styles.modeChip, m === studioMode && styles.modeChipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: m === studioMode }}
            >
              <Ionicons name={MODE_ICON[m]} size={15} color={m === studioMode ? '#fff' : palette.textDim} />
              <Text style={[styles.modeChipText, m === studioMode && styles.modeChipTextOn]}>{t(`studio.audio.studioMode.${m}`)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  topBtn: { padding: 2 },
  srcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    backgroundColor: palette.surface,
  },
  albumCount: { color: palette.accent, fontSize: 11, fontWeight: '800' },
  titleWrap: { flex: 1, gap: 2 },
  kindTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  modeRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: palette.border, backgroundColor: palette.surface },
  modeChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  modeChipOn: { backgroundColor: palette.accent, borderColor: palette.accent },
  modeChipText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  modeChipTextOn: { color: '#fff' },
  kindTagText: { color: palette.accent, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700' },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.accent, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  exportText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});

import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/audio/audioStyles';
import { PanelSection } from '@/components/ui/controls';
import type { LibraryTrack } from '@/lib/render';
import { projectMusicTarget, rankLibrary, trackMatchScore } from '@/lib/musicMatch';
import type { Project } from '@/types/project';

export interface LibrarySectionProps {
  library: LibraryTrack[] | null;
  libraryError: boolean;
  /** a renderkori projekt (a gyökér olvassa a store-ból, mint eddig) */
  project: Project | null;
  matchMode: boolean;
  setMatchMode: (fn: (v: boolean) => boolean) => void;
  busyTrack: string | null;
  addFromLibrary: (track: LibraryTrack) => void;
}

/** 🎵 Zene- és SFX-könyvtár, a videóhoz-illesztés rangsorával */
export function LibrarySection({ library, libraryError, project, matchMode, setMatchMode, busyTrack, addFromLibrary }: LibrarySectionProps) {
  const { t } = useTranslation();
  return (
    <PanelSection title={t('panels.audio.libraryTitle')}>
      {library === null && !libraryError ? (
        <Text style={styles.note}>{t('panels.audio.libraryLoading')}</Text>
      ) : libraryError ? (
        <Text style={styles.note}>
          {t('panels.audio.libraryError')}
        </Text>
      ) : (
        <View style={styles.trackList}>
          {(() => {
            const on = matchMode && !!project;
            const target = on ? projectMusicTarget(project!) : 0;
            const shown = on ? rankLibrary(library!, project!) : library!;
            return (
              <>
                <Pressable
                  onPress={() => setMatchMode((v) => !v)}
                  hitSlop={6}
                  style={[styles.matchToggle, on ? styles.matchToggleOn : null]}
                >
                  <Text style={[styles.matchToggleText, on ? styles.matchToggleTextOn : null]}>
                    {t('panels.audio.matchToVideo')}
                  </Text>
                </Pressable>
                {shown.map((track) => (
                  <Pressable
                    key={track.id}
                    style={styles.trackRow}
                    onPress={() => addFromLibrary(track)}
                  >
                    <Text style={styles.trackIcon}>{track.kind === 'music' ? '🎵' : '💥'}</Text>
                    <Text style={styles.trackName} numberOfLines={1}>
                      {busyTrack === track.id ? t('panels.audio.downloading') : track.name}
                    </Text>
                    {on ? (
                      <Text style={styles.matchBadge}>
                        {Math.round(trackMatchScore(track, target) * 100)}%
                      </Text>
                    ) : null}
                    <Text style={styles.trackDuration}>{t('panels.audio.seconds', { value: track.duration.toFixed(1) })}</Text>
                  </Pressable>
                ))}
              </>
            );
          })()}
          <Text style={styles.note}>
            {t('panels.audio.libraryHint')}
          </Text>
        </View>
      )}
    </PanelSection>
  );
}

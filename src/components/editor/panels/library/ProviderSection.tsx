import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/library/libraryStyles';
import { PanelSection } from '@/components/ui/controls';
import { palette, trackColors } from '@/constants/editor';
import { formatSize, visibleEntries, type ProviderState } from '@/lib/libraryPanelOps';
import type { StorageEntry, StorageProvider } from '@/lib/storageProviders';
import { formatTime } from '@/lib/time';

const kindIcons = {
  video: 'videocam-outline',
  image: 'image-outline',
  audio: 'musical-notes-outline',
  model: 'cube-outline',
} as const;

const kindColors = {
  video: trackColors.video,
  image: trackColors.video,
  audio: trackColors.music,
  model: trackColors.video,
} as const;

export interface ProviderSectionProps {
  provider: StorageProvider;
  st: ProviderState;
  query: string;
  busyId: string | null;
  addEntry: (provider: StorageProvider, entry: StorageEntry) => void;
}

/** egy tár-forrás: állapot (töltés / offline / hiba / üres) vagy a szűrt tétel-lista */
export function ProviderSection({ provider, st, query, busyId, addEntry }: ProviderSectionProps) {
  const { t } = useTranslation();
  // 🧊 a 3D-fájl nem idővonal-média (a 3D Stúdióban használható) → itt nem kínáljuk
  const visible = visibleEntries(st, query);
  if (st.state === 'ready' && query && visible.length === 0) {
    return null; // szűrésnél az üres források nem foglalnak helyet
  }
  return (
    <PanelSection title={t(provider.label)}>
      {st.state === 'loading' ? (
        <ActivityIndicator color={palette.accent} />
      ) : st.state === 'offline' ? (
        <Text style={styles.note}>{t('panels.library.workerOffline')}</Text>
      ) : st.state === 'error' ? (
        <Text style={styles.note}>{st.message}</Text>
      ) : visible.length === 0 ? (
        <Text style={styles.note}>{t(provider.description)}</Text>
      ) : (
        visible.map((entry) => (
          <Pressable
            key={entry.id}
            style={styles.row}
            disabled={busyId !== null}
            onPress={() => addEntry(provider, entry)}
          >
            <View style={[styles.rowIcon, { backgroundColor: `${kindColors[entry.kind]}22` }]}>
              <Ionicons
                name={kindIcons[entry.kind]}
                size={16}
                color={kindColors[entry.kind]}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName} numberOfLines={1}>
                {entry.name}
              </Text>
              <Text style={styles.rowMeta}>
                {entry.duration ? `${formatTime(entry.duration)} · ` : ''}
                {formatSize(entry.size)}
              </Text>
            </View>
            {busyId === entry.id ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <Ionicons name="add-circle-outline" size={20} color={palette.textDim} />
            )}
          </Pressable>
        ))
      )}
    </PanelSection>
  );
}

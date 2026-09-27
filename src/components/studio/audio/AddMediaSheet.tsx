import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import { renderServerUrl } from '@/lib/backend';
import { snapToFrame } from '@/lib/frames';
import { makeId } from '@/lib/id';
import { pickAudio } from '@/lib/media';
import { formatTime } from '@/lib/time';
import { loadStorageProviders, type StorageEntry, type StorageProvider } from '@/lib/storageProviders';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, TrackType } from '@/types/project';

/**
 * ➕ Hang hozzáadása a stúdióhoz — ESZKÖZRŐL importálva VAGY a szerver-könyvtárból
 * (Tár-providerek). A könyvtár-tételt a provider-réteg oldja fel helyi/stream uri-ra
 * (a `LibraryPanel` mintája), és a MI tárhelyünkre mentést kihagyjuk (remoteUrl a
 * durable worker-URL → nem terheli a kvótát). A klip a kiválasztott sávra, a
 * playheadnél, frame-re illesztve kerül; minden a command buszon (undo).
 */
export function AddMediaSheet({
  track,
  onClose,
  onTts,
}: {
  track: TrackType;
  onClose: () => void;
  onTts?: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ provider: StorageProvider; entry: StorageEntry }[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadStorageProviders()
      .then(async (providers) => {
        const out: { provider: StorageProvider; entry: StorageEntry }[] = [];
        for (const provider of providers) {
          try {
            if (!(await provider.isAvailable())) {
              continue;
            }
            const entries = await provider.list();
            for (const entry of entries) {
              if (entry.kind === 'audio') {
                out.push({ provider, entry });
              }
            }
          } catch {
            // egy provider bukása nem állítja meg a többit
          }
        }
        if (alive) {
          setRows(out);
        }
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, []);

  const addAudio = (uri: string, name: string, duration: number, remoteUrl?: string) => {
    const st = useEditorStore.getState();
    const project = st.project;
    if (!project) {
      return;
    }
    const clip: AudioClip = {
      id: makeId('clip'),
      kind: 'audio',
      start: snapToFrame(st.playhead, project.fps ?? 30),
      duration: duration || 10,
      trimIn: 0,
      sourceDuration: duration || 10,
      uri,
      label: name,
      volume: 1,
      fadeIn: 0,
      fadeOut: 0,
      source: track === 'voiceover' ? 'voiceover' : 'imported',
    };
    st.addClip(track, clip, {
      id: makeId('ast'),
      kind: 'audio',
      uri,
      provider: remoteUrl ? 'library' : 'local',
      name,
      duration: duration || undefined,
      ...(remoteUrl ? { remoteUrl } : {}),
    });
    onClose();
  };

  const onImport = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const picked = await pickAudio();
      if (picked) {
        addAudio(picked.uri, picked.name, picked.duration);
      }
    } finally {
      setBusy(false);
    }
  };

  const onPickLibrary = async (provider: StorageProvider, entry: StorageEntry) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      const [duration, resolved] = await Promise.all([
        entry.duration || !provider.probeDuration
          ? Promise.resolve(entry.duration ?? 0)
          : provider.probeDuration(entry).then((d) => d ?? 0),
        provider.resolve(entry),
      ]);
      const remoteUrl = /^https?:\/\//i.test(resolved.uri)
        ? resolved.uri
        : `${renderServerUrl()}${entry.url}`;
      addAudio(resolved.uri, entry.name, duration, remoteUrl);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={styles.tap} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{t('studio.audio.addMedia')}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={palette.textDim} />
            </Pressable>
          </View>

          <Pressable onPress={onImport} disabled={busy} style={styles.importRow}>
            <Ionicons name="phone-portrait-outline" size={18} color={palette.accent} />
            <Text style={styles.importText}>{t('studio.audio.importDevice')}</Text>
          </Pressable>
          {onTts ? (
            <Pressable onPress={onTts} disabled={busy} style={[styles.importRow, { marginTop: 8 }]}>
              <Ionicons name="sparkles-outline" size={18} color={palette.accent2} />
              <Text style={styles.importText}>{t('studio.audio.ttsTitle')}</Text>
            </Pressable>
          ) : null}

          <Text style={styles.section}>{t('studio.audio.library')}</Text>
          {rows === null ? (
            <ActivityIndicator color={palette.accent} style={{ marginVertical: 16 }} />
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>{t('studio.audio.libraryEmpty')}</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
              {rows.map(({ provider, entry }) => (
                <Pressable
                  key={`${provider.id}:${entry.id}`}
                  onPress={() => onPickLibrary(provider, entry)}
                  disabled={busy}
                  style={styles.libRow}
                >
                  <Ionicons name="musical-note" size={16} color={palette.accent} />
                  <Text style={styles.libName} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  {entry.duration ? <Text style={styles.libMeta}>{formatTime(entry.duration)}</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  tap: { flex: 1 },
  sheet: {
    backgroundColor: '#0b0d14',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    maxHeight: '80%',
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: palette.text, fontSize: 16, fontWeight: '800' },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  importText: { color: palette.text, fontSize: 14, fontWeight: '700' },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  empty: { color: palette.textDim, fontSize: 12, paddingVertical: 8 },
  libRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  libName: { flex: 1, color: palette.text, fontSize: 13, fontWeight: '600' },
  libMeta: { color: palette.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
});

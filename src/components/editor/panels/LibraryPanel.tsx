import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PanelSection } from '@/components/ui/controls';
import { palette, trackColors } from '@/constants/editor';
import { isProRequiredError } from '@/lib/backend';
import { makeId } from '@/lib/id';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { ensureProxy } from '@/lib/proxy';
import { loadStorageProviders, storageProviders } from '@/lib/storageProviders';
import type { StorageEntry, StorageProvider } from '@/lib/storageProviders';
import { formatTime } from '@/lib/time';
import { importYouTubeMedia, type YtKind } from '@/lib/youtube';
import { useEditorStore } from '@/store/editorStore';
import { usePaywall } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';

type ProviderState =
  | { state: 'loading' }
  | { state: 'offline' }
  | { state: 'error'; message: string }
  | { state: 'ready'; entries: StorageEntry[] };

const kindIcons = {
  video: 'videocam-outline',
  image: 'image-outline',
  audio: 'musical-notes-outline',
} as const;

const kindColors = {
  video: trackColors.video,
  image: trackColors.video,
  audio: trackColors.music,
} as const;

function formatSize(bytes?: number): string {
  if (!bytes) {
    return '';
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Tár panel (full-plan F2): a StorageProvider-Gateway forrásainak böngészése.
 * Koppintásra a tétel az eszközre kerül (Imported) és a megfelelő sávra megy:
 * videó/kép a vizuális sáv végére, hang a lejátszófejhez a zene-sávra.
 */
function loadingStates(providers: StorageProvider[]): Record<string, ProviderState> {
  return Object.fromEntries(providers.map((p) => [p.id, { state: 'loading' as const }]));
}

export function LibraryPanel() {
  const { t } = useTranslation();
  const addClip = useEditorStore((s) => s.addClip);
  // a beépített providerekkel indulunk; a távoli források betöltés után jönnek
  const [providers, setProviders] = useState<StorageProvider[]>(storageProviders);
  const [states, setStates] = useState<Record<string, ProviderState>>(() =>
    loadingStates(storageProviders)
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  // 🔗 URL-import (YouTube stb.): teljes videó / csak hang / egy képkocka
  const [url, setUrl] = useState('');
  const [imgSec, setImgSec] = useState('');
  const [importBusy, setImportBusy] = useState<YtKind | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const importFromUrl = (kind: YtKind) => {
    const u = url.trim();
    if (!u || importBusy) {
      return;
    }
    setImportBusy(kind);
    setImportErr(null);
    const atSec = kind === 'image' ? parseFloat(imgSec) || 1 : undefined;
    withProgress(t('panels.library.importFromLinkProgress', { kind }), (report) =>
      importYouTubeMedia(u, kind, atSec, report)
    )
      .then((m) => {
        if (!m) {
          return;
        }
        const { project, playhead } = useEditorStore.getState();
        if (!project) {
          return;
        }
        const asset = {
          id: makeId('ast'),
          kind: m.kind,
          uri: m.uri,
          provider: 'local' as const,
          name: t('panels.library.urlAssetName', { kind }),
          duration: m.duration || undefined,
          width: m.width,
          height: m.height,
        };
        if (m.kind === 'audio') {
          addClip(
            'music',
            {
              kind: 'audio',
              id: makeId('clip'),
              start: playhead,
              duration: m.duration || 10,
              uri: m.uri,
              label: t('panels.library.urlAudioLabel'),
              volume: 1,
              fadeIn: 0,
              fadeOut: 0,
              source: 'imported',
            },
            asset
          );
        } else if (m.kind === 'video') {
          const duration = m.duration || 5;
          ensureProxy(m.uri).catch(() => {});
          addClip(
            'video',
            {
              kind: 'video',
              id: makeId('clip'),
              start: trackEnd(trackOf(project, 'video')),
              duration,
              uri: m.uri,
              trimIn: 0,
              sourceDuration: duration,
              speed: 1,
              volume: 1,
              filterId: 'none',
            },
            asset
          );
        } else {
          addClip(
            'video',
            {
              kind: 'image',
              id: makeId('clip'),
              start: trackEnd(trackOf(project, 'video')),
              duration: 4,
              uri: m.uri,
              filterId: 'none',
            },
            asset
          );
        }
        setUrl('');
      })
      .catch((e: Error) => {
        if (isProRequiredError(e)) {
          usePaywall.getState().open(e.capability);
        } else {
          setImportErr(e.message || t('panels.library.importFailed'));
        }
      })
      .finally(() => setImportBusy(null));
  };

  // csak aszinkron callbackben ír state-et — az induló "loading" a useState-ből jön
  const fetchAll = useCallback(() => {
    loadStorageProviders().then((loaded) => {
      setProviders(loaded);
      setStates((prev) => {
        const next = { ...prev };
        for (const p of loaded) {
          if (!next[p.id]) {
            next[p.id] = { state: 'loading' };
          }
        }
        return next;
      });
      for (const provider of loaded) {
        provider
          .isAvailable()
          .then((available) => {
            if (!available) {
              setStates((prev) => ({ ...prev, [provider.id]: { state: 'offline' } }));
              return;
            }
            return provider.list().then((entries) => {
              setStates((prev) => ({ ...prev, [provider.id]: { state: 'ready', entries } }));
            });
          })
          .catch((err: Error) => {
            setStates((prev) => ({
              ...prev,
              [provider.id]: { state: 'error', message: err.message },
            }));
          });
      }
    });
  }, []);

  useEffect(fetchAll, [fetchAll]);

  const load = () => {
    setStates(loadingStates(providers));
    fetchAll();
  };

  const addEntry = (provider: StorageProvider, entry: StorageEntry) => {
    if (busyId) {
      return;
    }
    setBusyId(entry.id);
    // hossz-pótlás a forrásból, ha a lista nem adta (távoli források)
    const withDuration: Promise<number | undefined> =
      entry.duration || entry.kind === 'image' || !provider.probeDuration
        ? Promise.resolve(entry.duration || undefined)
        : provider.probeDuration(entry).then((d) => d ?? undefined);

    Promise.all([withDuration, provider.resolve(entry)])
      .then(([probedDuration, resolved]) => {
        const { project, playhead } = useEditorStore.getState();
        if (!project) {
          return;
        }
        const asset = {
          id: makeId('ast'),
          kind: entry.kind,
          uri: resolved.uri,
          provider: resolved.provider,
          name: entry.name,
          duration: probedDuration,
          size: entry.size,
        };
        if (entry.kind === 'audio') {
          addClip(
            'music',
            {
              kind: 'audio',
              id: makeId('clip'),
              start: playhead,
              duration: probedDuration || 10,
              uri: resolved.uri,
              label: entry.name,
              volume: 1,
              fadeIn: 0,
              fadeOut: 0,
              source: 'imported',
            },
            asset
          );
        } else if (entry.kind === 'video') {
          const duration = probedDuration || 5;
          ensureProxy(resolved.uri).catch(() => {});
          addClip(
            'video',
            {
              kind: 'video',
              id: makeId('clip'),
              start: trackEnd(trackOf(project, 'video')),
              duration,
              uri: resolved.uri,
              trimIn: 0,
              sourceDuration: duration,
              speed: 1,
              volume: 1,
              filterId: 'none',
            },
            asset
          );
        } else {
          addClip(
            'video',
            {
              kind: 'image',
              id: makeId('clip'),
              start: trackEnd(trackOf(project, 'video')),
              duration: 4,
              uri: resolved.uri,
              filterId: 'none',
            },
            asset
          );
        }
      })
      .catch(() => {
        setStates((prev) => ({
          ...prev,
          [provider.id]: { state: 'error', message: t('panels.library.downloadFailed') },
        }));
      })
      .finally(() => setBusyId(null));
  };

  // 🔎 Médiatár-kereső (P0‑8): név szerinti szűrés minden forrásra
  const query = filter.trim().toLowerCase();
  const matches = (name: string) => !query || name.toLowerCase().includes(query);

  return (
    <View style={{ gap: 4 }}>
      <PanelSection title={t('panels.library.importSectionTitle')}>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder={t('panels.library.urlPlaceholder')}
          placeholderTextColor={palette.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.search}
        />
        <View style={styles.importRow}>
          {(
            [
              { kind: 'video', icon: 'videocam-outline' },
              { kind: 'audio', icon: 'musical-notes-outline' },
              { kind: 'image', icon: 'image-outline' },
            ] as const
          ).map((b) => (
            <Pressable
              key={b.kind}
              style={[styles.importBtn, !url.trim() ? styles.importBtnOff : null]}
              disabled={!url.trim() || importBusy !== null}
              onPress={() => importFromUrl(b.kind)}
            >
              {importBusy === b.kind ? (
                <ActivityIndicator size="small" color={palette.accent} />
              ) : (
                <Ionicons name={b.icon} size={16} color={palette.accent} />
              )}
              <Text style={styles.importBtnText}>{t('panels.library.importKind_' + b.kind)}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.importRow}>
          <Text style={styles.note}>{t('panels.library.imageTimeLabel')}</Text>
          <TextInput
            value={imgSec}
            onChangeText={setImgSec}
            placeholder="1"
            placeholderTextColor={palette.textDim}
            keyboardType="numeric"
            style={styles.secInput}
          />
        </View>
        {importErr ? <Text style={styles.errText}>{importErr}</Text> : null}
        <Text style={styles.note}>{t('panels.library.importHint')}</Text>
      </PanelSection>

      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder={t('panels.library.searchPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.search}
      />
      {providers.map((provider) => {
        const st = states[provider.id] ?? { state: 'loading' as const };
        const visible = st.state === 'ready' ? st.entries.filter((e) => matches(e.name)) : [];
        if (st.state === 'ready' && query && visible.length === 0) {
          return null; // szűrésnél az üres források nem foglalnak helyet
        }
        return (
          <PanelSection key={provider.id} title={provider.label}>
            {st.state === 'loading' ? (
              <ActivityIndicator color={palette.accent} />
            ) : st.state === 'offline' ? (
              <Text style={styles.note}>{t('panels.library.workerOffline')}</Text>
            ) : st.state === 'error' ? (
              <Text style={styles.note}>{st.message}</Text>
            ) : visible.length === 0 ? (
              <Text style={styles.note}>{provider.description}</Text>
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
      })}
      <Pressable onPress={load} style={styles.refresh}>
        <Ionicons name="refresh-outline" size={14} color={palette.textDim} />
        <Text style={styles.refreshText}>{t('panels.library.refresh')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  importBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
  },
  importBtnOff: {
    opacity: 0.45,
  },
  importBtnText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
  },
  secInput: {
    width: 60,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
  },
  errText: {
    color: palette.danger,
    fontSize: 11,
    marginTop: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '600',
  },
  rowMeta: {
    color: palette.textDim,
    fontSize: 11,
    marginTop: 1,
  },
  refresh: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  refreshText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  createEntryAction,
  createUrlImportAction,
  loadAllProviders,
} from '@/components/editor/panels/library/libraryActions';
import { styles } from '@/components/editor/panels/library/libraryStyles';
import { ProviderSection } from '@/components/editor/panels/library/ProviderSection';
import { UrlImportSection } from '@/components/editor/panels/library/UrlImportSection';
import { palette } from '@/constants/editor';
import { libraryQuery, loadingStates, type ProviderState } from '@/lib/libraryPanelOps';
import { storageProviders } from '@/lib/storageProviders';
import type { StorageProvider } from '@/lib/storageProviders';
import type { YtKind } from '@/lib/youtube';
import { useEditorStore } from '@/store/editorStore';

/**
 * Tár panel (full-plan F2): a StorageProvider-Gateway forrásainak böngészése.
 * Koppintásra a tétel az eszközre kerül (Imported) és a megfelelő sávra megy:
 * videó/kép a vizuális sáv végére, hang a lejátszófejhez a zene-sávra.
 */
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

  const { importFromUrl } = createUrlImportAction({
    t,
    addClip,
    url,
    setUrl,
    imgSec,
    importBusy,
    setImportBusy,
    setImportErr,
  });

  // csak aszinkron callbackben ír state-et — az induló "loading" a useState-ből jön
  const fetchAll = useCallback(() => {
    loadAllProviders(setProviders, setStates);
  }, []);

  useEffect(fetchAll, [fetchAll]);

  const load = () => {
    setStates(loadingStates(providers));
    fetchAll();
  };

  const { addEntry } = createEntryAction({ t, addClip, busyId, setBusyId, setStates });

  // 🔎 Médiatár-kereső (P0‑8): név szerinti szűrés minden forrásra
  const query = libraryQuery(filter);

  return (
    <View style={{ gap: 4 }}>
      <UrlImportSection
        url={url}
        setUrl={setUrl}
        imgSec={imgSec}
        setImgSec={setImgSec}
        importBusy={importBusy}
        importErr={importErr}
        importFromUrl={importFromUrl}
      />

      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder={t('panels.library.searchPlaceholder')}
        placeholderTextColor={palette.textDim}
        style={styles.search}
      />
      {providers.map((provider) => (
        <ProviderSection
          key={provider.id}
          provider={provider}
          st={states[provider.id] ?? { state: 'loading' as const }}
          query={query}
          busyId={busyId}
          addEntry={addEntry}
        />
      ))}
      <Pressable onPress={load} style={styles.refresh}>
        <Ionicons name="refresh-outline" size={14} color={palette.textDim} />
        <Text style={styles.refreshText}>{t('panels.library.refresh')}</Text>
      </Pressable>
    </View>
  );
}

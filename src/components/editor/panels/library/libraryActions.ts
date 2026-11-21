import type { TFunction } from 'i18next';

import { isProRequiredError, renderServerUrl } from '@/lib/backend';
import { makeId } from '@/lib/id';
import { entryRemoteUrl, importAtSec, type ProviderState } from '@/lib/libraryPanelOps';
import { logCaught } from '@/lib/logCaught';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { ensureProxy } from '@/lib/proxy';
import { loadStorageProviders } from '@/lib/storageProviders';
import type { StorageEntry, StorageProvider } from '@/lib/storageProviders';
import { importYouTubeMedia, type YtKind } from '@/lib/youtube';
import type { EditorState } from '@/store/editorStore';
import { useEditorStore } from '@/store/editorStore';
import { usePaywall } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';

/**
 * A Tár-panel hook nélküli akció-gyárai (REFACTOR: a LibraryPanel.tsx-ből): a gyökér
 * állapotát és settereit kapják, a store-t a hívás pillanatában olvassák.
 */

type SetStates = (update: (prev: Record<string, ProviderState>) => Record<string, ProviderState>) => void;

export interface UrlImportDeps {
  t: TFunction;
  addClip: EditorState['addClip'];
  url: string;
  setUrl: (url: string) => void;
  imgSec: string;
  importBusy: YtKind | null;
  setImportBusy: (kind: YtKind | null) => void;
  setImportErr: (err: string | null) => void;
}

/** 🔗 URL-import (YouTube stb.): teljes videó / csak hang / egy képkocka */
export function createUrlImportAction({
  t,
  addClip,
  url,
  setUrl,
  imgSec,
  importBusy,
  setImportBusy,
  setImportErr,
}: UrlImportDeps) {
  const importFromUrl = (kind: YtKind) => {
    const u = url.trim();
    if (!u || importBusy) {
      return;
    }
    setImportBusy(kind);
    setImportErr(null);
    const atSec = importAtSec(kind, imgSec);
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
          ensureProxy(m.uri).catch((caught) => { logCaught('components/editor/panels/LibraryPanel.tsx:importFromUrl', caught); });
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
      logCaught('components/editor/panels/LibraryPanel.tsx:importFromUrl', e);
        if (isProRequiredError(e)) {
          usePaywall.getState().open(e.capability);
        } else {
          setImportErr(e.message || t('panels.library.importFailed'));
        }
      })
      .finally(() => setImportBusy(null));
  };
  return { importFromUrl };
}

/**
 * A források (újra)betöltése: a lista, majd forrásonként elérhetőség + tétel-lista.
 * Csak aszinkron callbackben ír state-et — az induló "loading" a useState-ből jön.
 */
export function loadAllProviders(
  setProviders: (providers: StorageProvider[]) => void,
  setStates: SetStates
): void {
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
        logCaught('components/editor/panels/LibraryPanel.tsx:fetchAll', err);
          setStates((prev) => ({
            ...prev,
            [provider.id]: { state: 'error', message: err.message },
          }));
        });
    }
  });
}

export interface EntryActionDeps {
  t: TFunction;
  addClip: EditorState['addClip'];
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  setStates: SetStates;
}

/**
 * Koppintásra a tétel az eszközre kerül (Imported) és a megfelelő sávra megy:
 * videó/kép a vizuális sáv végére, hang a lejátszófejhez a zene-sávra.
 */
export function createEntryAction({ t, addClip, busyId, setBusyId, setStates }: EntryActionDeps) {
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
        // A forrás durable worker-URL-je → `remoteUrl`. Így a média-szinkron NEM
        // tölti fel a MI (kvótás) tárhelyünkre — a tartalom a user SAJÁT külső
        // forrásán marad (nem terhel minket), a hiányzó fájl onnan áll vissza.
        const remoteUrl = entryRemoteUrl(resolved.uri, entry.url, renderServerUrl);
        const asset = {
          id: makeId('ast'),
          kind: entry.kind,
          uri: resolved.uri,
          provider: resolved.provider,
          name: entry.name,
          duration: probedDuration,
          size: entry.size,
          remoteUrl,
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
          ensureProxy(resolved.uri).catch((caught) => { logCaught('components/editor/panels/LibraryPanel.tsx:addEntry', caught); });
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
      .catch((caught) => {
      logCaught('components/editor/panels/LibraryPanel.tsx:addEntry', caught);
        setStates((prev) => ({
          ...prev,
          [provider.id]: { state: 'error', message: t('panels.library.downloadFailed') },
        }));
      })
      .finally(() => setBusyId(null));
  };
  return { addEntry };
}

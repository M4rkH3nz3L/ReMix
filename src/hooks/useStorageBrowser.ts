import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import {
  type KindFilter,
  type SortKey,
  type StorageEntry,
  filterEntries,
  joinPath,
  parentPath,
  sortEntries,
  validateName,
} from '@/lib/remixFiles';
import {
  RemixFilesError,
  deviceDelete,
  deviceImport,
  deviceList,
  deviceMkdir,
  deviceRename,
  deviceSpace,
  deviceUri,
  deviceUsedBytes,
  remixDelete,
  remixList,
  remixMkdir,
  remixMove,
  remixTrashList,
} from '@/lib/remixFilesClient';
import { PROJECTS_DIR, projectFolderPath, protectionOf } from '@/lib/projectFolder';
import { referencedDevicePaths } from '@/lib/projectFolderClient';
import { listProjects, loadProject } from '@/lib/storage';
import { type StorageUsage, fetchStorageUsage } from '@/lib/storageQuota';
import {
  clearFinishedTransfers,
  enqueueTransfers,
  onTransferSettled,
  retryTransfer,
  useTransfers,
} from '@/lib/transferQueue';
import type { ProjectMeta } from '@/types/project';

export type BrowsableLocation = 'device' | 'remix';

export type { Transfer } from '@/lib/transferQueue';

interface NameDialog {
  mode: 'mkdir' | 'rename';
  value: string;
  target?: StorageEntry;
}

/**
 * 🗂️ A Tárhelyem képernyő nem-prezentációs logikája: hely-választás, mappa-
 * navigáció, rendezés/szűrés/keresés, kijelölés, mappa-/fájlműveletek és a
 * soros átviteli sor (fel-/letöltés, újrapróbálással).
 */
export function useStorageBrowser() {
  const { t } = useTranslation();
  const [location, setLocation] = useState<BrowsableLocation | null>(null);
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<StorageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [kind, setKind] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [grid, setGrid] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<NameDialog | null>(null);
  const transfers = useTransfers();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [device, setDevice] = useState({ used: 0, free: 0, total: 0 });
  /** élő projektek a mappájuk szerint (a Tárhelyem-védelemhez és a címkékhez) */
  const [projects, setProjects] = useState<Map<string, ProjectMeta>>(new Map());
  /** 🗑️ a ReMix Storage Lomtárának összesítője (null = nem elérhető / kijelentkezve) */
  const [trash, setTrash] = useState<{ count: number; bytes: number } | null>(null);

  const errorText = useCallback(
    (err: unknown) => {
      if (err instanceof RemixFilesError) {
        return t(`storage.errors.${err.code}`, { defaultValue: err.message });
      }
      return err instanceof Error ? err.message : String(err);
    },
    [t]
  );

  // a setState mindig promise-callbackben (halasztva) → effektből is hívható
  const refreshStats = useCallback(() => {
    void fetchStorageUsage()
      .catch(() => null)
      .then(setUsage);
    void Promise.resolve()
      .then(() => ({ used: deviceUsedBytes(), ...deviceSpace() }))
      .then(setDevice)
      .catch(() => {
        // eszköz-statisztika best-effort
      });
    void remixTrashList()
      .then((r) => setTrash({ count: r.items.length, bytes: r.bytes }))
      .catch(() => setTrash(null));
    void listProjects()
      .then((metas) => setProjects(new Map(metas.filter((m) => m.folder).map((m) => [m.folder as string, m]))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const reload = useCallback(async () => {
    if (!location) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setEntries(location === 'device' ? deviceList(path) : await remixList(path));
    } catch (err) {
      setEntries([]);
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, [location, path, errorText]);

  useEffect(() => {
    // a betöltés halasztva indul (nem szinkron setState az effektben)
    void Promise.resolve().then(reload);
  }, [reload]);

  const visible = useMemo(
    () => sortEntries(filterEntries(entries, kind, query), sortKey, sortDesc),
    [entries, kind, query, sortKey, sortDesc]
  );

  const open = useCallback((loc: BrowsableLocation | null) => {
    setLocation(loc);
    setPath('');
    setSelected(new Set());
    setQuery('');
  }, []);

  const go = useCallback((p: string) => {
    setPath(p);
    setSelected(new Set());
  }, []);

  const up = useCallback(() => {
    if (path) {
      go(parentPath(path));
    } else {
      open(null);
    }
  }, [path, go, open]);

  const toggleSelect = useCallback((p: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) {
        next.delete(p);
      } else {
        next.add(p);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const cycleSort = useCallback(() => {
    const order: SortKey[] = ['name', 'modified', 'size', 'kind'];
    setSortKey((k) => order[(order.indexOf(k) + 1) % order.length]);
  }, []);

  /** a projekt, amelyiknek a mappája az adott út (vagy amelyik mappájában van) */
  const projectAt = useCallback(
    (p: string): ProjectMeta | null => {
      if (!p.startsWith(`${PROJECTS_DIR}/`)) {
        return null;
      }
      return projects.get(p.slice(PROJECTS_DIR.length + 1).split('/')[0]) ?? null;
    },
    [projects]
  );

  /**
   * 🔒 Védelem: a `Projektek` gyűjtő és egy élő projekt mappája CSAK a projekt
   * törlésével tűnik el; a projekt által HASZNÁLT fájl sem törölhető/nevezhető át.
   * A tiltás okát adja vissza (i18n-szöveg), vagy null-t.
   */
  const blockedReason = useCallback(
    async (paths: string[]): Promise<string | null> => {
      const folders = new Set(projects.keys());
      for (const p of paths) {
        const owner = projectAt(p);
        let used: Set<string> = new Set();
        if (location === 'device' && owner && p !== projectFolderPath(owner.folder as string)) {
          const full = await loadProject(owner.id).catch(() => null);
          used = full ? referencedDevicePaths(JSON.stringify(full)) : new Set();
        }
        const prot = protectionOf(p, folders, used);
        if (prot === 'container') {
          return t('storage.protect.container');
        }
        if (prot === 'project') {
          return t('storage.protect.project', { name: owner?.name ?? '' });
        }
        if (prot === 'inUse') {
          return t('storage.protect.inUse', { name: owner?.name ?? '' });
        }
      }
      return null;
    },
    [projects, projectAt, location, t]
  );

  // ── név-dialógus (új mappa / átnevezés) ──
  const startMkdir = useCallback(() => setDialog({ mode: 'mkdir', value: '' }), []);
  const startRename = useCallback((target: StorageEntry) => setDialog({ mode: 'rename', value: target.name, target }), []);

  const submitDialog = useCallback(async () => {
    if (!dialog || !location) {
      return;
    }
    const name = dialog.value.trim();
    const invalid = validateName(name);
    if (invalid) {
      Alert.alert(t('storage.title'), t(`storage.nameErrors.${invalid}`));
      return;
    }
    try {
      if (dialog.mode === 'mkdir') {
        if (location === 'device') {
          deviceMkdir(path, name);
        } else {
          await remixMkdir(path, name);
        }
      } else if (dialog.target && name !== dialog.target.name) {
        const blocked = await blockedReason([dialog.target.path]);
        if (blocked) {
          setDialog(null);
          Alert.alert(t('storage.protect.title'), blocked);
          return;
        }
        if (location === 'device') {
          deviceRename(dialog.target.path, name);
        } else {
          await remixMove(dialog.target.path, joinPath(parentPath(dialog.target.path), name));
        }
      }
      setDialog(null);
      await reload();
    } catch (err) {
      Alert.alert(t('storage.title'), errorText(err));
    }
  }, [dialog, location, path, reload, t, errorText, blockedReason]);

  // ── törlés (megerősítéssel; egyértelmű, HOL törlődik) ──
  const confirmDelete = useCallback(
    async (paths: string[]) => {
      if (!location || !paths.length) {
        return;
      }
      const blocked = await blockedReason(paths);
      if (blocked) {
        Alert.alert(t('storage.protect.title'), blocked);
        return;
      }
      Alert.alert(
        t('storage.deleteTitle', { count: paths.length }),
        t(location === 'device' ? 'storage.deleteDeviceBody' : 'storage.deleteRemixBody'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                if (location === 'device') {
                  deviceDelete(paths);
                } else {
                  await remixDelete(paths);
                }
              } catch (err) {
                Alert.alert(t('storage.title'), errorText(err));
              }
              setSelected(new Set());
              refreshStats();
              await reload();
            },
          },
        ]
      );
    },
    [location, t, errorText, reload, refreshStats, blockedReason]
  );

  // ── átviteli sor: a képernyőtől független, tartós modul (`transferQueue`) ──
  const enqueue = enqueueTransfers;
  const retry = retryTransfer;
  const clearFinished = clearFinishedTransfers;

  // befejezett átvitel után a lista + a statisztika frissül (ha a képernyő nyitva van)
  useEffect(
    () =>
      onTransferSettled(() => {
        refreshStats();
        void reload();
      }),
    [refreshStats, reload]
  );

  /** Eszköz → ReMix Storage: a fájl a felhőben UGYANABBA a relatív mappába kerül (másolat, nem szinkron). */
  const copyToRemix = useCallback(
    (items: StorageEntry[]) => {
      enqueue(
        items
          .filter((e) => !e.isFolder)
          .map((e) => ({ direction: 'up' as const, name: e.name, source: e.uri ?? deviceUri(e.path), targetDir: parentPath(e.path) }))
      );
      setSelected(new Set());
    },
    [enqueue]
  );

  /** ReMix Storage → Eszközöm: ugyanabba a relatív mappába a telefonon. */
  const downloadToDevice = useCallback(
    (items: StorageEntry[]) => {
      enqueue(
        items
          .filter((e) => !e.isFolder)
          .map((e) => ({ direction: 'down' as const, name: e.name, source: e.path, targetDir: parentPath(e.path) }))
      );
      setSelected(new Set());
    },
    [enqueue]
  );

  /** „Hozzáadás": eszközön a rendszer-fájlválasztóból bemásol; felhőben a választott fájlokat feltölti. */
  const addFiles = useCallback(async () => {
    try {
      if (location === 'device') {
        await deviceImport(path);
        refreshStats();
        await reload();
        return;
      }
      const picked = await File.pickFileAsync({ multipleFiles: true });
      if (picked.canceled) {
        return;
      }
      enqueue(picked.result.map((f) => ({ direction: 'up' as const, name: f.name, source: f.uri, targetDir: path })));
    } catch (err) {
      Alert.alert(t('storage.title'), errorText(err));
    }
  }, [location, path, enqueue, reload, refreshStats, t, errorText]);

  const share = useCallback(
    async (e: StorageEntry) => {
      try {
        await Sharing.shareAsync(e.uri ?? deviceUri(e.path));
      } catch (err) {
        Alert.alert(t('storage.title'), errorText(err));
      }
    },
    [t, errorText]
  );

  const selectedEntries = useMemo(() => entries.filter((e) => selected.has(e.path)), [entries, selected]);

  return {
    t,
    location,
    path,
    visible,
    loading,
    error,
    sortKey,
    sortDesc,
    setSortDesc,
    cycleSort,
    kind,
    setKind,
    query,
    setQuery,
    grid,
    setGrid,
    selected,
    selectedEntries,
    toggleSelect,
    clearSelection,
    dialog,
    setDialog,
    startMkdir,
    startRename,
    submitDialog,
    confirmDelete,
    transfers,
    retry,
    clearFinished,
    copyToRemix,
    downloadToDevice,
    addFiles,
    share,
    usage,
    device,
    trash,
    refreshStats,
    projects,
    projectAt,
    open,
    go,
    up,
    reload,
  };
}

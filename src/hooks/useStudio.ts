import { type Href, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList } from 'react-native';

import { gridColumns } from '@/constants/layout';
import { createProjectFromTemplate } from '@/constants/templates';
import type { VideoTemplate } from '@/constants/templates';
import { useLayout } from '@/hooks/useLayout';
import { missingCreateFields } from '@/lib/createProjectForm';
import { isMyAccountDeleted, reactivateAccount } from '@/lib/account';
import { BG_SWATCHES, clampDim, isHexColor, nearestAspect } from '@/lib/canvasPresets';
import { listSharedWithMe, type SharedProject } from '@/lib/collab';
import { backupProjectToCloud, deleteCloudProject, syncProjectsFromCloud } from '@/lib/cloudSync';
import { deletePostsForProject, publishRenderedProject } from '@/lib/feed';
import { makeId } from '@/lib/id';
import { pickSourceAsset, type SourceKind } from '@/lib/projectSource';
import { fileKindOf, studioForKind } from '@/lib/remixFiles';
import { importFromStorage } from '@/lib/storageImport';
import {
  createEmptyProject,
  parseHashtags,
  parseKeywords,
  studioRoute,
  type CreateProjectConfig,
} from '@/lib/projectUtils';
import { deleteProject, listProjects, loadProject, saveProject } from '@/lib/storage';
import { visibleProjects } from '@/lib/projectKinds';
import { DEFAULT_STORAGE_FORMAT } from '@/lib/model3dExport';
import { projectStorageMap } from '@/lib/storageQuota';
import { pickAndParseVided, relinkInteractive } from '@/lib/videdFile';
import { guardPro } from '@/store/paywallStore';
import { withProgress } from '@/store/progressStore';
import type { MeshFormat } from '@/types/model3d';
import type { AspectRatio, Asset, AudioMasterTarget, Project, ProjectKind, ProjectMeta } from '@/types/project';

/**
 * 🎬 A Stúdió / projekt-lista képernyő NEM-prezentációs magja: a lista
 * betöltése/feliratkozásai, a létrehozás-űrlap állapota, és MINDEN handler
 * (create/duplicate/delete/rename/share/import/kind-váltás). A viselkedés
 * BIT-RE az eredeti `studio/index.tsx`-é — ez csak kiemelés (Health/02.4).
 * Adat a meglévő `lib/storage`/`*Client`/Supabase rétegen; semmi közvetlen
 * projekt-írás (a store/command-bus hívások változatlanok).
 */
export function useStudio() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [storageMap, setStorageMap] = useState<Record<string, number>>({});
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  // 🔎 SEO-meta — a projekt létrehozásakor kötelező (a cím = a projekt neve fent)
  const [seoDescription, setSeoDescription] = useState('');
  const [seoHashtags, setSeoHashtags] = useState('');
  const [seoKeywords, setSeoKeywords] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('9:16');
  // 🎛️ melyik stúdió: videó (idővonal), kép (réteg-fa) vagy hang (audio)
  const [kind, setKind] = useState<ProjectKind>('video');
  // 🖼️ kép-projekt: szabad vászon W×H (px, string az inputhoz) + formátum + háttér
  const [imgW, setImgW] = useState<string>('1080');
  const [imgH, setImgH] = useState<string>('1080');
  const [imgFormat, setImgFormat] = useState<'raster' | 'vector'>('raster');
  const [bg, setBg] = useState<string>(BG_SWATCHES[0]);
  // 🎚️ hang-projekt: a master-cél (az alap hangosság/plafon preset)
  const [audioTarget, setAudioTarget] = useState<AudioMasterTarget>('music');
  // 🧊 3D-projekt: a modell tárolási formátuma
  const [model3dFormat, setModel3dFormat] = useState<MeshFormat>(DEFAULT_STORAGE_FORMAT);
  // 🗂️ a projekt FORRÁS-mappája — a létrehozáskor hozzáadott támogatott fájlok
  const [sources, setSources] = useState<Asset[]>([]);
  const [renaming, setRenaming] = useState<ProjectMeta | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [shared, setShared] = useState<SharedProject[]>([]);
  const { t } = useTranslation();
  const L = useLayout();
  // a lista-referencia a fülsáv „ugrás" műveleteihez (tetejére / sablonokhoz)
  const listRef = useRef<FlatList<ProjectMeta>>(null);
  // a kártya kívánt szélességéből számolt rács — iPaden 3–4 oszlop is lehet,
  // a korábbi fix „640px → 2 oszlop" helyett (lásd @/constants/layout)
  const columns = gridColumns(L.width, 340, 4);

  const refresh = useCallback(() => {
    // ⚡ fókuszkor csak a HELYI lista (olcsó); a felhő-visszatöltés egyszer, mountkor fut
    // 🔒 az ezen az eszközön nem elérhető fajták (LiDAR nélkül a 3D) rejtve — nem törölve
    listProjects().then((all) => setProjects(visibleProjects(all))).catch(() => {});
    // 👥 velem megosztott projektek (felhő, ha be van jelentkezve; egyébként [])
    listSharedWithMe().then(setShared).catch(() => {});
    // 🗄️ per-projekt MI-tárhely-használat (a MI tárolónkon foglalt pontos bájt)
    projectStorageMap().then(setStorageMap).catch(() => {});
  }, []);

  useFocusEffect(refresh);

  // 🗄️ EGYSZERI felhő-visszatöltés belépéskor (NEM minden fókuszkor — perf): a
  // helyileg HIÁNYZÓ projekteket hozza vissza (újratelepítés/eszközváltás után).
  useEffect(() => {
    syncProjectsFromCloud()
      .then((n) => {
        if (n > 0) {
          refresh();
        }
      })
      .catch(() => {});
  }, [refresh]);

  // 🗑️ deaktivált fiók → helyreállítás-prompt belépés után (a tartalom addig rejtve)
  useEffect(() => {
    isMyAccountDeleted()
      .then((d) => {
        if (!d) {
          return;
        }
        Alert.alert(t('gdpr.deactivatedTitle'), t('gdpr.deactivatedBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('gdpr.reactivate'),
            onPress: () => reactivateAccount().then(refresh).catch(() => {}),
          },
        ]);
      })
      .catch(() => {});
  }, [refresh, t]);

  const resetCreateForm = () => {
    setName('');
    setSeoDescription('');
    setSeoHashtags('');
    setSeoKeywords('');
    setKind('video');
    setImgW('1080');
    setImgH('1080');
    setImgFormat('raster');
    setBg(BG_SWATCHES[0]);
    setAudioTarget('music');
    setModel3dFormat(DEFAULT_STORAGE_FORMAT);
    setSources([]);
  };

  // 🗂️→🎬 „Új projekt ebből" a Tárhelyemből: a fájl forrásként, a fajtájának megfelelő
  // stúdióval és a fájlnévből képzett névvel nyitja az Új projekt űrlapot (a SEO-mezőket
  // a user tölti ki). A fájl a projekt első megnyitásakor a projekt-mappájába kerül.
  const openParams = useLocalSearchParams<{ openLoc?: string; openPath?: string; openUri?: string }>();
  const handledOpen = useRef<string | null>(null);
  useEffect(() => {
    const { openLoc, openPath, openUri } = openParams;
    if (!openPath || (openLoc !== 'device' && openLoc !== 'remix')) {
      return;
    }
    const key = `${openLoc}:${openPath}`;
    if (handledOpen.current === key) {
      return;
    }
    handledOpen.current = key;
    const fileName = openPath.slice(openPath.lastIndexOf('/') + 1);
    const studio = studioForKind(fileKindOf(fileName));
    if (!studio) {
      return;
    }
    void importFromStorage({ location: openLoc, path: openPath, name: fileName, isFolder: false, uri: openUri })
      .then((asset) => {
        if (!asset) {
          return;
        }
        resetCreateForm();
        setKind(studio);
        setName(fileName.replace(/\.[^.]+$/, ''));
        setSources([asset]);
        setCreating(true);
      })
      .catch((e: Error) => Alert.alert(t('common.error'), e.message))
      .finally(() => router.setParams({ openLoc: undefined, openPath: undefined, openUri: undefined }));
    // a resetCreateForm stabil setterekből áll; a paraméter-kulcs a valódi trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openParams.openLoc, openParams.openPath, openParams.openUri]);

  // 🗂️ egy támogatott forrás-fájl hozzáadása a leendő projekt forrás-mappájához
  const addSource = (sk: SourceKind) => {
    pickSourceAsset(sk)
      .then((asset) => {
        if (asset) {
          setSources((prev) => [...prev, asset]);
        }
      })
      .catch(() => {});
  };

  // egy forrás eltávolítása a leendő projekt forrás-mappájából
  const removeSource = (id: string) => {
    setSources((prev) => prev.filter((x) => x.id !== id));
  };

  // az Új projekt gomb csak akkor aktív, ha a kötelező SEO-mezők ki vannak töltve —
  // a hiányzók LISTÁJA kell a képernyőnek is (megmondja, mi hiányzik, és odaugrik)
  const missingFields = missingCreateFields({
    name,
    description: seoDescription,
    hashtags: seoHashtags,
    keywords: seoKeywords,
  });
  const seoReady = missingFields.length === 0;

  const create = async () => {
    const title = name.trim();
    const description = seoDescription.trim();
    const hashtags = parseHashtags(seoHashtags);
    const keywords = parseKeywords(seoKeywords);
    // védőkorlát: a gomb tiltva van, míg mind ki nincs töltve
    if (!title || !description || hashtags.length === 0 || keywords.length === 0) {
      return;
    }
    // 🎛️ fajta-specifikus induló-beállítások: kép → szabad W×H + formátum + háttér, hang → master-cél
    const config: CreateProjectConfig = {};
    // a projekt-szintű aspectRatio: képnél a megadott W×H-ból a legközelebbi enum
    let projectAspect = aspect;
    if (kind === 'image') {
      const w = clampDim(imgW);
      const h = clampDim(imgH);
      projectAspect = nearestAspect(w, h);
      config.image = {
        width: w,
        height: h,
        format: imgFormat,
        // érvénytelen hex → essen vissza az alap sötétre (a 'transparent' átmegy)
        background: bg === 'transparent' || isHexColor(bg) ? bg : BG_SWATCHES[0],
      };
    } else if (kind === 'audio') {
      config.audioMasterTarget = audioTarget;
    } else if (kind === 'model3d') {
      config.model3dStorageFormat = model3dFormat;
    }
    // a cím szolgál a projekt neveként ÉS a SEO-címként is (később külön szerkeszthető)
    const base = createEmptyProject(
      title,
      projectAspect,
      { title, description, hashtags, keywords },
      kind,
      config
    );
    // 🗂️ a létrehozáskor hozzáadott források a projekt forrás-mappájába (assets)
    const project = sources.length > 0 ? { ...base, assets: sources } : base;
    await saveProject(project);
    backupProjectToCloud(project); // 🗄️ azonnal a userhez a felhőbe is (best-effort)
    setCreating(false);
    resetCreateForm();
    // 🎛️ a fajtának megfelelő stúdióba nyitunk (videó → editor, kép/hang → saját)
    router.push(studioRoute(kind, project.id) as Href);
  };

  const createFromTemplate = (template: VideoTemplate) => {
    const project = createProjectFromTemplate(template);
    saveProject(project)
      .then(() => {
        backupProjectToCloud(project); // 🗄️ felhő-backup (best-effort)
        router.push(`/editor/${project.id}`);
      })
      .catch(() => Alert.alert(t('common.error'), t('home.createFailed')));
  };

  const confirmDelete = (meta: ProjectMeta) => {
    Alert.alert(t('home.deleteTitle'), t('home.deleteMessage', { name: meta.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          // „nincs projekt → nincs videó": helyi törlés + a projekthez tartozó
          // feed-posztok törlése + a felhő-projekt törlése (a DB-trigger defenzíven
          // szintén törli a posztokat, pl. még-nem-mentett felhő esetén is fedve).
          deleteProject(meta.id)
            .then(() => Promise.all([deletePostsForProject(meta.id), deleteCloudProject(meta.id)]))
            .then(refresh)
            .catch(() => {});
        },
      },
    ]);
  };

  const duplicate = (meta: ProjectMeta) => {
    loadProject(meta.id)
      .then((p) => {
        if (!p) {
          return;
        }
        return saveProject({
          ...p,
          id: makeId('prj'),
          name: `${p.name}${t('home.copySuffix')}`,
          createdAt: new Date().toISOString(),
          // 🔀 remix-lineage: az új projekt az eredetiből készült
          remixOf: { projectId: p.id, name: p.name },
          // 📁 a másolat SAJÁT mappát kap a betöltéskor (a fájlokat átmásolja), a
          // szinkron projektenként külön döntés → alapból ki
          folder: undefined,
          syncToRemix: undefined,
        });
      })
      .then(refresh)
      .catch(() => Alert.alert(t('common.error'), t('home.duplicateFailed')));
  };

  const startRename = (meta: ProjectMeta) => {
    setRenaming(meta);
    setRenameValue(meta.name);
  };

  const saveRename = () => {
    const meta = renaming;
    const nextName = renameValue.trim();
    setRenaming(null);
    if (!meta || !nextName || nextName === meta.name) {
      return;
    }
    loadProject(meta.id)
      .then((p) => (p ? saveProject({ ...p, name: nextName }) : undefined))
      .then(refresh)
      .catch(() => Alert.alert(t('common.error'), t('home.renameFailed')));
  };

  const shareToFeed = (meta: ProjectMeta) => {
    loadProject(meta.id)
      .then((p) => {
        if (!p) {
          return;
        }
        // render (ha kell) → feltöltés → posztolás; Pro-kapu a felhő-renderre
        return guardPro(
          () =>
            withProgress(t('feed.rendering'), (report) => publishRenderedProject(p, report)).then(
              (res) => {
                if (res) {
                  refresh();
                  Alert.alert(t('feed.shareToFeed'), t('feed.sharedOk'), [
                    { text: t('common.ok') },
                    { text: t('nav.feed'), onPress: () => router.push('/') },
                  ]);
                }
              }
            ),
          (e) => Alert.alert(t('common.error'), e.message)
        );
      })
      .catch((e: Error) => Alert.alert(t('common.error'), e.message));
  };

  const projectMenu = (meta: ProjectMeta) => {
    Alert.alert(meta.name, undefined, [
      // 🧊 a 3D-projektnek nincs idővonala → a feed-megosztás (render) üres lenne; a modell
      // képként/videóként a 3D Stúdió Export lapjáról vagy a videószerkesztőből osztható
      ...(meta.kind === 'model3d' ? [] : [{ text: t('feed.shareToFeed'), onPress: () => shareToFeed(meta) }]),
      { text: t('common.rename'), onPress: () => startRename(meta) },
      { text: t('common.duplicate'), onPress: () => duplicate(meta) },
      { text: t('collab.share'), onPress: () => router.push(`/collab/${meta.id}`) },
      {
        text: t('storage.projectStorage'),
        onPress: () => router.push({ pathname: '/storage', params: { project: meta.id } } as Href),
      },
      { text: t('common.delete'), style: 'destructive', onPress: () => confirmDelete(meta) },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const importVided = () => {
    pickAndParseVided()
      .then((result) => {
        if (!result) {
          return;
        }
        const finish = (p: Project) => {
          saveProject(p)
            .then(() => {
              refresh();
              router.push(studioRoute(p.kind, p.id) as Href);
            })
            .catch(() => Alert.alert(t('common.import'), t('home.saveFailed')));
        };
        if (result.missing.length === 0) {
          if (result.relinked > 0) {
            Alert.alert(
              t('home.importDoneTitle'),
              t('home.importRelinked', { count: result.relinked })
            );
          }
          finish(result.project);
          return;
        }
        Alert.alert(
          t('home.missingMediaTitle'),
          t('home.missingMediaCount', { count: result.missing.length }) +
            (result.relinked > 0
              ? ' ' + t('home.missingMediaRelinkedNote', { count: result.relinked })
              : '') +
            '. ' +
            t('home.missingMediaAsk'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('common.later'), onPress: () => finish(result.project) },
            {
              text: t('home.relink'),
              onPress: () => {
                relinkInteractive(result.project, result.missing).then(finish);
              },
            },
          ]
        );
      })
      .catch((err: Error) => Alert.alert(t('common.import'), err.message));
  };

  // 🤖 „AI eszközök": az AI a szerkesztőben él → a legutóbbi projektet nyitjuk
  // meg egyből az AI-panellel; ha még nincs projekt, előbb létrehozunk egyet
  const openAiTools = () => {
    // az AI-panel a videó-editorban él → a legutóbbi VIDEÓ-projektet nyitjuk;
    // ha csak kép/hang van (vagy semmi), az új-projekt lapot kínáljuk
    const recent = projects.find((p) => (p.kind ?? 'video') === 'video');
    if (recent) {
      router.push(`/editor/${recent.id}?panel=assistant`);
    } else {
      setCreating(true);
    }
  };

  // a létrehozás-modal bezárása mégsével (forma visszaállítással)
  const cancelCreate = () => {
    setCreating(false);
    resetCreateForm();
  };

  return {
    // i18n / elrendezés
    t,
    L,
    columns,
    listRef,
    // adat
    projects,
    storageMap,
    shared,
    // létrehozás-űrlap állapot
    creating,
    setCreating,
    name,
    setName,
    seoDescription,
    setSeoDescription,
    seoHashtags,
    setSeoHashtags,
    seoKeywords,
    setSeoKeywords,
    aspect,
    setAspect,
    kind,
    setKind,
    imgW,
    setImgW,
    imgH,
    setImgH,
    imgFormat,
    setImgFormat,
    bg,
    setBg,
    audioTarget,
    setAudioTarget,
    model3dFormat,
    setModel3dFormat,
    sources,
    addSource,
    removeSource,
    seoReady,
    missingFields,
    // átnevezés-űrlap állapot
    renaming,
    setRenaming,
    renameValue,
    setRenameValue,
    // handlerek
    create,
    cancelCreate,
    createFromTemplate,
    duplicate,
    confirmDelete,
    startRename,
    saveRename,
    shareToFeed,
    projectMenu,
    importVided,
    openAiTools,
  };
}

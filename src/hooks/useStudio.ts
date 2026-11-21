import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList } from 'react-native';

import { gridColumns } from '@/constants/layout';
import { useLayout } from '@/hooks/useLayout';
import type { SharedProject } from '@/lib/collab';
import { BG_SWATCHES } from '@/lib/canvasPresets';
import { IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { DEFAULT_STORAGE_FORMAT } from '@/lib/model3dExport';
import type { MeshFormat } from '@/types/model3d';
import type { AspectRatio, Asset, AudioMasterTarget, ProjectKind, ProjectMeta } from '@/types/project';
import { templateTarget, type AudioTemplate } from '@/lib/audioTemplates';
import { registerDevAction } from '@/lib/devActions';
import { createProjectCreateActions } from '@/hooks/studio/createProjectCreateActions';
import { createProjectMenuActions } from '@/hooks/studio/createProjectMenuActions';
import { createStudioFormActions } from '@/hooks/studio/createStudioFormActions';
import { createStudioImportActions } from '@/hooks/studio/createStudioImportActions';
import { useOpenFromStorage } from '@/hooks/studio/useOpenFromStorage';
import { useStudioLoaders } from '@/hooks/studio/useStudioLoaders';

/**
 * 🎬 A Stúdió / projekt-lista képernyő NEM-prezentációs magja: a lista
 * betöltése/feliratkozásai, a létrehozás-űrlap állapota, és MINDEN handler
 * (create/duplicate/delete/rename/share/import/kind-váltás). A viselkedés
 * BIT-RE az eredeti `studio/index.tsx`-é — ez csak kiemelés (Health/02.4).
 * Adat a meglévő `lib/storage`/`*Client`/Supabase rétegen; semmi közvetlen
 * projekt-írás (a store/command-bus hívások változatlanok).
 *
 * REFACTOR: a részek a `hooks/studio/` alatt élnek; a hook-hívások és az effektek SORRENDJE
 * változatlan.
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
  // 🧩 hang-projekt indító-sablon (a választás a hangosság-célt is beállítja)
  const [audioTemplate, setAudioTemplateRaw] = useState<AudioTemplate>('blank');
  // 🎨 S8: a Design-projekt induló sablonja (a sablon-könyvtár kulcsa)
  const [designTemplate, setDesignTemplate] = useState<string>(IMAGE_TEMPLATES[0].key);
  const setAudioTemplate = (tpl: AudioTemplate) => {
    setAudioTemplateRaw(tpl);
    const tg = templateTarget(tpl);
    if (tg) setAudioTarget(tg);
  };
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

  const refresh = useStudioLoaders({ t, setProjects, setShared, setStorageMap });

  const { resetCreateForm, addSource, removeSource, missingFields, seoReady, cancelCreate } =
    createStudioFormActions({
      setCreating,
      name,
      setName,
      seoDescription,
      setSeoDescription,
      seoHashtags,
      setSeoHashtags,
      seoKeywords,
      setSeoKeywords,
      setKind,
      setImgW,
      setImgH,
      setImgFormat,
      setBg,
      setAudioTarget,
      setAudioTemplateRaw,
      setDesignTemplate,
      setModel3dFormat,
      setSources,
    });

  useOpenFromStorage({ t, resetCreateForm, setKind, setName, setSources, setCreating });

  const { create, createFromTemplate } = createProjectCreateActions({
    form: {
      name,
      seoDescription,
      seoHashtags,
      seoKeywords,
      aspect,
      kind,
      designTemplate,
      imgW,
      imgH,
      imgFormat,
      bg,
      audioTarget,
      model3dFormat,
      audioTemplate,
      sources,
    },
    setCreating,
    resetCreateForm,
    t,
  });

  const { confirmDelete, duplicate, startRename, saveRename, shareToFeed, projectMenu } =
    createProjectMenuActions({ t, refresh, renaming, setRenaming, renameValue, setRenameValue });

  const { importVided, openAiTools } = createStudioImportActions({
    t,
    refresh,
    projects,
    setCreating,
  });

  // 🧪 füstteszt: az „Új projekt” űrlap kitöltése és a létrehozás (a valódi `create` útja; csak __DEV__)
  const createRef = useRef(create);
  createRef.current = create;
  useEffect(() => {
    const offs = [
      registerDevAction('studio.fillCreate', (arg) => {
        const a = arg as { name: string; kind: ProjectKind; audioTemplate?: AudioTemplate; designTemplate?: string; noSeo?: boolean };
        setName(a.name);
        // S22: `noSeo` — a SEO nélküli (csak névvel) létrehozás mérése
        setSeoDescription(a.noSeo ? '' : 'smoke');
        setSeoHashtags(a.noSeo ? '' : '#smoke');
        setSeoKeywords(a.noSeo ? '' : 'smoke');
        setKind(a.kind);
        if (a.audioTemplate) setAudioTemplate(a.audioTemplate);
        if (a.designTemplate) setDesignTemplate(a.designTemplate);
        return true;
      }),
      registerDevAction('studio.create', () => createRef.current()),
    ];
    return () => offs.forEach((off) => off());
  }, []);

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
    audioTemplate,
    setAudioTemplate,
    designTemplate,
    setDesignTemplate,
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

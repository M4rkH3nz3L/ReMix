import type { Dispatch, SetStateAction } from 'react';

import type { AudioTemplate } from '@/lib/audioTemplates';
import { BG_SWATCHES } from '@/lib/canvasPresets';
import { missingCreateFields } from '@/lib/createProjectForm';
import { IMAGE_TEMPLATES } from '@/lib/imageTemplates';
import { DEFAULT_STORAGE_FORMAT } from '@/lib/model3dExport';
import { pickSourceAsset, type SourceKind } from '@/lib/projectSource';
import type { MeshFormat } from '@/types/model3d';
import type { Asset, AudioMasterTarget, ProjectKind } from '@/types/project';
import { logCaught } from '@/lib/logCaught';

/**
 * 📝 Az „Új projekt” űrlap műveletei (REFACTOR: a useStudio-ból) — hook-mentes csoport, minden
 * renderben újra létrehozva: űrlap-nullázás, források, hiányzó mezők, mégse.
 */
export function createStudioFormActions({
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
}: {
  setCreating: Dispatch<SetStateAction<boolean>>;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  seoDescription: string;
  setSeoDescription: Dispatch<SetStateAction<string>>;
  seoHashtags: string;
  setSeoHashtags: Dispatch<SetStateAction<string>>;
  seoKeywords: string;
  setSeoKeywords: Dispatch<SetStateAction<string>>;
  setKind: Dispatch<SetStateAction<ProjectKind>>;
  setImgW: Dispatch<SetStateAction<string>>;
  setImgH: Dispatch<SetStateAction<string>>;
  setImgFormat: Dispatch<SetStateAction<'raster' | 'vector'>>;
  setBg: Dispatch<SetStateAction<string>>;
  setAudioTarget: Dispatch<SetStateAction<AudioMasterTarget>>;
  setAudioTemplateRaw: Dispatch<SetStateAction<AudioTemplate>>;
  setDesignTemplate: Dispatch<SetStateAction<string>>;
  setModel3dFormat: Dispatch<SetStateAction<MeshFormat>>;
  setSources: Dispatch<SetStateAction<Asset[]>>;
}) {
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
    setAudioTemplateRaw('blank');
    setDesignTemplate(IMAGE_TEMPLATES[0].key);
    setModel3dFormat(DEFAULT_STORAGE_FORMAT);
    setSources([]);
  };

  // 🗂️ egy támogatott forrás-fájl hozzáadása a leendő projekt forrás-mappájához
  const addSource = (sk: SourceKind) => {
    pickSourceAsset(sk)
      .then((asset) => {
        if (asset) {
          setSources((prev) => [...prev, asset]);
        }
      })
      .catch((caught) => { logCaught('hooks/useStudio.ts:addSource', caught); });
  };

  // egy forrás eltávolítása a leendő projekt forrás-mappájából
  const removeSource = (id: string) => {
    setSources((prev) => prev.filter((x) => x.id !== id));
  };

  // az Új projekt gomb csak a név hiányában tiltott (S22: a SEO a megosztáskor kell) —
  // a hiányzók LISTÁJA kell a képernyőnek is (megmondja, mi hiányzik, és odaugrik)
  const missingFields = missingCreateFields({
    name,
    description: seoDescription,
    hashtags: seoHashtags,
    keywords: seoKeywords,
  });
  const seoReady = missingFields.length === 0;

  // a létrehozás-modal bezárása mégsével (forma visszaállítással)
  const cancelCreate = () => {
    setCreating(false);
    resetCreateForm();
  };

  return { resetCreateForm, addSource, removeSource, missingFields, seoReady, cancelCreate };
}

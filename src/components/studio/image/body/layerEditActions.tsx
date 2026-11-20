import type { TFunction } from 'i18next';
import { type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';

import type { SheetKind } from '@/components/studio/image/body/ImageStudioSheets';
import type { MultiAction } from '@/components/studio/image/body/MultiSelectBar';
import type { StudioModeState } from '@/components/studio/image/body/useStudioModeState';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { makeId } from '@/lib/id';
import { brandLogoLayer } from '@/lib/imageBrand';
import { addLayer, createGroup, updateLayer } from '@/lib/imageDoc';
import { alignLayersInDoc } from '@/lib/imageLayerLayout';
import { centeredPhotoLayer, defaultLayer, defaultShapeLayer } from '@/lib/imageLayerDefaults';
import { duplicateLayers, removeLayers } from '@/lib/imageMulti';
import { docFromTemplate, type ImageTemplate } from '@/lib/imageTemplates';
import { variantDoc } from '@/lib/imageVariants';
import { pickImage } from '@/lib/media';
import { pixelLayerBox, type PixelArt } from '@/lib/pixelArt';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { copyBrandLogoInto, useBrandStyle } from '@/store/brandStyleStore';
import { useEditorStore } from '@/store/editorStore';
import type { Asset, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

export interface LayerEditDeps {
  t: TFunction;
  doc: ImageDoc | null;
  commit: (next: ImageDoc, label?: string) => void;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  setSheet: (next: SheetKind) => void;
  addDocPage: (nd: ImageDoc) => void;
  ms: Pick<StudioModeState, 'multiIds' | 'setMultiIds' | 'pixelLayerId' | 'setPixelOpen'>;
}

/**
 * ➕ Réteg-szerkesztések a dokumentumon: új réteg / forma / forrás / márka-logó / sablon- és
 * variáns-lap, a sablon-helyőrző kitöltése, a többes kijelölés műveletei és a pixel-munka.
 * VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból, hook nélküli gyárként — minden írás a body
 * `commit`-ján (command-bus, `UPSERT_IMAGE_DOC` + címke) át. `.tsx`: a fordítás-paritás őr innen is gyűjt.
 */
export function createLayerEditActions({ t, doc, commit, setSelectedId, setSheet, addDocPage, ms }: LayerEditDeps) {
  const { multiIds, setMultiIds, pixelLayerId, setPixelOpen } = ms;
  // 🏷️ S11: a márka-logó a lapra — a projektbe MÁSOLVA (a márka-fájl a helyén marad), egy visszavonás
  const insertBrandLogo = (uri: string) => {
    if (!doc) return;
    const copy = copyBrandLogoInto(projectMediaDir(), uri);
    if (!copy) {
      Alert.alert(t('studio.image.brand.logos'), t('studio.image.brand.logoMissing'));
      return;
    }
    const id = makeId('lyr');
    commit(addLayer(doc, brandLogoLayer(copy, id, effectiveCanvas(doc), t('studio.image.brand.logoName'))), t('studio.image.brand.logoInsert'));
    setSelectedId(id);
  };
  const addTemplatePage = (tpl: ImageTemplate) => addDocPage(docFromTemplate(tpl, t(`studio.image.templates.${tpl.key}`), () => makeId('lyr'), useBrandStyle.getState()));
  const addVariantPage = (width: number, height: number, label: string) => {
    if (doc) {
      addDocPage(variantDoc(doc, width, height, label, () => makeId('lyr')));
    }
  };

  const add = (kind: ImageLayer['kind']) => {
    if (!doc) {
      return;
    }
    if (kind === 'photo') {
      void pickImage().then((picked) => {
        if (!picked) {
          return;
        }
        const l: PhotoLayer = centeredPhotoLayer(makeId('lyr'), picked.uri);
        commit(addLayer(doc, l), t('studio.image.undoAddPhoto'));
        setSelectedId(l.id);
      });
      return;
    }
    const id = makeId('lyr');
    const l: ImageLayer = defaultLayer(kind, id, t('studio.image.newText'));
    commit(addLayer(doc, l), t('studio.image.undoAddLayer'));
    setSelectedId(id);
  };

  // 🔷 a KIVÁLASZTOTT formatípus hozzáadása (nem csak téglalap) — alap-méret + fill
  const addShapeType = (shape: Exclude<ShapeLayer['shape'], 'path'>) => {
    if (!doc) {
      return;
    }
    const id = makeId('lyr');
    const l: ShapeLayer = defaultShapeLayer(shape, id);
    commit(addLayer(doc, l), t('studio.image.undoAddLayer'));
    setSelectedId(id);
    setSheet(null);
  };

  // 🗂️ forrás-mappából a vászonra: a KÉP-forrás egy fotó-rétegként kerül be
  const insertSource = (asset: Asset) => {
    if (!doc || asset.kind !== 'image') {
      return;
    }
    const l: PhotoLayer = centeredPhotoLayer(makeId('lyr'), asset.uri, asset.id);
    commit(addLayer(doc, l), t('studio.image.undoAddPhoto'));
    setSelectedId(l.id);
    setSheet(null);
  };

  // 🧩 S9: a sablon média-helyőrzője koppintásra a galériát nyitja; a kép a helyőrző helyén és
  // méretében, kitöltéssel (`cover`) jelenik meg — a kompozíció megmarad, egy visszavonás
  const placeImage = (layerId: string, uri: string): boolean => {
    const fresh = useEditorStore.getState().project?.imageDocs?.find((d) => d.id === doc?.id) ?? doc;
    const target = fresh?.layers.find((l) => l.id === layerId);
    if (!fresh || !target || target.kind !== 'photo' || !target.placeholder) {
      return false;
    }
    commit(updateLayer<PhotoLayer>(fresh, layerId, { uri, placeholder: undefined, fit: 'cover' }), t('studio.image.undoAddPhoto'));
    return true;
  };
  const fillPlaceholder = (layerId: string) => {
    void pickImage().then((picked) => {
      if (picked) {
        placeImage(layerId, picked.uri);
      }
    });
  };

  const onMultiAction = (action: MultiAction) => {
    if (!doc || !multiIds) {
      return;
    }
    if (action === 'delete') {
      commit(removeLayers(doc, multiIds), t('studio.image.undoDelete'));
      setMultiIds(null);
    } else if (action === 'duplicate') {
      commit(duplicateLayers(doc, multiIds, () => makeId('lyr')), t('studio.image.undoDuplicate'));
    } else if (action === 'group') {
      commit(createGroup(doc, multiIds, makeId('grp'), t('studio.image.multi.group')), t('studio.image.multi.group'));
      setMultiIds(null);
    } else {
      commit(alignLayersInDoc(doc, multiIds, action), t(`studio.image.multi.${action}`));
    }
  };

  // 👾 a pixel-munka szerkeszthető rétegként kerül a dokumentumba, egy undo-lépésben
  const onPixelDone = (art: PixelArt, uri: string) => {
    setPixelOpen(false);
    if (!doc) {
      return;
    }
    if (pixelLayerId) {
      commit(updateLayer(doc, pixelLayerId, { uri, pixelArt: art } as Partial<ImageLayer>), t('studio.image.pixel.title'));
      return;
    }
    const { width, height } = effectiveCanvas(doc);
    const id = makeId('lyr');
    const layer: PhotoLayer = { kind: 'photo', id, name: t('studio.image.pixel.title'), uri, position: { x: 0.5, y: 0.5 }, ...pixelLayerBox(art.width, art.height, width, height), fit: 'stretch', pixelArt: art };
    commit(addLayer(doc, layer), t('studio.image.pixel.title'));
    setSelectedId(id);
  };

  return {
    insertBrandLogo,
    addTemplatePage,
    addVariantPage,
    add,
    addShapeType,
    insertSource,
    placeImage,
    fillPlaceholder,
    onMultiAction,
    onPixelDone,
  };
}

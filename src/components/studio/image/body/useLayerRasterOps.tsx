import { File } from 'expo-file-system';
import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { keepRenderedInProject } from '@/components/studio/image/RenderStage';
import { requestCutout } from '@/lib/bgremove';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { foregroundMask } from '@/lib/foregroundMask';
import { rasterSubDoc, replaceWithRaster } from '@/lib/imageCanvasOps';
import { updateLayer } from '@/lib/imageDoc';
import { fullCanvasImageMask } from '@/lib/imageLayerDefaults';
import { chooseImageRenderRoute } from '@/lib/imageRenderRoute';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { useEditorStore } from '@/store/editorStore';
import { usePaywall } from '@/store/paywallStore';
import type { ClipMask, ImageDoc, PhotoLayer, ShapeLayer } from '@/types/project';

type Rasterize = (
  target: ImageDoc,
  opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number; signal?: AbortSignal }
) => Promise<string | null>;

/**
 * 🧱 Réteg-szintű raszter- és vektor-műveletek: egyesítés / raszterizálás, háttér-eltávolítás,
 * vonalból forma / eltolt útvonal. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból — minden
 * írás a body `commit`-ján (command-bus) át. `.tsx`: a fordítás-paritás őr (`imageLocaleParity`)
 * innen is gyűjti a `t()`-kulcsokat.
 */
export function useLayerRasterOps({
  doc,
  busy,
  setBusy,
  isPro,
  commit,
  rasterize,
  setSelectedId,
}: {
  doc: ImageDoc | null;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  isPro: boolean;
  commit: (next: ImageDoc, label?: string) => void;
  rasterize: Rasterize;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}) {
  const { t } = useTranslation();
  /**
   * 🧱 Rétegek egyesítése / raszterizálása. Offline first (CORE K1): a telefon rendereli,
   * vízjel nélkül, minden szinten (ami a telefonon fut, ingyenes). Csak ha a rétegeken
   * telefonon nem rajzolható effekt van, kell a worker — annak Free-renderje vízjeles, és
   * az a réteg pixeleibe égne, ezért az az eset marad Pro.
   */
  const mergeLayers = async (ids: string[], label: string) => {
    if (!doc || busy || ids.length === 0) {
      return;
    }
    const sub = rasterSubDoc(doc, ids);
    if (!isPro && chooseImageRenderRoute(sub, true) === 'worker') {
      usePaywall.getState().open();
      return;
    }
    setBusy(true);
    try {
      const rendered = await rasterize(sub, { format: 'png', height: effectiveCanvas(doc).height });
      const uri = rendered ? keepRenderedInProject(rendered, `merge_${makeId('r')}`) : null;
      if (!uri) {
        Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
        return;
      }
      const fresh = useEditorStore.getState().project?.imageDocs?.find((d) => d.id === doc.id) ?? doc;
      const id = makeId('lyr');
      commit(replaceWithRaster(fresh, ids, uri, id, label), label);
      setSelectedId(id);
    } catch (e) {
      logCaught('components/studio/image/ImageStudioBody.tsx:mergeLayers', e);
      Alert.alert(t('studio.image.renderFailTitle'), (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ✂️ háttér ki: eszközön, ha lehet (ingyenes); különben a felhő-út. A maszk festett maszkként
  // kerül a rétegre, így roncsolásmentes és ecsettel javítható.
  const removeBackground = async (layer: PhotoLayer) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    try {
      const { Skia } = await import('@shopify/react-native-skia');
      const { projectMaskToCanvas } = await import('@/components/studio/image/projectMask');
      const output = new File(projectMediaDir(), `fg_${Date.now().toString(36)}.png`).uri;
      const local = await foregroundMask(layer.uri, output);
      if (local.status === 'no-subject') {
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.bgRemove.noSubject'));
        return;
      }
      let maskUri: string | null = local.status === 'ok' ? local.uri : null;
      if (local.status !== 'ok') {
        if (!isPro) {
          Alert.alert(t('studio.image.bgRemove.proTitle'), t('studio.image.bgRemove.proBody'));
          return;
        }
        maskUri = (await requestCutout(layer.uri))?.uri ?? null;
      }
      const [photo, mask] = await Promise.all([Skia.Data.fromURI(layer.uri), maskUri ? Skia.Data.fromURI(maskUri) : null]);
      const [photoImg, maskImg] = [Skia.Image.MakeImageFromEncoded(photo), mask ? Skia.Image.MakeImageFromEncoded(mask) : null];
      const canvas = effectiveCanvas(doc);
      const image = photoImg && maskImg ? projectMaskToCanvas(maskImg, layer, { width: photoImg.width(), height: photoImg.height() }, canvas, local.status !== 'ok') : null;
      if (!image) {
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.bgRemove.failBody'));
        return;
      }
      const next: ClipMask = fullCanvasImageMask(image);
      commit(updateLayer<PhotoLayer>(doc, layer.id, { mask: next }), t('studio.image.bgRemove.undo'));
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:removeBackground', caught);
      Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.bgRemove.failBody'));
    } finally {
      setBusy(false);
    }
  };

  // 🔷 vonalból forma és eltolt útvonal: az eredmény szerkeszthető összetett forma
  const pathOperation = async (layer: ShapeLayer, op: 'outlineStroke' | 'offsetOut' | 'offsetIn') => {
    if (!doc) {
      return;
    }
    try {
      const { offsetToResult, strokeToResult, withResult } = await import('@/components/studio/image/skiaVector');
      const canvas = effectiveCanvas(doc);
      const step = Math.round(canvas.width * 0.01) * (op === 'offsetIn' ? -1 : 1);
      const result = op === 'outlineStroke' ? strokeToResult(layer, canvas) : offsetToResult(layer, canvas, step);
      if (!result) {
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.pen.outlineFail'));
        return;
      }
      commit(updateLayer<ShapeLayer>(doc, layer.id, withResult(layer, result)), t(`studio.imageTools.${op}`));
    } catch (caught) {
      logCaught('components/studio/image/ImageStudioBody.tsx:pathOperation', caught);
      Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.pen.outlineFail'));
    }
  };

  return { mergeLayers, removeBackground, pathOperation };
}

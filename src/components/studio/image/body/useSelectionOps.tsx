import { type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { keepRenderedInProject } from '@/components/studio/image/RenderStage';
import type { SelectionAction, SelectTool } from '@/components/studio/image/body/SelectionBar';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { addLayer, updateLayer } from '@/lib/imageDoc';
import { selectionOnlyDoc } from '@/lib/imageExportCheck';
import { lassoPolygonMask, wandHighlightShape } from '@/lib/imageLayerDefaults';
import { canvasToLayerBox, healRegionFromPoints, layerBoxToCanvas } from '@/lib/imageLayerGeometry';
import {
  adjustSelection,
  copySelectionToLayer,
  deleteSelection,
  maskFromSelection,
  needsRasterForSelection,
  rasterSubForSelection,
  replaceWithSelectionRaster,
} from '@/lib/imageSelectionOps';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { type CanvasPoint, pathShapeFromCanvasPoints } from '@/lib/penPath';
import { applyRing, type Point, type Selection, type SelectionMode } from '@/lib/selection';
import { applyRangeRings as applyRangeRingsTo } from '@/lib/selectionRings';
import { useEditorStore } from '@/store/editorStore';
import type { ClipMask, ImageDoc, ImageLayer, PhotoLayer, ShapeLayer } from '@/types/project';

type Rasterize = (
  target: ImageDoc,
  opts?: { format?: 'png' | 'jpg' | 'webp'; height?: number; quality?: number; signal?: AbortSignal }
) => Promise<string | null>;

/** a lasszó következő rajzának célja: vágó-maszk, lokális korrekció, folt-javítás vagy festett maszk */
export type MaskTarget = { id: string; target: 'clip' | 'local' | 'heal' | 'paint' };

/**
 * ✂️ Kijelölés-, lasszó- és varázspálca-műveletek: a pálca szín-szelekciója, a kijelölés gyűrűi, a
 * kijelölés-műveletek (szöveg/forma raszterizálásával), az él-finomítás és a lasszó lezárása (forma
 * vagy maszk). VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból: az állapot a body-é, itt csak a
 * kezelők; minden dokumentum-írás a body `commit`-ján (command-bus) át. `.tsx`: a fordítás-paritás
 * őr (`imageLocaleParity`) innen is gyűjti a `t()`-kulcsokat.
 */
export function useSelectionOps({
  doc,
  busy,
  setBusy,
  commit,
  rasterize,
  exportPart,
  setSelectedId,
  selection,
  setSelection,
  selectTool,
  selectMode,
  selectTargetId,
  setSelectTargetId,
  clearSelection,
  wandTolerance,
  wandContiguous,
  setWandActive,
  maskTarget,
  setMaskTarget,
  setLassoActive,
}: {
  doc: ImageDoc | null;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  commit: (next: ImageDoc, label?: string) => void;
  rasterize: Rasterize;
  exportPart: (part: ImageDoc | null) => Promise<void>;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
  selection: Selection | null;
  setSelection: Dispatch<SetStateAction<Selection | null>>;
  selectTool: SelectTool | null;
  selectMode: SelectionMode;
  selectTargetId: string | null;
  setSelectTargetId: Dispatch<SetStateAction<string | null>>;
  clearSelection: () => void;
  wandTolerance: number;
  wandContiguous: boolean;
  setWandActive: Dispatch<SetStateAction<boolean>>;
  maskTarget: MaskTarget | null;
  setMaskTarget: Dispatch<SetStateAction<MaskTarget | null>>;
  setLassoActive: Dispatch<SetStateAction<boolean>>;
}) {
  const { t } = useTranslation();
  // 🪄 varázspálca: a koppintott fotó-régió szín-szelekciója (Skia) → ZÁRT path-forma
  //    a fotó dobozán (féligátlátszó kiemelés). A mag tesztelt; a Skia glue új build után fut.
  const onWandSeed = (
    uri: string,
    u: number,
    v: number,
    source: PhotoLayer
  ) => {
    if (!doc || busy) {
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        // Skia-függő mag → lustán töltjük; ha a natív modul hiányzik, a catch kezeli
        const { colorRangeSelect, magicWandSelect } = await import('@/lib/magicWandClient');
        const canvas = effectiveCanvas(doc);
        const boxAspect = (source.w * canvas.width) / (source.h * canvas.height);
        if (!wandContiguous && selectTool === 'wand') {
          const rings = await colorRangeSelect(uri, u, v, wandTolerance, { boxAspect, fit: source.fit });
          if (rings && rings.length > 0) {
            applyRangeRings(rings.map((r) => ({ op: r.op, points: r.points.map((p) => layerBoxToCanvas(p, source, canvas)) })));
          } else {
            Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.wand.failBody'));
          }
          return;
        }
        const outline = await magicWandSelect(uri, u, v, wandTolerance, { boxAspect, fit: source.fit });
        if (outline && outline.length >= 3 && selectTool === 'wand') {
          addSelectionRing(outline.map((p) => layerBoxToCanvas(p, source, canvas)));
        } else if (outline && outline.length >= 3 && doc) {
          const shape: ShapeLayer = wandHighlightShape(makeId('lyr'), outline, source);
          commit(addLayer(doc, shape), t('studio.image.undoWand'));
          setSelectedId(shape.id);
        } else {
          Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.wand.failBody'));
        }
      } catch (caught) {
        logCaught('components/studio/image/ImageStudioBody.tsx:onWandSeed', caught);
        // a @shopify/react-native-skia natív modul hiányzik a dev-kliensből → új build kell
        Alert.alert(t('studio.image.wand.failTitle'), t('studio.image.skiaMissing'));
      } finally {
        setBusy(false);
        setWandActive(false);
      }
    })();
  };

  // ✂️ kijelölés: eszköz választása; a többi mód bezárul, a meglévő kijelölés megmarad
  const addSelectionRing = (ring: Point[]) => setSelection((sel) => applyRing(sel, ring, selectMode));
  // 🎯 S17: a színtartomány gyűrűi — új kijelölésként pontosan (régió + lyuk + sziget); a meglévőhöz
  // adva / kivonva / metszve a régiók körvonalaival (a lyukak ilyenkor nem számítanak)
  const applyRangeRings = (rings: { op: 'add' | 'subtract'; points: Point[] }[]) =>
    setSelection((sel) => applyRangeRingsTo(sel, rings, selectMode));

  // a dev-akció (füstteszt) a kijelölést és a célt közvetlenül adja; a gombok az állapotot
  const selectionState = selection;
  const selectTargetIdState = selectTargetId;
  const selectionAction = (action: SelectionAction, selection: Selection | null = selectionState, selectTargetId: string | null = selectTargetIdState) => {
    if (!doc || !selection) {
      return;
    }
    // 🔠 S17: szövegen / formán a képpont-művelet előtt a telefon fotóvá raszterizálja a réteget (egy
    // visszavonási lépés a művelettel együtt) — a művelet utána ugyanaz, mint a fotón
    const pixelOp = action === 'copy' || action === 'delete' || action === 'mask' || action === 'export';
    if (pixelOp && selectTargetId && needsRasterForSelection(doc, selectTargetId)) {
      if (busy) {
        return;
      }
      const targetId = selectTargetId;
      setBusy(true);
      void (async () => {
        try {
          const rendered = await rasterize(rasterSubForSelection(doc, targetId), { format: 'png', height: effectiveCanvas(doc).height });
          const uri = rendered ? keepRenderedInProject(rendered, `sel_${makeId('r')}`) : null;
          if (!uri) {
            Alert.alert(t('studio.image.renderFailTitle'), t('studio.image.renderFailBody'));
            return;
          }
          const fresh = useEditorStore.getState().project?.imageDocs?.find((d) => d.id === doc.id) ?? doc;
          const rasterId = makeId('lyr');
          setSelectTargetId(rasterId);
          runSelectionAction(action, replaceWithSelectionRaster(fresh, targetId, uri, rasterId), rasterId, selection);
        } catch (caught) {
          logCaught('components/studio/image/ImageStudioBody.tsx:selectionRaster', caught);
          Alert.alert(t('studio.image.renderFailTitle'), (caught as Error).message);
        } finally {
          setBusy(false);
        }
      })();
      return;
    }
    runSelectionAction(action, doc, selectTargetId, selection);
  };
  const runSelectionAction = (action: SelectionAction, base: ImageDoc, targetId: string | null, selection: Selection) => {
    if (action === 'export') {
      void exportPart(targetId ? selectionOnlyDoc(base, selection, targetId) : null);
      return;
    }
    const doc = base;
    const selectTargetId = targetId;
    const id = makeId('lyr');
    let next: ImageDoc | null = null;
    if (action === 'copy') {
      next = copySelectionToLayer(doc, selectTargetId, selection, id);
    } else if (action === 'delete') {
      next = deleteSelection(doc, selectTargetId, selection);
    } else if (action === 'mask') {
      next = maskFromSelection(doc, selectTargetId, selection);
    } else if (action === 'adjust') {
      next = adjustSelection(doc, selection, id);
    } else if (selection.ops.length === 1 && !selection.invert) {
      const shape = pathShapeFromCanvasPoints(selection.ops[0].points, true, id);
      next = shape ? addLayer(doc, shape) : null;
    }
    if (!next) {
      Alert.alert(t('studio.image.select.failTitle'), t('studio.image.select.failBody'));
      return;
    }
    commit(next, t('studio.image.select.undo'));
    // a törlés után a kijelölés marad (mehet a következő lépés), a többi egy új réteget szerkeszt tovább
    if (action !== 'delete') {
      clearSelection();
      setSelectedId(action === 'mask' ? selectTargetId : id);
    }
  };

  // 🧲 S17: él-finomítás — a kijelölés a cél-fotó valódi éleire húzva (a kijelölés állapot, nem undo-lépés)
  const refineSelection = () => {
    if (!doc || !selection || busy) {
      return;
    }
    const target = doc.layers.find((l) => l.id === selectTargetId);
    if (target?.kind !== 'photo') {
      Alert.alert(t('studio.image.select.failTitle'), t('studio.image.select.refineNeedsPhoto'));
      return;
    }
    setBusy(true);
    void (async () => {
      try {
        const { refineSelectionToEdges } = await import('@/lib/magicWandClient');
        const canvas = effectiveCanvas(doc);
        const boxAspect = (target.w * canvas.width) / (target.h * canvas.height);
        const rings = selection.ops.map((o) => o.points.map((p) => canvasToLayerBox(p, target, canvas)));
        const refined = await refineSelectionToEdges(target.uri, rings, { boxAspect, fit: target.fit });
        if (!refined) {
          Alert.alert(t('studio.image.select.failTitle'), t('studio.image.select.failBody'));
          return;
        }
        const ops = selection.ops.map((o, i) => ({ ...o, points: refined[i].map((p) => layerBoxToCanvas(p, target, canvas)) }));
        setSelection((sel) => (sel === selection ? { ...sel, ops } : sel));
      } catch (caught) {
        logCaught('components/studio/image/ImageStudioBody.tsx:refineSelection', caught);
      } finally {
        setBusy(false);
      }
    })();
  };

  // 🪢 lasszó: a szabadkézi pontokból ZÁRT path-forma — VAGY (maszk-módban) a kijelölt réteg maszkja
  const commitLasso = (points: CanvasPoint[]) => {
    if (selectTool === 'lasso') {
      addSelectionRing(points);
      return;
    }
    if (doc && points.length >= 3 && maskTarget) {
      if (maskTarget.target === 'heal') {
        // 🩹 folt-javítás: a lasszó bbox-át a FOTÓ dobozába transzformáljuk (0–1 box-lokális) → heal-régió
        const cur = doc.layers.find((l) => l.id === maskTarget.id);
        if (cur && cur.kind === 'photo') {
          // I18: a réteg forgatása/tükrözése is számít — a heal a réteg saját terében fut
          const region = healRegionFromPoints(points, cur, effectiveCanvas(doc));
          commit(
            updateLayer<PhotoLayer>(doc, maskTarget.id, { heal: [...(cur.heal ?? []), region] }),
            t('studio.image.undoHeal', { defaultValue: 'Folt-javítás' })
          );
        }
        setMaskTarget(null);
        setLassoActive(false);
        return;
      }
      // 🎭 szelekció → maszk (poligon): a vászon-normalizált pontok + bbox
      const mask: ClipMask = lassoPolygonMask(points);
      if (maskTarget.target === 'local') {
        // a meglévő lokális grade/adjust megmarad, csak a maszk cserélődik
        const cur = doc.layers.find((l) => l.id === maskTarget.id);
        const prev = cur && 'localAdjust' in cur ? (cur as PhotoLayer).localAdjust : undefined;
        commit(
          updateLayer(doc, maskTarget.id, { localAdjust: { ...prev, mask } } as Partial<ImageLayer>),
          t('studio.image.undoMask', { defaultValue: 'Maszk' })
        );
      } else {
        commit(updateLayer(doc, maskTarget.id, { mask } as Partial<ImageLayer>), t('studio.image.undoMask', { defaultValue: 'Maszk' }));
      }
      setMaskTarget(null);
      setLassoActive(false);
      return;
    }
    if (doc && points.length >= 3) {
      const shape = pathShapeFromCanvasPoints(points, true, makeId('lyr'));
      if (shape) {
        commit(addLayer(doc, shape), t('studio.image.undoLasso'));
        setSelectedId(shape.id);
      }
    }
    setMaskTarget(null);
    setLassoActive(false);
  };

  return { onWandSeed, addSelectionRing, selectionAction, refineSelection, commitLasso };
}

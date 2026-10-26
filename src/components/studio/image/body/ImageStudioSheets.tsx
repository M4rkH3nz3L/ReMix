import { SourceSheet } from '@/components/SourceSheet';
import { AdjustStackSheet } from '@/components/studio/image/AdjustStackSheet';
import { DevelopSheet } from '@/components/studio/image/DevelopSheet';
import { AlignSheet } from '@/components/studio/image/AlignSheet';
import { BooleanSheet } from '@/components/studio/image/BooleanSheet';
import { CanvasSheet } from '@/components/studio/image/CanvasSheet';
import { EffectsSheet } from '@/components/studio/image/EffectsSheet';
import { ExportSheet } from '@/components/studio/image/ExportSheet';
import { HistorySheet } from '@/components/studio/image/HistorySheet';
import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { LayerStyleSheet } from '@/components/studio/image/LayerStyleSheet';
import { PatternSheet } from '@/components/studio/image/PatternSheet';
import { ShapePickerSheet } from '@/components/studio/image/ShapePickerSheet';
import { canAlignLayer } from '@/lib/imageLayerLayout';
import { canBoolean } from '@/lib/imageBoolean';
import type { ImageSheetId } from '@/lib/panelSpecs';
import type { Asset, ImageDoc, ImageLayer, ShapeLayer } from '@/types/project';

/** 🗂️ melyik szerkesztő-lap van nyitva — a body `sheet` állapotának típusa */
export type SheetKind = ImageSheetId | null;

/**
 * 🗂️ Sheet-host — a `sheet` állapottól függő szerkesztő-lapok feltételes
 * renderelése. VISELKEDÉS-MEGŐRZŐ kiemelés az `ImageStudioBody`-ból: pontosan
 * ugyanaz a feltétel-lánc, render-sorrend és prop-átadás, mint korábban a body
 * JSX-ében — minden handler/érték PROPBÓL érkezik (a body adja át).
 */
export function ImageStudioSheets({
  sheet,
  doc,
  selectedLayer,
  effectiveSelectedId,
  mode,
  pageCount,
  busy,
  commit,
  setSheet,
  setSelectedId,
  onAdd,
  onAddShapeType,
  onInsertSource,
  onDrawMask,
  onRaster,
  onSvg,
  onPdf,
  onPsd,
  canPsd,
  onVideo,
  onShareSlideshow,
  onShareCarousel,
}: {
  sheet: SheetKind;
  doc: ImageDoc | null;
  selectedLayer: ImageLayer | null;
  effectiveSelectedId: string | null;
  mode: 'project' | 'scoped';
  pageCount: number;
  busy: boolean;
  commit: (next: ImageDoc, label?: string) => void;
  setSheet: (sheet: SheetKind) => void;
  setSelectedId: (id: string | null) => void;
  onAdd: (kind: ImageLayer['kind']) => void;
  onAddShapeType: (shape: Exclude<ShapeLayer['shape'], 'path'>) => void;
  onInsertSource: (asset: Asset) => void;
  onDrawMask: (layerId: string, target: 'clip' | 'local' | 'heal') => void;
  onRaster: (opts: { format: 'png' | 'jpg' | 'webp'; height: number; quality: number }) => void;
  onSvg: () => void;
  onPdf: () => void;
  onPsd: () => void;
  /** 🔒 PSD-export Pro-kapu (false → letiltva + upsell) */
  canPsd: boolean;
  onVideo: () => void;
  onShareSlideshow?: () => void;
  onShareCarousel?: () => void;
}) {
  return (
    <>
      {sheet === 'layers' && doc ? (
        <LayerPanel
          doc={doc}
          selectedId={effectiveSelectedId}
          onSelect={setSelectedId}
          onAdd={onAdd}
          commit={commit}
          onClose={() => setSheet(null)}
          onOpenAdjust={() => {
            if (selectedLayer?.kind === 'photo') {
              setSheet('adjust');
            }
          }}
          onDrawMask={onDrawMask}
        />
      ) : null}
      {sheet === 'style' && doc && selectedLayer ? (
        <LayerStyleSheet
          doc={doc}
          layer={selectedLayer}
          commit={commit}
          onOpenAdjust={() => {
            if (selectedLayer.kind === 'photo') {
              setSheet('adjust');
            }
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'adjust' && doc && selectedLayer?.kind === 'photo' ? (
        <AdjustStackSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'develop' && doc && selectedLayer?.kind === 'photo' ? (
        <DevelopSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'fx' && doc && selectedLayer?.kind === 'shape' ? (
        <EffectsSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'pattern' && doc && selectedLayer?.kind === 'shape' ? (
        <PatternSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'align' && doc && selectedLayer && canAlignLayer(selectedLayer) ? (
        <AlignSheet doc={doc} layer={selectedLayer} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'boolean' && doc && effectiveSelectedId && canBoolean(doc, effectiveSelectedId) ? (
        <BooleanSheet
          doc={doc}
          selectedId={effectiveSelectedId}
          commit={commit}
          onResult={setSelectedId}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'shapePicker' && doc ? (
        <ShapePickerSheet onPick={onAddShapeType} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'canvas' && doc ? (
        <CanvasSheet doc={doc} commit={commit} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'history' && doc ? <HistorySheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'source' ? (
        <SourceSheet onInsert={onInsertSource} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'export' && doc ? (
        <ExportSheet
          doc={doc}
          busy={busy}
          pageCount={mode === 'project' ? pageCount : 1}
          canPsd={canPsd}
          onRaster={onRaster}
          onSvg={onSvg}
          onPdf={onPdf}
          onPsd={onPsd}
          onVideo={onVideo}
          onShareSlideshow={onShareSlideshow}
          onShareCarousel={onShareCarousel}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}

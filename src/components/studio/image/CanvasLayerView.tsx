import { Fragment, memo } from 'react';

import { ShapeOverlay } from '@/components/preview/ShapeOverlay';
import { TextOverlay } from '@/components/preview/TextOverlay';
import { FillLayerView } from '@/components/studio/image/FillLayerView';
import { PhotoLayerView } from '@/components/studio/image/PhotoLayerView';
import { ShapeEffects } from '@/components/studio/image/ShapeEffects';
import { layerToShapeClip, layerToTextClip, textEffectStyle } from '@/lib/imageLayerClip';
import { correctHex, correctPaint, type LayerCorrections } from '@/lib/imagePixelPipeline';
import type { ClipMask, ImageLayer } from '@/types/project';

/**
 * ⚡ Egy réteg a vásznon. Memoizált: egy réteg változása vagy húzása nem rajzolja újra a többit,
 * ezért minden kelléknek stabilnak kell lennie (a szülő gondoskodik róla).
 */
export const CanvasLayerView = memo(function CanvasLayerView({
  layer: l,
  box,
  canvas,
  zoom,
  moveRange,
  selected,
  corrections,
  onSelect,
  onMove,
  onEdit,
}: {
  layer: ImageLayer;
  box: { w: number; h: number };
  canvas: { width: number; height: number };
  zoom: number;
  moveRange: [number, number];
  selected: boolean;
  corrections: LayerCorrections<ClipMask>;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: { x: number; y: number }) => void;
  onEdit?: (id: string) => void;
}) {
  const { above, masked } = corrections;
  if (l.kind === 'fill') {
    return <FillLayerView layer={correctPaint(l, above)} box={box} onSelect={() => onSelect(l.id)} />;
  }
  if (l.kind === 'photo') {
    return (
      <PhotoLayerView
        layer={l}
        box={box}
        selected={selected && !l.locked}
        zoom={zoom}
        moveRange={moveRange}
        canvas={canvas}
        corrections={above}
        maskedCorrections={masked}
        onSelect={onSelect}
        onMove={onMove}
      />
    );
  }
  if (l.kind === 'shape') {
    const clip = layerToShapeClip(l);
    return (
      <Fragment>
        <ShapeEffects layer={l} box={box} canvas={canvas} />
        <ShapeOverlay
          clip={{
            ...clip,
            // a Skia a nézetek mögé nem lát: a fölötte ható korrekció a forma színébe kerül
            ...correctPaint(clip, above),
            borderColor: clip.borderColor ? correctHex(clip.borderColor, above) : clip.borderColor,
          }}
          box={box}
          zoom={zoom}
          moveRange={moveRange}
          locked={l.locked}
          editable
          selected={selected}
          onSelect={onSelect}
          onMove={onMove}
        />
      </Fragment>
    );
  }
  // 🎚️ korrekciós réteg: nincs saját rajza, a hatása a fotók LUT-jában és a színekben van
  if (l.kind === 'adjust') {
    return null;
  }
  return (
    <TextOverlay
      clip={{ ...layerToTextClip(l), color: correctHex(l.color, above), textStyle: textEffectStyle(l, canvas) }}
      t={0}
      box={box}
      zoom={zoom}
      moveRange={moveRange}
      locked={l.locked}
      editable
      selected={selected}
      onSelect={onSelect}
      onMove={onMove}
      onEdit={onEdit}
    />
  );
});

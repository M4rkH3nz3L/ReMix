import { CanvasLayerView } from '@/components/studio/image/CanvasLayerView';
import { withGroupOpacity, withLive, MOVE_RANGE } from '@/lib/imageCanvasStage';
import { type LivePatch } from '@/lib/imageLayerClip';
import { type LayerCorrections } from '@/lib/imagePixelPipeline';
import type { ClipMask, ImageDoc, ImageLayer } from '@/types/project';

/**
 * 🖼️ A látható rétegek ALULRÓL FÖLFELÉ, a timeline-előnézet komponenseivel (render-paritás).
 * Az ecsettel szerkesztett festett réteg rejtve (az overlay rajzolja), kivéve maszk-módban.
 */
export function CanvasLayerStack({
  layers,
  doc,
  live,
  brushActive,
  brushMaskMode,
  brushLayerId,
  box,
  docCanvas,
  zoom,
  capturing,
  selectedId,
  corrections,
  stable,
  onRequestEdit,
}: {
  layers: ImageLayer[];
  doc: ImageDoc;
  live: { id: string; patch: LivePatch } | null;
  brushActive?: boolean;
  brushMaskMode?: boolean;
  brushLayerId?: string | null;
  box: { w: number; h: number };
  docCanvas: { width: number; height: number };
  zoom: number;
  capturing?: boolean;
  selectedId: string | null;
  corrections: (id: string) => LayerCorrections<ClipMask>;
  stable: {
    move: (id: string, position: { x: number; y: number }) => void;
    select: (id: string | null) => void;
    edit: (id: string) => void;
  };
  onRequestEdit?: (id: string) => void;
}) {
  return (
    <>
      {layers.map((raw0) => {
        if (brushActive && !brushMaskMode && raw0.id === brushLayerId) {
          return null;
        }
        // 🗂️ csoport-opacity: a réteg saját opacity-jére rászorozva (a worker-renderrel paritásban)
        const raw = withGroupOpacity(doc, raw0);
        return (
          <CanvasLayerView
            key={raw.id}
            layer={live?.id === raw.id ? withLive(raw, live.patch) : raw}
            box={box}
            canvas={docCanvas}
            zoom={zoom}
            moveRange={MOVE_RANGE}
            selected={!capturing && raw.id === selectedId}
            corrections={corrections(raw.id)}
            onSelect={stable.select}
            onMove={stable.move}
            onEdit={onRequestEdit ? stable.edit : undefined}
          />
        );
      })}
    </>
  );
}

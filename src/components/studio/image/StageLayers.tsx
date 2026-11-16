import { useMemo } from 'react';

import { CanvasLayerView } from '@/components/studio/image/CanvasLayerView';
import { DocGrain, DocVignette } from '@/components/studio/image/DocVignette';
import { effectiveCanvas } from '@/lib/canvasPresets';
import { resolveClipMasks } from '@/lib/imageClip';
import { effectiveLayerOpacity, visibleLayers } from '@/lib/imageDoc';
import { correctionContext, docVignetteAngles, NO_CORRECTIONS } from '@/lib/imagePixelPipeline';
import type { ClipMask, ImageDoc, ImageLayer } from '@/types/project';

const noop = () => {};
const MOVE_RANGE: [number, number] = [0, 1];

/** a dokumentum réteg-fája adott méretben, interakció nélkül (render-színpad, sablon-előnézet) */
export function StageLayers({ doc, w, h }: { doc: ImageDoc; w: number; h: number }) {
  const box = useMemo(() => ({ w, h }), [w, h]);
  const { width, height } = effectiveCanvas(doc);
  const canvas = useMemo(() => ({ width, height }), [width, height]);
  const corrections = useMemo(() => correctionContext<ClipMask>(doc), [doc]);
  // ✂️ S18: a vágómaszkok feloldva (ugyanaz a lépés, mint a vásznon és a szerver előtt)
  const clipped = useMemo(() => resolveClipMasks(doc), [doc]);
  return (
    <>
      {visibleLayers(clipped).map((raw0) => {
        // 🗂️ csoport-opacity a réteg saját opacity-jére szorozva (mint a vásznon)
        const raw =
          raw0.groupId && effectiveLayerOpacity(doc, raw0) !== (raw0.opacity ?? 1)
            ? ({ ...raw0, opacity: effectiveLayerOpacity(doc, raw0) } as ImageLayer)
            : raw0;
        return (
          <CanvasLayerView
            key={raw.id}
            layer={raw}
            box={box}
            canvas={canvas}
            zoom={1}
            moveRange={MOVE_RANGE}
            selected={false}
            corrections={corrections.get(raw.id) ?? NO_CORRECTIONS}
            onSelect={noop}
            onMove={noop}
            rendering
          />
        );
      })}
      <DocVignette angles={docVignetteAngles(doc as Parameters<typeof docVignetteAngles>[0])} box={box} />
      <DocGrain grain={doc.grain ?? 0} cell={w / (doc.width || w)} />
    </>
  );
}


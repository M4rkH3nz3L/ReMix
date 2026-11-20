import { View } from 'react-native';

import { GridOverlay } from '@/components/studio/image/GridOverlay';
import { RulersOverlay } from '@/components/studio/image/RulersOverlay';
import { effectiveCanvas } from '@/lib/canvasPresets';
import type { ImageDoc } from '@/types/project';

type Guide = NonNullable<ImageDoc['guides']>[number];

/** 📐 rács, statikus segédvonalak és a szerkeszthető vonalzók (guides-mód) a vásznon */
export function GuideOverlays({
  capturing,
  doc,
  fit,
  zoom,
  guidesActive,
  guides,
  displayGuides,
  onAddGuide,
  onMoveGuide,
  onCommitGuide,
}: {
  capturing?: boolean;
  doc: ImageDoc;
  fit: { w: number; h: number };
  zoom: number;
  guidesActive?: boolean;
  guides: Guide[];
  displayGuides: Guide[];
  onAddGuide: (axis: 'x' | 'y', pos: number) => void;
  onMoveGuide: (id: string, pos: number) => void;
  onCommitGuide: (id: string, pos: number | null) => void;
}) {
  return (
    <>
      {!capturing && doc.grid ? <GridOverlay grid={doc.grid} canvas={effectiveCanvas(doc)} box={fit} /> : null}

      {/* 📐 statikus segédvonalak — mindig látszanak, ha vannak (a snap miatt) */}
      {!capturing && !guidesActive
        ? guides.map((g) => (
            <View
              key={g.id}
              pointerEvents="none"
              style={
                g.axis === 'x'
                  ? { position: 'absolute', left: g.pos * fit.w, top: 0, bottom: 0, width: 1, backgroundColor: '#00e5ff' }
                  : { position: 'absolute', top: g.pos * fit.h, left: 0, right: 0, height: 1, backgroundColor: '#00e5ff' }
              }
            />
          ))
        : null}

      {/* 📐 vonalzók + szerkeszthető segédvonalak (guides-mód) */}
      {!capturing && guidesActive ? (
        <RulersOverlay
          box={fit}
          zoom={zoom}
          guides={displayGuides}
          onAddGuide={onAddGuide}
          onMoveGuide={onMoveGuide}
          onCommitGuide={onCommitGuide}
        />
      ) : null}
    </>
  );
}

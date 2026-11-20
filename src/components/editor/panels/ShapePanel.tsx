import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BooleanSection } from '@/components/editor/panels/shape/BooleanSection';
import { GlowOutlineSection } from '@/components/editor/panels/shape/GlowOutlineSection';
import { ShapeFillSection } from '@/components/editor/panels/shape/ShapeFillSection';
import { ShapeGeometrySections } from '@/components/editor/panels/shape/ShapeGeometrySections';
import { ShapeAlignSection, ShapeStyleSections } from '@/components/editor/panels/shape/ShapeStyleSections';
import { ShapeTrackSection } from '@/components/editor/panels/shape/ShapeTrackSection';
import { createShapeTrackActions } from '@/components/editor/panels/shape/shapeTrackActions';
import { useEditorStore } from '@/store/editorStore';
import type { ShapeClip } from '@/types/project';

/** Forma-szerkesztő (Creative Canvas): kitöltés, gradiens, keret, lekerekítés. */
export function ShapePanel({ clip }: { clip: ShapeClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const snapGrid = useEditorStore((s) => s.snapGrid);
  const setSnapGrid = useEditorStore((s) => s.setSnapGrid);
  const setPickTarget = useEditorStore((s) => s.setPickTarget);
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  const [trackBusy, setTrackBusy] = useState(false);

  const { startTrackPick } = createShapeTrackActions({ clip, t, trackBusy, setTrackBusy, setPickTarget });

  return (
    <View>
      <ShapeGeometrySections clip={clip} updateClip={updateClip} />

      <BooleanSection clip={clip} multiSelectIds={multiSelectIds} />

      <ShapeFillSection clip={clip} updateClip={updateClip} />

      <ShapeStyleSections clip={clip} updateClip={updateClip} />
      <ShapeAlignSection snapGrid={snapGrid} setSnapGrid={setSnapGrid} />

      <GlowOutlineSection clip={clip} updateClip={updateClip} />

      {/* 🎯 Objektum-követés: a forma / 3D-matrica követi a videó egy objektumát */}
      <ShapeTrackSection clip={clip} updateClip={updateClip} trackBusy={trackBusy} startTrackPick={startTrackPick} />
    </View>
  );
}

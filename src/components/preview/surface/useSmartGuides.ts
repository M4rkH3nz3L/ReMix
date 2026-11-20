import { useState } from 'react';

import { snapPosition } from '@/lib/snapping';
import { useEditorStore } from '@/store/editorStore';

import { snapContextOf } from './layerSelection';

/**
 * 🧲 Smart guides: húzás közben aktív segédvonalak (vászon-normalizált) és az
 * elengedéskori snap a többi réteg középpontjára / a rácsra.
 * A PreviewSurface-ből kiemelve — viselkedés változatlan.
 */
export function useSmartGuides() {
  // smart guides: húzás közben aktív segédvonalak (vászon-normalizált)
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });

  const snapContext = () => snapContextOf(useEditorStore.getState());

  const handleDragLive = (position: { x: number; y: number } | null) => {
    if (!position) {
      setGuides({ x: null, y: null });
      return;
    }
    const snap = snapPosition(position.x, position.y, undefined, snapContext());
    setGuides({ x: snap.guideX, y: snap.guideY });
  };

  /** elengedéskor a kitüntetett vonalakra illesztett pozíció */
  const snapped = (position: { x: number; y: number }) => {
    const snap = snapPosition(position.x, position.y, undefined, snapContext());
    return { x: snap.x, y: snap.y };
  };

  return { guides, handleDragLive, snapped };
}

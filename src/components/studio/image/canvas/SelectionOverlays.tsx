import { type Ref, Suspense, lazy } from 'react';

// 🖌️ a BrushOverlay (Skia-függő) LUSTÁN töltődik — csak a TÍPUS statikus (erased),
// a komponens csak az ecset bekapcsolásakor rántja be a @shopify/react-native-skia
// natív modult, így annak hiánya (régi dev-kliens) nem crash-eltet betöltéskor.
import { type BrushHandle } from '@/components/studio/image/BrushOverlay';
import { LassoOverlay } from '@/components/studio/image/LassoOverlay';
import { MarqueeOverlay } from '@/components/studio/image/MarqueeOverlay';
import { WandOverlay } from '@/components/studio/image/WandOverlay';
import { type BrushSettings } from '@/lib/brushEngine';
import type { CanvasPoint } from '@/lib/penPath';
import type { Point, Selection } from '@/lib/selection';
import type { SkImage } from '@shopify/react-native-skia';
import type { PhotoLayer } from '@/types/project';

// lusta Skia-komponens: csak ecset-módban töltődik be (lásd a fenti import-jegyzetet)
const SelectionAnts = lazy(() =>
  import('@/components/studio/image/SelectionAnts').then((m) => ({ default: m.SelectionAnts }))
);
const BrushOverlay = lazy(() =>
  import('@/components/studio/image/BrushOverlay').then((m) => ({ default: m.BrushOverlay }))
);

/**
 * 🪢 A kijelölő és festő eszközök overlay-ei a vásznon, rajzolási sorrendben: lasszó,
 * varázspálca, téglalap/ellipszis kijelölő, ecset, és legfelül a kijelölés körvonala.
 */
export function SelectionOverlays({
  capturing,
  fit,
  lassoActive,
  onLassoComplete,
  onLassoCancel,
  wandActive,
  onWandTap,
  marquee,
  onSelectionRing,
  brushActive,
  brushRef,
  brushSettings,
  brushMaskMode,
  brushTarget,
  brushSource,
  onBrushNeedSource,
  onBrushHistory,
  selection,
}: {
  capturing?: boolean;
  fit: { w: number; h: number };
  lassoActive?: boolean;
  onLassoComplete?: (points: CanvasPoint[]) => void;
  onLassoCancel?: () => void;
  wandActive?: boolean;
  onWandTap: (nx: number, ny: number) => void;
  marquee?: 'rect' | 'ellipse' | null;
  onSelectionRing?: (ring: Point[]) => void;
  brushActive?: boolean;
  brushRef?: Ref<BrushHandle>;
  brushSettings: BrushSettings;
  brushMaskMode?: boolean;
  brushTarget: PhotoLayer | undefined;
  brushSource?: SkImage | null;
  onBrushNeedSource?: (needed: boolean) => void;
  onBrushHistory?: (canUndo: boolean, canRedo: boolean) => void;
  selection?: Selection | null;
}) {
  return (
    <>
      {/* 🪢 lasszó-overlay (szabadkézi → zárt path) */}
      {!capturing && lassoActive && onLassoComplete && onLassoCancel ? (
        <LassoOverlay box={fit} onComplete={onLassoComplete} onCancel={onLassoCancel} />
      ) : null}

      {/* 🪄 varázspálca-overlay (fotóra koppintás → szín-szelekció) */}
      {!capturing && wandActive ? <WandOverlay box={fit} onTap={onWandTap} /> : null}

      {/* ✂️ téglalap / ellipszis kijelölő */}
      {!capturing && marquee && onSelectionRing ? <MarqueeOverlay box={fit} shape={marquee} onRing={onSelectionRing} /> : null}

      {/* 🖌️ ecset-overlay (Skia raszter-festés) — lustán, Suspense-szel */}
      {!capturing && brushActive ? (
        <Suspense fallback={null}>
          <BrushOverlay ref={brushRef} box={fit} settings={brushSettings} baseUri={brushMaskMode ? brushTarget?.mask?.image : brushTarget?.uri} maskMode={brushMaskMode} maskSeed={brushMaskMode ? brushTarget?.mask : null} source={brushSource} onNeedSource={onBrushNeedSource} onHistory={onBrushHistory} clip={selection} />
        </Suspense>
      ) : null}

      {/* ✂️ a kijelölés körvonala minden eszköz fölött látszik; lustán, mint az ecset */}
      {!capturing && selection ? (
        <Suspense fallback={null}>
          <SelectionAnts selection={selection} box={fit} />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * 🎨 A „look" tint-közelítések (szűrő, lighting, képjavítás, grade-sáv) — a
 * pontos korrekció a renderben készül. A `lookGeom` a before/after slider
 * jobb oldalára szorítja őket (slider nélkül teljes vászon).
 * A PreviewSurface-ből kiemelve — sorrend és kinézet változatlan.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { gradeTint } from '@/constants/grades';
import { adjustTintLayers } from '@/lib/adjustPreview';
import type { AdjustClip, ClipAdjust, LightingPreset } from '@/types/project';

import { adjustClipStrength, LIGHTING_TINTS } from './layerSelection';

/** a look-rétegek geometriája (slider-szorítás vagy teljes vászon) */
type LookGeom = StyleProp<ViewStyle>;

/** a szűrő-preset overlay-színe */
export function FilterLookLayer({
  lookGeom,
  color,
  opacity,
}: {
  lookGeom: LookGeom;
  color: string;
  opacity: number;
}) {
  return (
    <View
      pointerEvents="none"
      style={[
        lookGeom,
        { backgroundColor: color, opacity },
      ]}
    />
  );
}

/** 💡 lighting-közelítés: hangulat-tint (a split-tone a renderben) */
export function LightingTintLayer({
  lookGeom,
  comparingOriginal,
  lighting,
}: {
  lookGeom: LookGeom;
  comparingOriginal: boolean;
  lighting: LightingPreset | undefined;
}) {
  if (comparingOriginal) {
    return null;
  }
  const tint = lighting ? LIGHTING_TINTS[lighting] : null;
  return tint ? (
    <View
      pointerEvents="none"
      style={[
        lookGeom,
        { backgroundColor: tint.color, opacity: tint.opacity },
      ]}
    />
  ) : null;
}

/**
 * képjavítás-közelítés (Creative Canvas): fényerő/hőmérséklet/
 * szaturáció rétegekkel — a pontos korrekció a renderben készül
 */
export function AdjustTintLayers({
  lookGeom,
  comparingOriginal,
  adjust,
}: {
  lookGeom: LookGeom;
  comparingOriginal: boolean;
  adjust: ClipAdjust | undefined;
}) {
  if (!adjust || comparingOriginal) {
    return null;
  }
  return (
    <>
      {adjustTintLayers(adjust).map((l, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[
            lookGeom,
            { backgroundColor: l.color, opacity: l.opacity },
          ]}
        />
      ))}
    </>
  );
}

/**
 * 🎨 grade-réteg-közelítés: az adjust-sáv aktív klipjei a TELJES
 * kompozitot tintelik — előbb a filmes preset (grade), majd a kézi
 * adjust (a valódi eq/colorbalance/vignette a renderben)
 */
export function AdjustTrackTintLayers({
  lookGeom,
  clips,
  playhead,
}: {
  lookGeom: LookGeom;
  clips: AdjustClip[];
  playhead: number;
}) {
  return (
    <>
      {clips.flatMap((clip) => {
        // effektív erősség: strength × fade-burkológörbe (a klip elején/végén)
        const eff = adjustClipStrength(clip, playhead);
        return [...gradeTint(clip.grade), ...adjustTintLayers(clip.adjust)].map((l, i) => (
          <View
            key={`${clip.id}-${i}`}
            pointerEvents="none"
            style={[
              lookGeom,
              { backgroundColor: l.color, opacity: l.opacity * eff },
            ]}
          />
        ));
      })}
    </>
  );
}

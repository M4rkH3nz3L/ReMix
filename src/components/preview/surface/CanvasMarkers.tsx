/**
 * 🧭 A vászon jelölő- és segédrétegei (pointerEvents none): maszk- és
 * arc-elmosás-közelítés, fekete áttűnés, fókusz-scrim, smart guide vonalak és
 * az élő rajz-vonal. A PreviewSurface-ből kiemelve — kinézet változatlan.
 */
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

import { palette } from '@/constants/editor';
import { polylinePoints } from '@/lib/draw';
import type { EditorState } from '@/store/editorState';
import type { ClipMask, FaceBlur } from '@/types/project';

import { faceBlurRect, maskShadeGeometry } from './canvasMath';

/**
 * maszk-közelítés (P0‑10): körvonal + a takart terület sötétítése —
 * a valódi lágy szélű alfa-kivágás a renderben készül
 */
export function MaskShade({ mask, boxW, boxH }: { mask: ClipMask | undefined; boxW: number; boxH: number }) {
  if (!mask) {
    return null;
  }
  const { mw, mh, left, top, radius } = maskShadeGeometry(mask, boxW, boxH);
  const shade = '#000000a8';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {mask.invert ? (
        <View
          style={{
            position: 'absolute',
            left,
            top,
            width: mw,
            height: mh,
            borderRadius: radius,
            backgroundColor: shade,
          }}
        />
      ) : (
        <>
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, height: Math.max(0, top), backgroundColor: shade }} />
          <View style={{ position: 'absolute', left: 0, top: top + mh, right: 0, bottom: 0, backgroundColor: shade }} />
          <View style={{ position: 'absolute', left: 0, top, width: Math.max(0, left), height: mh, backgroundColor: shade }} />
          <View style={{ position: 'absolute', left: left + mw, top, right: 0, height: mh, backgroundColor: shade }} />
        </>
      )}
      <View
        style={{
          position: 'absolute',
          left,
          top,
          width: mw,
          height: mh,
          borderRadius: radius,
          borderWidth: 1,
          borderColor: palette.accent,
          borderStyle: 'dashed',
        }}
      />
    </View>
  );
}

/** 🙈 arc-elmosás jelölése (a valódi blur a renderben ég be) */
export function FaceBlurMarker({ fb, boxW, boxH }: { fb: FaceBlur | undefined; boxW: number; boxH: number }) {
  return fb ? (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        ...faceBlurRect(fb, boxW, boxH),
        backgroundColor: '#0b0f1acc',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: palette.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: palette.text, fontSize: 11, fontWeight: '700' }}>
        🙈 elmosás
      </Text>
    </View>
  ) : null;
}

/** fekete scrim adott átlátszósággal (áttűnés feketébe / fókusz mód) */
export function BlackScrim({ opacity }: { opacity: number }) {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity }]}
    />
  );
}

/** smart guides: aktív segédvonalak húzás közben */
export function SmartGuideLines({
  guides,
  boxW,
  boxH,
}: {
  guides: { x: number | null; y: number | null };
  boxW: number;
  boxH: number;
}) {
  return (
    <>
      {guides.x !== null ? (
        <View
          pointerEvents="none"
          style={[styles.guideV, { left: guides.x * boxW - 0.5 }]}
        />
      ) : null}
      {guides.y !== null ? (
        <View
          pointerEvents="none"
          style={[styles.guideH, { top: guides.y * boxH - 0.5 }]}
        />
      ) : null}
    </>
  );
}

/** ✏️ a húzás közben rajzolódó vonal (forma VAGY szabadkézi maszk) */
export function StrokePreview({
  strokeLive,
  boxW,
  boxH,
  drawBrush,
  drawMaskMode,
}: {
  strokeLive: { x: number; y: number }[];
  boxW: number;
  boxH: number;
  drawBrush: EditorState['drawBrush'];
  drawMaskMode: boolean;
}) {
  return (
    <Svg
      pointerEvents="none"
      width={boxW}
      height={boxH}
      style={StyleSheet.absoluteFill}
    >
      <Polyline
        points={polylinePoints(strokeLive, boxW, boxH)}
        fill={drawMaskMode ? `${palette.accent}22` : 'none'}
        stroke={drawBrush?.color ?? palette.accent}
        strokeWidth={Math.max(1, ((drawBrush?.width ?? 2) / 100) * boxH)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={drawBrush?.style === 'highlighter' ? 0.42 : 1}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  guideV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: palette.accent,
    opacity: 0.9,
  },
  guideH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: palette.accent,
    opacity: 0.9,
  },
});

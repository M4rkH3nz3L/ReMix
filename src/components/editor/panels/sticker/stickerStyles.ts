import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a matrica-panel és szekcióinak stílusai (REFACTOR: a StickerPanel.tsx-ből) */
export const styles = StyleSheet.create({
  shapeRow: {
    flexDirection: 'row',
    gap: 14,
  },
  shapeRow3d: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  preview3d: {
    width: 52,
    height: 52,
  },
  shapeCell: {
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 10,
    backgroundColor: palette.surfaceHigh,
    minWidth: 84,
  },
  shapeRect: {
    width: 40,
    height: 26,
    borderRadius: 6,
    backgroundColor: palette.accent,
  },
  shapeEllipse: {
    width: 40,
    height: 26,
    borderRadius: 999,
    backgroundColor: palette.accent2,
  },
  shapeLine: {
    width: 44,
    height: 3,
    borderRadius: 2,
    marginVertical: 11.5,
    backgroundColor: '#ffffff',
  },
  shapeLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  shapeGlyph: {
    fontSize: 24,
    lineHeight: 26,
    color: palette.accent2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cell: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 22,
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: palette.border,
  },
  swatchActive: {
    borderColor: palette.text,
    borderWidth: 3,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});

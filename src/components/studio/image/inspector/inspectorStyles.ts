import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a réteg-inspektor szekcióinak közös stílusai (chip-sor, szekció-címke, tipp-szöveg) */
export const inspectorStyles = StyleSheet.create({
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  sectionLabel: { color: palette.textDim, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  hintText: { color: palette.textDim, fontSize: 11, fontStyle: 'italic' },
});

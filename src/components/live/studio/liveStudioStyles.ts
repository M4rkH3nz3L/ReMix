import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** A Live Studio több részében közös stílusok (REFACTOR: a src/app/live/studio/[id].tsx-ből). */
export const shared = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
  sectionLabel: { color: palette.textDim, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addSourceBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addSourceText: { color: palette.accent, fontSize: 13, fontWeight: '800' },
  hint: { color: palette.textDim, fontSize: 12, lineHeight: 17 },
  startBtnDisabled: { opacity: 0.6 },
});

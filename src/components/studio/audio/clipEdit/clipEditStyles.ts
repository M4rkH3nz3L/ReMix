import { StyleSheet } from 'react-native';

import { palette } from '@/constants/editor';

/** a klip-szerkesztő lap szekcióinak közös stílusai (címke, chip-sor, tipp, elválasztó, hangolás-doboz) */
export const clipEditStyles = StyleSheet.create({
  tuneBox: { marginBottom: 12, gap: 6 },
  tuneRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tuneBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: palette.accent, borderRadius: 10, paddingVertical: 11 },
  tuneBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  tuneReset: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  tuneResetText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  divider: { height: 1, backgroundColor: palette.border, marginVertical: 12 },
  hint: { color: palette.textDim, fontSize: 11, lineHeight: 16, marginTop: 10 },
  autoLabel: { color: palette.textDim, fontSize: 12, fontWeight: '600', marginTop: 12, marginBottom: 4 },
  autoChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  autoChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: palette.border },
  autoChipActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  autoChipText: { color: palette.textDim, fontSize: 12, fontWeight: '600' },
  autoChipTextActive: { color: '#fff' },
});

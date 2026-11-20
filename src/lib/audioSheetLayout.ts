import { layoutBudget, type Detent } from '@/lib/panelLayout';
import { AUDIO_SHEET_SPECS, type AudioSheetId } from '@/lib/panelSpecs';

/**
 * 📐 A Hang Stúdió inline lapjának elrendezése (MOBILE-UI §6.7, §7) — tiszta számítás a törzs
 * állapotából: melyik inline lap nyitott, milyen detenttel, és a lap-keret (detentek, dokkolás).
 */

/** a nyitott inline lap (a többi workspace vagy modális — azok nem nyomják össze a sávokat) */
export function inlineSheetOf({
  editing,
  hasSelClip,
  mastering,
  mixerOpen,
}: {
  editing: boolean;
  hasSelClip: boolean;
  mastering: boolean;
  mixerOpen: boolean;
}): AudioSheetId | null {
  return editing && hasSelClip ? 'clipEdit' : mastering ? 'master' : mixerOpen ? 'mixer' : null;
}

/** a nyitott inline lap detentje: a laponként megjegyzett, különben a regiszter kezdő értéke ('half') */
export function inlineDetentOf(inlineSheet: AudioSheetId | null, detentById: Partial<Record<AudioSheetId, Detent>>): Detent {
  return inlineSheet
    ? (detentById[inlineSheet] ?? AUDIO_SHEET_SPECS[inlineSheet].initialDetent ?? 'half')
    : 'peek';
}

/** a lap-keret: amíg a gyökér nincs lemérve (`rootH` 0), null */
export function sheetFrameOf({
  rootH,
  topBarH,
  transportH,
  inlineDetent,
  docked,
  onDetentChange,
}: {
  rootH: number;
  topBarH: number;
  transportH: number | undefined;
  inlineDetent: Detent;
  docked: boolean;
  onDetentChange: (d: Detent) => void;
}): {
  detents: Record<Detent, number>;
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  docked: boolean;
  workspaceTop?: number;
} | null {
  return rootH > 0
    ? {
        detents: layoutBudget({
          bodyHeight: rootH - topBarH,
          tier: 'sheet',
          detent: inlineDetent,
          hasTimeline: false,
          transportHeight: transportH,
        }).detents,
        detent: inlineDetent,
        onDetentChange,
        docked,
        // 🎹 S14: iPad fekvőben a hangszer-szerkesztő a felület alsó ~58 %-án, a sávok fölötte látszanak
        ...(docked ? { workspaceTop: topBarH + Math.round((rootH - topBarH) * 0.42) } : {}),
      }
    : null;
}

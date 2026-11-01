import type { SizeClass } from '@/constants/layout';

/**
 * 🧭 A Kép Stúdió munkaterületének elrendezése (pure): bal oldalt a szerszámsín, középen a
 * vászon az eszköz-beállításokkal, jobb oldalt a rétegek. A sín mindig a sorban van, a
 * rétegpanel telefonon a vászon FÖLÉ nyílik (a keskeny vászon nem nyomódik össze), tableten
 * a sorba épül. A `mode` a rétegpanelre vonatkozik.
 */
export type WorkspaceMode = 'overlay' | 'inline';

export interface WorkspaceLayout {
  mode: WorkspaceMode;
  railWidth: number;
  panelWidth: number;
}

export function workspaceLayout(sizeClass: SizeClass, width: number): WorkspaceLayout {
  if (sizeClass === 'compact') {
    return { mode: 'overlay', railWidth: 68, panelWidth: Math.min(264, Math.round(width * 0.66)) };
  }
  return sizeClass === 'expanded'
    ? { mode: 'inline', railWidth: 76, panelWidth: 340 }
    : { mode: 'inline', railWidth: 72, panelWidth: 300 };
}

/** Alapállapot: a sín nyitva; a rétegpanel csak ott, ahol nem takar a vászonból. */
export function panelDefaults(mode: WorkspaceMode): { rail: boolean; layers: boolean } {
  return { rail: true, layers: mode === 'inline' };
}

/** A felhasználó utolsó választása eszköz-típusonként; ha nincs, az alapállapot. */
export function panelState(
  mode: WorkspaceMode,
  saved: Partial<Record<WorkspaceMode, { rail?: boolean; layers?: boolean }>>
): { rail: boolean; layers: boolean } {
  return { ...panelDefaults(mode), ...saved[mode] };
}

/** Van-e még görgethető tartalom a sín alján? (1 pontnyi tűréssel a tört eltolások miatt) */
export function railHasMore(contentHeight: number, viewHeight: number, offset: number): boolean {
  return contentHeight - viewHeight - offset > 1;
}

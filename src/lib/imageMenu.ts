import type { ImageLayer } from '@/types/project';

/**
 * 🧭 A Kép Stúdió menüszerkezete — egy helyen, adatként. A szabály egyszerű, és egy funkció
 * csak egy helyen él:
 *  • bal sín = SZERSZÁMOK: amivel új dolog születik a vásznon (hozzáadás, rajz, kijelölés, vászon);
 *  • alsó sáv = a KIJELÖLT elem műveletei; a sorrend: beállítás → elrendezés → másolás,
 *    a törlés külön, mindig látható helyen;
 *  • jobb panel = a rétegek szerkezete (sorrend, láthatóság, zárolás, egyesítés).
 */
export type RailTool =
  | 'photo'
  | 'text'
  | 'shape'
  | 'addFill'
  | 'addAdjust'
  | 'import'
  | 'pen'
  | 'brush'
  | 'lasso'
  | 'wand'
  | 'crop'
  | 'guides';

export type LayerAction =
  | 'style'
  | 'adjust'
  | 'develop'
  | 'fx'
  | 'pattern'
  | 'editPath'
  | 'boolean'
  | 'align'
  | 'rotate'
  | 'flipH'
  | 'flipV'
  | 'forward'
  | 'back'
  | 'duplicate'
  | 'unlock';

export type ImportAction = 'svg' | 'psd' | 'pdf' | 'source';

export type ToolKey = RailTool | LayerAction | ImportAction | 'delete';

export const RAIL_GROUPS: { labelKey: string; tools: RailTool[] }[] = [
  { labelKey: 'studio.imageGroups.add', tools: ['photo', 'text', 'shape', 'addFill', 'addAdjust', 'import'] },
  { labelKey: 'studio.imageGroups.draw', tools: ['pen', 'brush'] },
  { labelKey: 'studio.imageGroups.select', tools: ['lasso', 'wand'] },
  { labelKey: 'studio.imageGroups.canvas', tools: ['crop', 'guides'] },
];

export const TOOL_ICONS: Record<RailTool | LayerAction | 'delete', string> = {
  photo: 'image-outline',
  text: 'text-outline',
  shape: 'shapes-outline',
  addFill: 'color-fill-outline',
  addAdjust: 'contrast-outline',
  import: 'folder-open-outline',
  pen: 'pencil-outline',
  brush: 'brush-outline',
  lasso: 'ellipse-outline',
  wand: 'color-wand-outline',
  crop: 'crop-outline',
  guides: 'grid-outline',
  style: 'options-outline',
  adjust: 'sunny-outline',
  develop: 'aperture-outline',
  fx: 'sparkles-outline',
  pattern: 'apps-outline',
  editPath: 'git-network-outline',
  boolean: 'git-merge-outline',
  align: 'magnet-outline',
  rotate: 'refresh-outline',
  flipH: 'swap-horizontal-outline',
  flipV: 'swap-vertical-outline',
  forward: 'chevron-up-outline',
  back: 'chevron-down-outline',
  duplicate: 'copy-outline',
  unlock: 'lock-open-outline',
  delete: 'trash-outline',
};

/** a feliratok kulcsa (a `studio.imageTools` alatt) */
export function toolLabelKey(key: ToolKey): string {
  return `studio.imageTools.${key}`;
}

export interface SelectionMenu {
  actions: LayerAction[];
  /** a törlés külön gomb: a sáv jobb szélén mindig látszik */
  canDelete: boolean;
}

/** A kijelölt elem műveletei a fajtája szerint. Ami nem használható, az nincs a listában. */
export function selectionMenu(layer: ImageLayer, ctx: { canAlign: boolean; canBoolean: boolean }): SelectionMenu {
  if (layer.locked) {
    return { actions: ['unlock', 'duplicate'], canDelete: false };
  }
  const placed: LayerAction[] = [...(ctx.canAlign ? (['align'] as const) : []), 'rotate', 'flipH', 'flipV'];
  const order: LayerAction[] = ['forward', 'back'];
  switch (layer.kind) {
    case 'photo':
      return { actions: ['adjust', 'develop', 'style', ...placed, ...order, 'duplicate'], canDelete: true };
    case 'shape': {
      const path: LayerAction[] = layer.shape === 'path' && (layer.points?.length ?? 0) >= 2 ? ['editPath'] : [];
      const bool: LayerAction[] = ctx.canBoolean ? ['boolean'] : [];
      return { actions: ['style', 'fx', 'pattern', ...path, ...bool, ...placed, ...order, 'duplicate'], canDelete: true };
    }
    case 'text':
      return { actions: ['style', ...placed, ...order, 'duplicate'], canDelete: true };
    default:
      // háttér és korrekciós réteg: nem pozícionált, csak a beállításai + a sorrendje van
      return { actions: ['style', ...order, 'duplicate'], canDelete: true };
  }
}

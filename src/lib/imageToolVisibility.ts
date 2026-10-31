import type { ImageLayer } from '@/types/project';

/** Az eszköztár kontextusa: mi van kijelölve, és mit enged a dokumentum. */
export interface ToolContext {
  selected: ImageLayer | null;
  canAlign: boolean;
  canBoolean: boolean;
}

/**
 * Az eszköz látszik-e. Ami a jelenlegi kijelöléssel nem használható, az nem jelenik meg —
 * nem kell rákoppintani, hogy egy ablak közölje, miért nem megy.
 */
export function toolVisible(key: string, { selected, canAlign, canBoolean }: ToolContext): boolean {
  switch (key) {
    case 'style':
    case 'delete':
    case 'duplicate':
    case 'forward':
    case 'back':
      return !!selected;
    case 'rotate':
    case 'flipH':
    case 'flipV':
      return !!selected && selected.kind !== 'fill' && selected.kind !== 'adjust';
    case 'adjust':
    case 'develop':
      return selected?.kind === 'photo';
    case 'fx':
    case 'pattern':
      return selected?.kind === 'shape';
    case 'align':
      return canAlign;
    case 'boolean':
      return canBoolean;
    default:
      return true;
  }
}

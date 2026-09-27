/**
 * 🛒 Marketplace 2.0 (E-Market — MASTER §24) — a Shop ([shop.ts](./shop)) bővített,
 * ELADHATÓ item-típus katalógusa: nem csak template/LUT/SFX/font/preset, hanem
 * music/sample-pack/MIDI/instrument/3D/graphics/photo-preset/design-system/
 * workflow/AI-agent/AI-persona → creator→creator economy. Tiszta katalógus-mag.
 */

export type MarketItemKind =
  | 'template'
  | 'lut'
  | 'sfx'
  | 'font'
  | 'preset'
  | 'music'
  | 'sample-pack'
  | 'midi'
  | 'instrument'
  | 'model3d'
  | 'graphic'
  | 'photo-preset'
  | 'design-system'
  | 'workflow'
  | 'ai-agent'
  | 'ai-persona';

export type MarketCategory = 'visual' | 'audio' | 'design' | 'ai' | 'workflow';

export interface MarketItemMeta {
  id: MarketItemKind;
  label: string;
  icon: string;
  category: MarketCategory;
  /** a Shop v1-ben már létező típus (a többi az E-Market 2.0 bővítés) */
  legacy: boolean;
}

export const MARKET_ITEM_KINDS: Record<MarketItemKind, MarketItemMeta> = {
  template: { id: 'template', label: 'Template', icon: 'albums', category: 'visual', legacy: true },
  lut: { id: 'lut', label: 'LUT', icon: 'color-filter', category: 'visual', legacy: true },
  sfx: { id: 'sfx', label: 'SFX', icon: 'volume-high', category: 'audio', legacy: true },
  font: { id: 'font', label: 'Font', icon: 'text', category: 'design', legacy: true },
  preset: { id: 'preset', label: 'Preset', icon: 'options', category: 'visual', legacy: true },
  music: { id: 'music', label: 'Music', icon: 'musical-notes', category: 'audio', legacy: false },
  'sample-pack': { id: 'sample-pack', label: 'Sample Pack', icon: 'grid', category: 'audio', legacy: false },
  midi: { id: 'midi', label: 'MIDI', icon: 'pulse', category: 'audio', legacy: false },
  instrument: { id: 'instrument', label: 'Instrument', icon: 'piano', category: 'audio', legacy: false },
  model3d: { id: 'model3d', label: '3D Asset', icon: 'cube', category: 'visual', legacy: false },
  graphic: { id: 'graphic', label: 'Graphic', icon: 'color-palette', category: 'design', legacy: false },
  'photo-preset': { id: 'photo-preset', label: 'Photo Preset', icon: 'image', category: 'visual', legacy: false },
  'design-system': { id: 'design-system', label: 'Design System', icon: 'layers', category: 'design', legacy: false },
  workflow: { id: 'workflow', label: 'Workflow', icon: 'git-network', category: 'workflow', legacy: false },
  'ai-agent': { id: 'ai-agent', label: 'AI Agent', icon: 'sparkles', category: 'ai', legacy: false },
  'ai-persona': { id: 'ai-persona', label: 'AI Persona', icon: 'happy', category: 'ai', legacy: false },
};

export const ALL_MARKET_KINDS: MarketItemKind[] = Object.keys(MARKET_ITEM_KINDS) as MarketItemKind[];

export function marketItemMeta(id: MarketItemKind): MarketItemMeta {
  return MARKET_ITEM_KINDS[id];
}

/** Az E-Market 2.0 által ÚJONNAN hozott (nem-legacy) eladható típusok. */
export function newMarketKinds(): MarketItemKind[] {
  return ALL_MARKET_KINDS.filter((k) => !MARKET_ITEM_KINDS[k].legacy);
}

export function marketKindsByCategory(category: MarketCategory): MarketItemKind[] {
  return ALL_MARKET_KINDS.filter((k) => MARKET_ITEM_KINDS[k].category === category);
}

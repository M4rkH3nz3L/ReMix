import type { AiProviderKind } from '@/lib/aiProviders';

/** 🤖 A provider-szerkesztő chip-sorának választható típusai (fix sorrend). */
export const PROVIDER_KINDS: AiProviderKind[] = ['openai', 'anthropic', 'ollama', 'custom'];

/** 🏷️ A provider-típusok megjelenített címkéi (nem lokalizált márkanevek). */
export const PROVIDER_LABEL: Record<AiProviderKind, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
  custom: 'Custom',
};

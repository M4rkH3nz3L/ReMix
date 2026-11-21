import { AI_PROVIDER_KINDS, type AiProvider, type AiProviderKind } from '@/lib/aiProviders';
import { DEFAULT_AVATAR, type AvatarConfig } from '@/lib/avatar';

/** 🤖 Az AI-provider szerkesztő-űrlapja (új = `id: null`, egyébként meglévő). */
export interface ProviderForm {
  id: string | null; // null = új
  label: string;
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  personaName: string;
  personaEmoji: string;
  personaStory: string;
  capabilities: string[];
  avatar: AvatarConfig;
}

export const EMPTY_FORM: ProviderForm = {
  id: null,
  label: '',
  provider: 'openai',
  baseUrl: '',
  model: '',
  apiKey: '',
  personaName: '',
  personaEmoji: '',
  personaStory: '',
  capabilities: [],
  avatar: DEFAULT_AVATAR,
};

/** egy meglévő provider → szerkesztő-űrlap (REFACTOR: a useProfile `openEdit`-jéből) */
export function providerFormFromProvider(p: AiProvider): ProviderForm {
  return {
    id: p.id,
    label: p.label,
    provider: p.provider,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: p.apiKey,
    personaName: p.personaName ?? '',
    personaEmoji: p.personaEmoji ?? '',
    personaStory: p.personaStory ?? '',
    capabilities: p.capabilities ?? [],
    avatar: p.avatar ?? DEFAULT_AVATAR,
  };
}

/** az űrlap fajta-metája + érvényessége (REFACTOR: a useProfile-ból) */
export function providerFormValidity(form: ProviderForm) {
  const kindMeta = AI_PROVIDER_KINDS[form.provider];
  const formValid =
    form.label.trim().length > 0 &&
    form.model.trim().length > 0 &&
    (form.provider !== 'custom' || form.baseUrl.trim().length > 0) &&
    (!kindMeta.needsKey || form.apiKey.trim().length > 0);
  return { kindMeta, formValid };
}

/** az űrlapból a mentendő provider-adat (REFACTOR: a useProfile `saveProviderAsync`-jéből) */
export function providerInputFromForm(form: ProviderForm) {
  return {
    label: form.label,
    provider: form.provider,
    baseUrl: form.baseUrl,
    model: form.model,
    apiKey: form.apiKey,
    // EGY név: a persona neve = a modell neve (a „Név" mező), így a szerkesztő
    // asszisztens-köszönései is ugyanazt a nevet használják
    personaName: form.label,
    personaEmoji: form.personaEmoji,
    personaStory: form.personaStory,
    capabilities: form.capabilities,
    avatar: form.avatar,
  };
}

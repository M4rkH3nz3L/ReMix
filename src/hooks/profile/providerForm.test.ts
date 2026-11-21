import type { AiProvider } from '@/lib/aiProviders';
import { DEFAULT_AVATAR } from '@/lib/avatar';
import {
  EMPTY_FORM,
  type ProviderForm,
  providerFormFromProvider,
  providerFormValidity,
  providerInputFromForm,
} from '@/hooks/profile/providerForm';

/** 🤖 Az AI-provider űrlap pure magja (REFACTOR: a useProfile.ts-ből kiemelve) — a mai viselkedés rögzítve. */

const form = (over: Partial<ProviderForm> = {}): ProviderForm => ({
  ...EMPTY_FORM,
  label: 'Modell',
  model: 'gpt-4o',
  apiKey: 'sk',
  ...over,
});

describe('EMPTY_FORM', () => {
  it('az új űrlap alapértékei (openai, üres mezők, alap-avatar)', () => {
    expect(EMPTY_FORM).toEqual({
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
    });
    expect(EMPTY_FORM.avatar).toBe(DEFAULT_AVATAR);
  });
});

describe('providerFormFromProvider — meglévő provider szerkesztése', () => {
  const base: AiProvider = {
    id: 'p1',
    label: 'Saját',
    provider: 'anthropic',
    baseUrl: 'https://x',
    model: 'm',
    apiKey: 'k',
    isDefault: true,
  };
  it('a hiányzó persona-mezők üres stringek, a képességek üres tömb, az avatar az alap', () => {
    expect(providerFormFromProvider(base)).toEqual({
      id: 'p1',
      label: 'Saját',
      provider: 'anthropic',
      baseUrl: 'https://x',
      model: 'm',
      apiKey: 'k',
      personaName: '',
      personaEmoji: '',
      personaStory: '',
      capabilities: [],
      avatar: DEFAULT_AVATAR,
    });
  });
  it('a meglévő persona-mezők és a képesség-tömb identitása megmarad; az isDefault nem kerül át', () => {
    const caps = ['caption'];
    const avatar = { ...DEFAULT_AVATAR };
    const f = providerFormFromProvider({
      ...base,
      personaName: 'N',
      personaEmoji: '🙂',
      personaStory: 'S',
      capabilities: caps,
      avatar,
    });
    expect(f.personaName).toBe('N');
    expect(f.personaEmoji).toBe('🙂');
    expect(f.personaStory).toBe('S');
    expect(f.capabilities).toBe(caps);
    expect(f.avatar).toBe(avatar);
    expect('isDefault' in f).toBe(false);
  });
});

describe('providerFormValidity — mentés engedélyezése', () => {
  it('kitöltött openai-űrlap érvényes, a kindMeta a fajta leírója', () => {
    const r = providerFormValidity(form());
    expect(r.formValid).toBe(true);
    expect(r.kindMeta.needsKey).toBe(true);
  });
  it.each([
    ['üres (csak szóköz) név', { label: '  ' }],
    ['üres modell', { model: ' ' }],
    ['kulcsot kérő fajta kulcs nélkül', { apiKey: ' ' }],
    ['custom fajta base URL nélkül', { provider: 'custom' as const, baseUrl: '  ' }],
  ])('%s → érvénytelen', (_l, over) => {
    expect(providerFormValidity(form(over)).formValid).toBe(false);
  });
  it('custom fajta base URL-lel érvényes', () => {
    expect(providerFormValidity(form({ provider: 'custom', baseUrl: 'http://x' })).formValid).toBe(true);
  });
});

describe('providerInputFromForm — a mentendő adat', () => {
  it('a persona neve MINDIG a modell neve (label); az id nem kerül bele', () => {
    const f = form({ id: 'p9', personaName: 'Más', personaEmoji: 'e', personaStory: 's', capabilities: ['a'] });
    const input = providerInputFromForm(f);
    expect(input).toEqual({
      label: 'Modell',
      provider: 'openai',
      baseUrl: '',
      model: 'gpt-4o',
      apiKey: 'sk',
      personaName: 'Modell',
      personaEmoji: 'e',
      personaStory: 's',
      capabilities: ['a'],
      avatar: DEFAULT_AVATAR,
    });
    expect(input.capabilities).toBe(f.capabilities);
  });
  it('a mezőket nem trimmeli', () => {
    expect(providerInputFromForm(form({ label: ' A ', model: ' m ' }))).toMatchObject({ label: ' A ', model: ' m ', personaName: ' A ' });
  });
});

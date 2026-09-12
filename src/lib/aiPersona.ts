import { t as tr } from 'i18next';

/**
 * 👤 AI-persona (karakter) generátor — a BYOK-modell személyesebb arcot kap:
 * név + emoji-avatar + rövid, meleg sztori a választott képességek köré. Így a
 * user meghittebb hangulatban használhatja (mintha a saját asszisztensét
 * szólítaná). Tisztán kliens-oldali, determinisztikus pool-okból; a szöveg az
 * aktuális app-nyelven készül (i18n-sablonokból).
 */

/** „mire való" — a képességek (a nevük + avatar-emojijuk i18n/itt). */
export const AI_CAPABILITIES = [
  { id: 'text', emoji: '💬' },
  { id: 'image', emoji: '🎨' },
  { id: 'video', emoji: '🎬' },
  { id: 'audio', emoji: '🎧' },
  { id: 'captions', emoji: '📝' },
  { id: 'music', emoji: '🎵' },
  { id: 'ideas', emoji: '💡' },
] as const;

export type CapabilityId = (typeof AI_CAPABILITIES)[number]['id'];

/** semleges, barátságos nevek (nyelv-független) */
const NAMES = [
  'Luna', 'Nova', 'Echo', 'Pixel', 'Iris', 'Milo', 'Juno', 'Aria', 'Rio', 'Vera',
  'Kai', 'Zola', 'Enzo', 'Mira', 'Sol', 'Nyx', 'Remi', 'Suki', 'Bo', 'Ada',
];
const EMOJIS = ['🌙', '✨', '🤖', '🦊', '🐨', '🌟', '💫', '🪄', '🚀', '🧠', '🐧', '🦉'];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface Persona {
  name: string;
  emoji: string;
  story: string;
}

/**
 * Karakter generálása a választott képességek köré. Ha nincs képesség megadva,
 * általános „kreatív társ" sztori készül.
 */
export function generatePersona(capabilities: string[] = []): Persona {
  const name = pick(NAMES);
  // az avatar az első képesség emojija, vagy egy véletlen barátságos emoji
  const capMeta = AI_CAPABILITIES.find((c) => c.id === capabilities[0]);
  const emoji = capMeta?.emoji ?? pick(EMOJIS);

  const purpose =
    capabilities.length > 0
      ? capabilities.map((c) => tr('aiPersona.cap_' + c)).join(', ')
      : tr('aiPersona.capGeneric');
  const flavor = tr('aiPersona.flavor' + (1 + Math.floor(Math.random() * 3)));
  const story = tr('aiPersona.story', { name, purpose, flavor });

  return { name, emoji, story };
}

/** Rövid, megjeleníthető címke a personából (emoji + név), vagy null. */
export function personaLabel(p: {
  personaEmoji?: string;
  personaName?: string;
}): string | null {
  if (!p.personaName) {
    return null;
  }
  return `${p.personaEmoji ?? '🤖'} ${p.personaName}`;
}

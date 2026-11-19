import { t as tr } from 'i18next';
import { Alert } from 'react-native';

/** 🛑 a szerveres render effekt-szintű visszaesései (server/render.js `noteDegraded`) */
export const DEGRADED_KEYS = ['textMotion', 'pathAnim', 'mask', 'particles'] as const;
export type DegradedKey = (typeof DEGRADED_KEYS)[number];

/** a job-eredmény ismert visszaesései, a szerver sorrendjében (ismeretlen kulcs kimarad) */
export function knownDegraded(list: unknown): DegradedKey[] {
  if (!Array.isArray(list)) return [];
  return list.filter((k): k is DegradedKey => (DEGRADED_KEYS as readonly string[]).includes(k as string));
}

/** a felhasználónak szóló szöveg: mi lett egyszerűbb a kész videóban; üres lista → null */
export function degradedMessage(list: unknown): { title: string; body: string } | null {
  const keys = knownDegraded(list);
  if (keys.length === 0) return null;
  const lines = keys.map((k) => `• ${tr(`lib.render.degraded.${k}`)}`);
  return {
    title: tr('lib.render.degraded.title'),
    body: `${tr('lib.render.degraded.body')}\n${lines.join('\n')}\n\n${tr('lib.render.degraded.retry')}`,
  };
}

/** a kész videó után jelezzük (nem tűnik el magától, mint egy toast) */
export function reportRenderDegraded(list: unknown): void {
  const msg = degradedMessage(list);
  if (msg) Alert.alert(msg.title, msg.body);
}

import { makeId } from '@/lib/id';
import { clamp } from '@/lib/time';
import type { TextClip, TextStylePreset } from '@/types/project';

/**
 * 💬 A videó-szerkesztő felirat-paneljének (`components/editor/panels/CaptionsPanel.tsx`)
 * expo-mentes magja: a gyors felirat sorai és hossza, az új felirat-klip alakja és
 * a fordítás cél-nyelvei. (REFACTOR: a CaptionsPanel.tsx-ből kiemelve, változatlanul.)
 */

/** feliratonkénti hossz-korlátok (mp) */
export const MIN_CAPTION = 1;
export const MAX_CAPTION = 5;
export const FALLBACK_CAPTION = 2.5;

/** 🌍 felirat-fordítás cél-nyelvei (a nevek endonimák — nem kell i18n) */
export const TARGET_LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'hu', label: 'Magyar' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

/** a kézi felirat sorai: soronként egy, a szélek levágva, üres sor nélkül */
export const captionLines = (raw: string) =>
  raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** soronkénti hossz: a rendelkezésre álló sáv egyenletesen elosztva, 1–5 mp között */
export const quickCaptionDuration = (span: number, count: number) =>
  span > MIN_CAPTION
    ? clamp(span / count, MIN_CAPTION, MAX_CAPTION)
    : FALLBACK_CAPTION;

/** új felirat-klip a választott stílus-presettel */
export const captionClip = (
  text: string,
  start: number,
  duration: number,
  preset: TextStylePreset
): TextClip => ({
  kind: 'text',
  id: makeId('clip'),
  start,
  duration,
  text,
  color: '#ffffff',
  backgroundColor: null,
  fontSize: 5,
  fontWeight: 'bold',
  // alsó harmad — short videónál itt nem takar bele az arcba
  position: { x: 0.5, y: 0.78 },
  animation: 'pop',
  stylePreset: preset,
});

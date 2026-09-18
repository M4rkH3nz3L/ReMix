/**
 * 🎛️ Design-rendszer — az app „érzésének" egyetlen belépőpontja.
 *
 *   import { motion, radius, typography, colors, haptics } from '@/design';
 *
 * - `motion`     — időtartamok, easing-görbék, spring-presetek (mozgás-ritmus)
 * - `radius`     — sarok-lekerekítés skála
 * - `typography` — SF Pro súlyok, méret-skála, kész szöveg-stílusok
 * - `colors`     — `palette` (re-export) + funkcionális (jelentés-alapú) színek
 * - `haptics`    — szemantikus, best-effort tapintható visszajelzés
 *
 * A RESZPONZÍV tokenek (spacing, méret-osztály, EditorMetrics) továbbra is a
 * `@/constants/layout`-ból jönnek — azok a képernyő-mérettől függenek.
 */
export { motion, duration, easing, timing, spring } from './motion';
export { radius, type RadiusToken } from './radius';
export { typography, weight, size, text } from './typography';
export { colors, palette, functional, accentGradient, trackColors, type FunctionalColor } from './colors';
export { haptics } from './haptics';

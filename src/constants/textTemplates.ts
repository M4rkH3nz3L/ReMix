import type { TextClip } from '@/types/project';

/**
 * 🎞️ Cím-/szöveg-sablonok (Text templates): egy koppintásra kész, animált
 * feliratstílus a KIJELÖLT szövegklipre — a szöveg tartalma és időzítése marad,
 * csak a „look" cserélődik. Tisztán a meglévő szövegmotorra épül (font + 3D +
 * animáció + stílus-preset + háttér + pozíció), ezért nincs új render-kód.
 *
 * Az `apply` minden look-mezőt EXPLICITEN beállít (a nem használtakat is:
 * `text3d: undefined` → 3D lekapcsol, `backgroundColor: null` → nincs doboz),
 * hogy két sablon közt váltva ne ragadjon be a korábbi stílus.
 */
export interface TextTemplate {
  id: string;
  label: string;
  fields: Pick<TextClip, 'fontSize' | 'color' | 'position'> &
    Partial<
      Pick<
        TextClip,
        'fontFamily' | 'fontWeight' | 'backgroundColor' | 'stylePreset' | 'animation' | 'text3d'
      >
    >;
}

export const TEXT_TEMPLATES: TextTemplate[] = [
  {
    id: 'title-bold',
    label: '📢 Címkártya',
    fields: {
      fontFamily: 'Anton',
      fontSize: 11,
      fontWeight: 'bold',
      color: '#ffffff',
      stylePreset: 'outline',
      animation: 'pop',
      position: { x: 0.5, y: 0.3 },
    },
  },
  {
    id: 'cinematic',
    label: '🎬 Mozis',
    fields: {
      fontFamily: 'BebasNeue',
      fontSize: 8,
      fontWeight: 'normal',
      color: '#ffffff',
      stylePreset: 'plain',
      animation: 'fade',
      position: { x: 0.5, y: 0.82 },
    },
  },
  {
    id: 'lower-third',
    label: '🟪 Alsó-harmad',
    fields: {
      fontFamily: 'Poppins',
      fontSize: 5,
      fontWeight: 'bold',
      color: '#ffffff',
      backgroundColor: '#7c5cff',
      stylePreset: 'plain',
      animation: 'slide',
      position: { x: 0.3, y: 0.8 },
    },
  },
  {
    id: 'subtitle-box',
    label: '💬 Feliratdoboz',
    fields: {
      fontSize: 5,
      fontWeight: 'normal',
      color: '#ffffff',
      backgroundColor: '#0c0d12',
      stylePreset: 'plain',
      animation: 'none',
      position: { x: 0.5, y: 0.86 },
    },
  },
  {
    id: 'neon',
    label: '✨ Neon',
    fields: {
      fontFamily: 'Bungee',
      fontSize: 8,
      fontWeight: 'normal',
      color: '#2ee6c0',
      stylePreset: 'neon',
      animation: 'pulse',
      position: { x: 0.5, y: 0.42 },
    },
  },
  {
    id: 'chrome-3d',
    label: '🪞 Króm 3D',
    fields: {
      fontFamily: 'Anton',
      fontSize: 12,
      fontWeight: 'bold',
      color: '#ffffff',
      text3d: { depth: 0.5, tiltX: 8, tiltY: -10, material: 'chrome' },
      animation: 'pop',
      position: { x: 0.5, y: 0.33 },
    },
  },
  {
    id: 'gold-3d',
    label: '🥇 Arany 3D',
    fields: {
      fontFamily: 'BebasNeue',
      fontSize: 12,
      fontWeight: 'bold',
      color: '#ffffff',
      text3d: { depth: 0.55, tiltX: 6, tiltY: 8, material: 'gold' },
      animation: 'fade',
      position: { x: 0.5, y: 0.3 },
    },
  },
  {
    id: 'bubble',
    label: '🎈 Buborék',
    fields: {
      fontFamily: 'Pacifico',
      fontSize: 8,
      fontWeight: 'normal',
      color: '#ff5c72',
      stylePreset: 'bubble',
      animation: 'pop',
      position: { x: 0.5, y: 0.5 },
    },
  },
];

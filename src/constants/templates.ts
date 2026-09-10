import { makeId } from '@/lib/id';
import { createEmptyProject } from '@/lib/projectUtils';
import type {
  AspectRatio,
  Project,
  TextAnimation,
  TextClip,
  TextStylePreset,
} from '@/types/project';

/**
 * Sablonok: kész felirat-koreográfia (hook → tartalom → CTA), amibe a creator
 * már csak a saját videóját és szövegét teszi bele. A szövegklipek placeholder
 * szövegekkel jönnek létre, minden szabadon átírható.
 */

interface TemplateText {
  text: string;
  start: number;
  duration: number;
  /** 0–1 normalizált középpont */
  y: number;
  fontSize?: number;
  color?: string;
  stylePreset?: TextStylePreset;
  animation?: TextAnimation;
}

export interface VideoTemplate {
  id: string;
  emoji: string;
  name: string;
  description: string;
  aspectRatio: AspectRatio;
  /** felkapott jelölés — később a backend trend-adata váltja ki */
  trending?: boolean;
  texts: TemplateText[];
}

export const templates: VideoTemplate[] = [
  {
    id: 'hook-cta',
    emoji: '🎯',
    name: 'Hook + CTA',
    description: 'Erős nyitómondat, zárásnak követés-felhívás',
    aspectRatio: '9:16',
    trending: true,
    texts: [
      {
        text: 'EZT SENKI NEM MONDJA EL 👀',
        start: 0,
        duration: 2.5,
        y: 0.3,
        fontSize: 7,
        stylePreset: 'outline',
        animation: 'pop',
      },
      {
        text: 'Írd ide a lényeget…',
        start: 2.5,
        duration: 4,
        y: 0.78,
        fontSize: 5,
        stylePreset: 'bubble',
        animation: 'pop',
      },
      {
        text: 'Kövess a folytatásért! ➡️',
        start: 6.5,
        duration: 2.5,
        y: 0.5,
        fontSize: 6,
        stylePreset: 'neon',
        color: '#ffd166',
        animation: 'pulse',
      },
    ],
  },
  {
    id: 'three-tips',
    emoji: '💡',
    name: '3 tipp',
    description: 'Számozott tippek pörgős vágáshoz',
    aspectRatio: '9:16',
    texts: [
      {
        text: '3 TIPP, AMIT BÁRCSAK ELŐBB TUDOK 💡',
        start: 0,
        duration: 2,
        y: 0.3,
        fontSize: 6,
        stylePreset: 'outline',
        animation: 'pop',
      },
      {
        text: '1️⃣ Első tipp ide',
        start: 2,
        duration: 2.5,
        y: 0.78,
        fontSize: 5,
        stylePreset: 'bubble',
        animation: 'pop',
      },
      {
        text: '2️⃣ Második tipp ide',
        start: 4.5,
        duration: 2.5,
        y: 0.78,
        fontSize: 5,
        stylePreset: 'bubble',
        animation: 'pop',
      },
      {
        text: '3️⃣ Harmadik tipp ide',
        start: 7,
        duration: 2.5,
        y: 0.78,
        fontSize: 5,
        stylePreset: 'bubble',
        animation: 'pop',
      },
      {
        text: 'Melyiket próbálod ki? 👇',
        start: 9.5,
        duration: 2.5,
        y: 0.5,
        fontSize: 5.5,
        stylePreset: 'neon',
        color: '#2ecc8f',
        animation: 'pulse',
      },
    ],
  },
  {
    id: 'before-after',
    emoji: '✨',
    name: 'Előtte / Utána',
    description: 'Transzformáció két felvonásban',
    aspectRatio: '9:16',
    texts: [
      {
        text: 'ELŐTTE 😬',
        start: 0,
        duration: 3,
        y: 0.15,
        fontSize: 7,
        stylePreset: 'outline',
        animation: 'slide',
      },
      {
        text: 'UTÁNA 🤯',
        start: 3,
        duration: 3,
        y: 0.15,
        fontSize: 7,
        color: '#ffd166',
        stylePreset: 'outline',
        animation: 'pop',
      },
      {
        text: 'Mentsd el, hogy megtaláld! 🔖',
        start: 6,
        duration: 2.5,
        y: 0.78,
        fontSize: 5,
        stylePreset: 'bubble',
        animation: 'pop',
      },
    ],
  },
  {
    id: 'storytime',
    emoji: '🎤',
    name: 'Storytime',
    description: 'Karaoke-felirat a sztorizáshoz',
    aspectRatio: '9:16',
    trending: true,
    texts: [
      {
        text: 'STORYTIME 🍿',
        start: 0,
        duration: 2,
        y: 0.3,
        fontSize: 8,
        stylePreset: 'neon',
        color: '#c447d6',
        animation: 'pop',
      },
      {
        text: 'Ide jön az első mondatod szavanként kiemelve',
        start: 2,
        duration: 4,
        y: 0.78,
        fontSize: 4.5,
        stylePreset: 'bubble',
        animation: 'karaoke',
      },
      {
        text: 'És itt folytatódik a történet',
        start: 6,
        duration: 3.5,
        y: 0.78,
        fontSize: 4.5,
        stylePreset: 'bubble',
        animation: 'karaoke',
      },
    ],
  },
  {
    id: 'product',
    emoji: '🛍️',
    name: 'Termékbemutató',
    description: 'Feature-lista gyors vágásokhoz',
    aspectRatio: '9:16',
    texts: [
      {
        text: 'EZT NÉZD MEG 🔥',
        start: 0,
        duration: 2,
        y: 0.3,
        fontSize: 7,
        stylePreset: 'outline',
        animation: 'shake',
      },
      {
        text: '✅ Első jó tulajdonság',
        start: 2,
        duration: 2,
        y: 0.75,
        fontSize: 4.5,
        stylePreset: 'bubble',
        animation: 'slide',
      },
      {
        text: '✅ Második jó tulajdonság',
        start: 4,
        duration: 2,
        y: 0.8,
        fontSize: 4.5,
        stylePreset: 'bubble',
        animation: 'slide',
      },
      {
        text: 'Link a bióban 🔗',
        start: 6,
        duration: 2.5,
        y: 0.5,
        fontSize: 6,
        stylePreset: 'neon',
        color: '#4d9dff',
        animation: 'pulse',
      },
    ],
  },
  {
    id: 'quote',
    emoji: '💬',
    name: 'Idézet',
    description: 'Egy gondolat, ami megállítja a görgetést',
    aspectRatio: '1:1',
    texts: [
      {
        text: '„Ide jön az idézet, ami megállítja a görgetést."',
        start: 0,
        duration: 5,
        y: 0.45,
        fontSize: 6,
        stylePreset: 'plain',
        animation: 'typewriter',
      },
      {
        text: '— a szerző',
        start: 3,
        duration: 2,
        y: 0.65,
        fontSize: 4,
        color: '#8b90a3',
        stylePreset: 'plain',
        animation: 'fade',
      },
    ],
  },
];

/** Projekt a sablonból — a szövegsáv előre fel van töltve, a videó a creatoré. */
export function createProjectFromTemplate(template: VideoTemplate): Project {
  const project = createEmptyProject(template.name, template.aspectRatio);
  const textClips: TextClip[] = template.texts.map((t) => ({
    kind: 'text',
    id: makeId('clip'),
    start: t.start,
    duration: t.duration,
    text: t.text,
    color: t.color ?? '#ffffff',
    backgroundColor: null,
    fontSize: t.fontSize ?? 5,
    fontWeight: 'bold',
    position: { x: 0.5, y: t.y },
    animation: t.animation ?? 'pop',
    stylePreset: t.stylePreset ?? 'plain',
  }));
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.type === 'text' ? { ...track, clips: textClips } : track
    ),
  };
}

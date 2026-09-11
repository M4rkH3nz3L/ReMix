import { t } from 'i18next';

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
 *
 * 🌍 A megjelenő szövegek (név, leírás, felirat-placeholderek) i18n-kulcsból
 * jönnek: `templates.<id>.name` · `.description` · `.line0..N`. A név/leírás a
 * főképernyőn render-időben fordul; a felirat-placeholdereket a projekt
 * létrehozásakor (`createProjectFromTemplate`) égetjük be az aktuális nyelven.
 */

interface TemplateText {
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
  aspectRatio: AspectRatio;
  /** felkapott jelölés — később a backend trend-adata váltja ki */
  trending?: boolean;
  texts: TemplateText[];
}

/** i18n-kulcsok egy sablonhoz (a `template.id` alapján). */
export function templateNameKey(id: string): string {
  return `templates.${id}.name`;
}
export function templateDescriptionKey(id: string): string {
  return `templates.${id}.description`;
}

export const templates: VideoTemplate[] = [
  {
    id: 'hook-cta',
    emoji: '🎯',
    aspectRatio: '9:16',
    trending: true,
    texts: [
      { start: 0, duration: 2.5, y: 0.3, fontSize: 7, stylePreset: 'outline', animation: 'pop' },
      { start: 2.5, duration: 4, y: 0.78, fontSize: 5, stylePreset: 'bubble', animation: 'pop' },
      { start: 6.5, duration: 2.5, y: 0.5, fontSize: 6, stylePreset: 'neon', color: '#ffd166', animation: 'pulse' },
    ],
  },
  {
    id: 'three-tips',
    emoji: '💡',
    aspectRatio: '9:16',
    texts: [
      { start: 0, duration: 2, y: 0.3, fontSize: 6, stylePreset: 'outline', animation: 'pop' },
      { start: 2, duration: 2.5, y: 0.78, fontSize: 5, stylePreset: 'bubble', animation: 'pop' },
      { start: 4.5, duration: 2.5, y: 0.78, fontSize: 5, stylePreset: 'bubble', animation: 'pop' },
      { start: 7, duration: 2.5, y: 0.78, fontSize: 5, stylePreset: 'bubble', animation: 'pop' },
      { start: 9.5, duration: 2.5, y: 0.5, fontSize: 5.5, stylePreset: 'neon', color: '#2ecc8f', animation: 'pulse' },
    ],
  },
  {
    id: 'before-after',
    emoji: '✨',
    aspectRatio: '9:16',
    texts: [
      { start: 0, duration: 3, y: 0.15, fontSize: 7, stylePreset: 'outline', animation: 'slide' },
      { start: 3, duration: 3, y: 0.15, fontSize: 7, color: '#ffd166', stylePreset: 'outline', animation: 'pop' },
      { start: 6, duration: 2.5, y: 0.78, fontSize: 5, stylePreset: 'bubble', animation: 'pop' },
    ],
  },
  {
    id: 'storytime',
    emoji: '🎤',
    aspectRatio: '9:16',
    trending: true,
    texts: [
      { start: 0, duration: 2, y: 0.3, fontSize: 8, stylePreset: 'neon', color: '#c447d6', animation: 'pop' },
      { start: 2, duration: 4, y: 0.78, fontSize: 4.5, stylePreset: 'bubble', animation: 'karaoke' },
      { start: 6, duration: 3.5, y: 0.78, fontSize: 4.5, stylePreset: 'bubble', animation: 'karaoke' },
    ],
  },
  {
    id: 'product',
    emoji: '🛍️',
    aspectRatio: '9:16',
    texts: [
      { start: 0, duration: 2, y: 0.3, fontSize: 7, stylePreset: 'outline', animation: 'shake' },
      { start: 2, duration: 2, y: 0.75, fontSize: 4.5, stylePreset: 'bubble', animation: 'slide' },
      { start: 4, duration: 2, y: 0.8, fontSize: 4.5, stylePreset: 'bubble', animation: 'slide' },
      { start: 6, duration: 2.5, y: 0.5, fontSize: 6, stylePreset: 'neon', color: '#4d9dff', animation: 'pulse' },
    ],
  },
  {
    id: 'quote',
    emoji: '💬',
    aspectRatio: '1:1',
    texts: [
      { start: 0, duration: 5, y: 0.45, fontSize: 6, stylePreset: 'plain', animation: 'typewriter' },
      { start: 3, duration: 2, y: 0.65, fontSize: 4, color: '#8b90a3', stylePreset: 'plain', animation: 'fade' },
    ],
  },
];

/** Projekt a sablonból — a szövegsáv előre fel van töltve, a videó a creatoré.
 *  A név + felirat-placeholderek az aktuális nyelven égnek be (i18n, egyszeri). */
export function createProjectFromTemplate(template: VideoTemplate): Project {
  const name = t(templateNameKey(template.id));
  // a sablon már ad kiindulási SEO-t (cím + leírás), így a sablonból induló
  // projekt sem marad meta nélkül — a hashtagek/kulcsszavak a creatorra várnak
  const project = createEmptyProject(name, template.aspectRatio, {
    title: name,
    description: t(templateDescriptionKey(template.id)),
    hashtags: [],
    keywords: [],
  });
  const textClips: TextClip[] = template.texts.map((tx, i) => ({
    kind: 'text',
    id: makeId('clip'),
    start: tx.start,
    duration: tx.duration,
    text: t(`templates.${template.id}.line${i}`),
    color: tx.color ?? '#ffffff',
    backgroundColor: null,
    fontSize: tx.fontSize ?? 5,
    fontWeight: 'bold',
    position: { x: 0.5, y: tx.y },
    animation: tx.animation ?? 'pop',
    stylePreset: tx.stylePreset ?? 'plain',
  }));
  return {
    ...project,
    tracks: project.tracks.map((track) =>
      track.type === 'text' ? { ...track, clips: textClips } : track
    ),
  };
}

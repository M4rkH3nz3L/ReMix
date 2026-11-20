import { partitionAiCommands, toEditorCommands } from '@/lib/aiCommands';
import type { AiCommand } from '@/lib/aiCommands';
import type { AutoEditVariant } from '@/lib/autoedit';
import type { EditorCommand } from '@/lib/commands';
import type { Clip, Project } from '@/types/project';

/**
 * 🤖 Az AI-asszisztens panel (`components/editor/panels/AssistantPanel.tsx`) tiszta,
 * expo-mentes magja: konstansok, a projektből olvasó segédek és az AI-válasz →
 * EditorCommand-köteg leképezés — önmagukban tesztelhetők.
 */

export const QUICK_ACTIONS = ['makeEngaging', 'shorten30', 'addTitleCta', 'captionsLowerThird', 'unifyCaptions'];

/** 📱 közösségi platform → cél-képarány (a márkanevek fixek, nem i18n) */
export const SOCIAL_PRESETS: { id: string; label: string; aspect: '16:9' | '9:16' | '1:1' }[] = [
  { id: 'tiktok', label: 'TikTok', aspect: '9:16' },
  { id: 'reels', label: 'Reels', aspect: '9:16' },
  { id: 'shorts', label: 'Shorts', aspect: '9:16' },
  { id: 'youtube', label: 'YouTube', aspect: '16:9' },
  { id: 'instagram', label: 'Instagram', aspect: '1:1' },
];

/** a videósávok videóklipjeinek egyedi forrás-URI-jai (első előfordulás sorrendjében) */
export function videoUris(project: Project): string[] {
  return [
    ...new Set(
      project.tracks
        .filter((t) => t.type === 'video')
        .flatMap((t) => t.clips)
        .filter((c) => c.kind === 'video')
        .map((c) => c.uri)
    ),
  ];
}

/** az első videóklip (sáv-sorrendben) — a worker-diagnosztika fájl-ellenőrzéséhez */
export function firstVideoClip(project: Project | null | undefined): Clip | undefined {
  return project?.tracks
    .filter((t) => t.type === 'video')
    .flatMap((t) => t.clips)
    .find((c) => c.kind === 'video');
}

/** a zenesáv legkorábban induló hangklipje (a beat-rács forrása) */
export function firstMusicClip(project: Project): Clip | undefined {
  return project.tracks
    .filter((t) => t.type === 'music')
    .flatMap((t) => t.clips)
    .filter((c) => c.kind === 'audio')
    .sort((a, b) => a.start - b.start)[0];
}

/** ▶ a változat keep-sávjai a projekt hosszára vágva; a 0,05 s-nél rövidebbek kiesnek */
export function variantPreviewRanges(
  variant: AutoEditVariant,
  duration: number
): { start: number; end: number }[] {
  return variant.keep
    .map((k) => ({
      start: Math.max(0, Math.min(k.start, duration)),
      end: Math.max(0, Math.min(k.end, duration)),
    }))
    .filter((r) => r.end - r.start > 0.05);
}

/** a változat megtartott összhossza (mp) — a kártya meta-sorához */
export function variantKeepSeconds(variant: AutoEditVariant): number {
  return variant.keep.reduce((s, k) => s + Math.max(0, k.end - k.start), 0);
}

/**
 * 🤖 Az AI-válasz → a végrehajtandó EditorCommand-köteg: csak a valódi projekt
 * ellen elfogadott parancsok, az AI üzenetével mint indoklással (proveniencia, #34).
 */
export function aiReplyCommands(
  reply: { message: string; commands: AiCommand[] },
  project: Project
): EditorCommand[] {
  return toEditorCommands(partitionAiCommands(reply.commands, project).accepted, project, reply.message);
}

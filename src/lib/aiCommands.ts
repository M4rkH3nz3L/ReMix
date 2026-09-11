import type { TFunction } from 'i18next';

import { describeCommand } from '@/lib/commands';
import type { EditorCommand, ProjectEvent } from '@/lib/commands';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { clamp } from '@/lib/time';
import type { Clip, Project, TextClip } from '@/types/project';

/**
 * AI-réteg kliens (full-plan F3): rétegzett kontextus-építés (nem a teljes
 * projekt-JSON!), a worker /ai/assist hívása, és a kapott whitelist-parancsok
 * leképezése validált EditorCommand-okra. A végrehajtás a hívó dolga
 * (dispatch, actor: 'ai') — így minden AI-művelet undo-zható.
 */

/** a workertől érkező parancsok (a szerveroldali zod-séma tükre) */
export interface AiCommand {
  type:
    | 'UPDATE_CLIP'
    | 'REMOVE_CLIP'
    | 'SPLIT_CLIP'
    | 'ADD_TEXT_CLIPS'
    | 'SET_ASPECT'
    | 'RENAME_PROJECT';
  clipId?: string;
  patch?: Record<string, unknown>;
  time?: number;
  trackType?: 'text' | 'captions' | 'overlay';
  clips?: {
    text: string;
    start: number;
    duration: number;
    color?: string;
    fontSize?: number;
    position?: { x: number; y: number };
    animation?: TextClip['animation'];
    stylePreset?: TextClip['stylePreset'];
  }[];
  aspectRatio?: Project['aspectRatio'];
  name?: string;
}

export interface AssistantReply {
  message: string;
  commands: AiCommand[];
}

/**
 * 🤖 Egy AI-parancs emberi nyelvű leírása — az „AI action preview"-hez (#35):
 * a felhasználó az ALKALMAZÁS ELŐTT tételesen látja, mi fog változni.
 */
export function describeAiCommand(cmd: AiCommand, t: TFunction): string {
  switch (cmd.type) {
    case 'UPDATE_CLIP':
      return t('panels.assistant.cmdUpdateClip');
    case 'REMOVE_CLIP':
      return t('panels.assistant.cmdRemoveClip');
    case 'SPLIT_CLIP':
      return t('panels.assistant.cmdSplitClip', { time: (cmd.time ?? 0).toFixed(1) });
    case 'ADD_TEXT_CLIPS':
      return t('panels.assistant.cmdAddText', { count: cmd.clips?.length ?? 0 });
    case 'SET_ASPECT':
      return t('panels.assistant.cmdSetAspect', { aspect: cmd.aspectRatio ?? '' });
    case 'RENAME_PROJECT':
      return t('panels.assistant.cmdRename', { name: cmd.name ?? '' });
    default:
      return cmd.type;
  }
}

function clipBrief(clip: Clip): Record<string, unknown> {
  const base = {
    id: clip.id,
    kind: clip.kind,
    start: Math.round(clip.start * 100) / 100,
    duration: Math.round(clip.duration * 100) / 100,
  };
  switch (clip.kind) {
    case 'text':
      return {
        ...base,
        text: clip.text,
        stylePreset: clip.stylePreset ?? 'plain',
        animation: clip.animation,
        y: clip.position.y,
      };
    case 'video':
      return { ...base, speed: clip.speed, volume: clip.volume, filterId: clip.filterId };
    case 'audio':
      return { ...base, label: clip.label, volume: clip.volume };
    default:
      return base;
  }
}

/**
 * Rétegzett, AI-olvasható kontextus: Global (projekt-céljellemzők) + Relevant
 * (sávok tömör klip-leírásokkal) + Current (playhead, kijelölés) + Memory
 * (utolsó események ember-olvashatóan).
 */
export function buildAiContext(
  project: Project,
  playhead: number,
  selectedClipId: string | null,
  events: ProjectEvent[]
): Record<string, unknown> {
  return {
    project: {
      name: project.name,
      type: 'short_video',
      aspectRatio: project.aspectRatio,
      duration: Math.round(projectDuration(project) * 100) / 100,
    },
    tracks: project.tracks
      .filter((t) => t.clips.length > 0)
      .map((t) => ({
        type: t.type,
        clips: t.clips.map(clipBrief),
      })),
    current: {
      playhead: Math.round(playhead * 100) / 100,
      selectedClipId,
    },
    recentActions: events.slice(-15).map((e) => `${e.actor}: ${describeCommand(e.command)}`),
  };
}

/** az AI által módosítható mezők — a szerveroldali whitelist kliens-tükre */
const PATCHABLE_FIELDS = new Set([
  'start',
  'duration',
  'text',
  'color',
  'backgroundColor',
  'fontSize',
  'position',
  'animation',
  'stylePreset',
  'speed',
  'volume',
  'filterId',
  'filterIntensity',
  'fadeInSec',
  'fadeOutSec',
  'opacity',
  'trimIn',
]);

/**
 * AI-parancsok → validált EditorCommand-ok. Az ismeretlen mezők kiszűrődnek,
 * az új szövegklipek teljes klipekké egészülnek ki.
 */
export function toEditorCommands(commands: AiCommand[], aiReason?: string): EditorCommand[] {
  const result: EditorCommand[] = [];
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'UPDATE_CLIP': {
        if (!cmd.clipId || !cmd.patch) {
          break;
        }
        const patch = Object.fromEntries(
          Object.entries(cmd.patch).filter(([key]) => PATCHABLE_FIELDS.has(key))
        );
        if (Object.keys(patch).length > 0) {
          result.push({ type: 'UPDATE_CLIP', clipId: cmd.clipId, patch });
        }
        break;
      }
      case 'REMOVE_CLIP':
        if (cmd.clipId) {
          result.push({ type: 'REMOVE_CLIP', clipId: cmd.clipId });
        }
        break;
      case 'SPLIT_CLIP':
        if (cmd.clipId && typeof cmd.time === 'number') {
          result.push({ type: 'SPLIT_CLIP', clipId: cmd.clipId, time: cmd.time });
        }
        break;
      case 'ADD_TEXT_CLIPS': {
        if (!cmd.trackType || !cmd.clips || cmd.clips.length === 0) {
          break;
        }
        const clips: TextClip[] = cmd.clips.map((c) => ({
          kind: 'text',
          id: makeId('clip'),
          start: Math.max(0, c.start),
          duration: clamp(c.duration, 0.3, 60),
          text: c.text,
          color: c.color ?? '#ffffff',
          backgroundColor: null,
          fontSize: clamp(c.fontSize ?? (cmd.trackType === 'captions' ? 5 : 7), 3, 20),
          fontWeight: 'bold',
          position: c.position ?? {
            x: 0.5,
            y: cmd.trackType === 'captions' ? 0.78 : 0.3,
          },
          animation: c.animation ?? 'pop',
          stylePreset: c.stylePreset ?? (cmd.trackType === 'captions' ? 'bubble' : 'outline'),
          // 🤖 proveniencia (#34): az AI által hozzáadott elem indoklása
          ...(aiReason ? { aiReason } : {}),
        }));
        result.push({ type: 'ADD_CLIPS', trackType: cmd.trackType, clips });
        break;
      }
      case 'SET_ASPECT':
        if (cmd.aspectRatio) {
          result.push({ type: 'SET_ASPECT', aspectRatio: cmd.aspectRatio });
        }
        break;
      case 'RENAME_PROJECT':
        if (cmd.name) {
          result.push({ type: 'RENAME_PROJECT', name: cmd.name });
        }
        break;
    }
  }
  return result;
}

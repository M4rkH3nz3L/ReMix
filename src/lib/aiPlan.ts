import type { TFunction } from 'i18next';

import type { AiCommand } from '@/lib/aiCommands';
import type { Clip, Project } from '@/types/project';

/**
 * 🤖 AI terv-előnézet (editor control layer): egy AI-parancslistát a NYITOTT
 * projekthez feloldva ember-olvasható, TÉTELES tervvé alakít — melyik klip, mi
 * változik (miről mire), és hova ugorjon a lejátszófej az előnézethez. Pure
 * (csak típus-importok) → önmagában tesztelhető; a végrehajtás továbbra is a
 * Command Bus-on megy (toEditorCommands + applyBatch, egy undo).
 */

export interface AiPlanItem {
  /** a művelet neve (rövid) */
  title: string;
  /** a konkrét változás(ok) ember-olvashatóan */
  detail: string;
  /** hova ugorjon a lejátszófej az előnézethez (mp), ha értelmezhető */
  time: number | null;
  /** az érintett klip id-ja (kijelöléshez), ha van */
  clipId?: string;
  /** az AI rövid indoka (ha adott) */
  reason?: string;
}

/** az AI által állítható klip-mezők (a szerver-séma kliens-tükre, laza olvasáshoz) */
interface KnownPatch {
  speed?: number;
  volume?: number;
  filterId?: string;
  filterIntensity?: number;
  adjust?: Record<string, number>;
  transitionOut?: { type?: string; duration?: number };
  fadeInSec?: number;
  fadeOutSec?: number;
  opacity?: number;
  start?: number;
  duration?: number;
  trimIn?: number;
  text?: string;
  color?: string;
  backgroundColor?: string | null;
  fontSize?: number;
  position?: { x: number; y: number };
  animation?: string;
  stylePreset?: string;
}

/** tömör szám: max 2 tizedes, felesleges nullák nélkül */
function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  if (Number.isInteger(r)) {
    return String(r);
  }
  return r.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** előjeles szám (+/−) az adjust-deltákhoz */
function signed(n: number): string {
  return n > 0 ? `+${num(n)}` : num(n);
}

/** klip-hivatkozás: fajta + idősáv, pl. „video (2–5s)" */
function clipRef(clip: Clip | undefined, t: TFunction): string {
  if (!clip) {
    return t('panels.assistant.plan.unknownClip');
  }
  return `${clip.kind} (${num(clip.start)}–${num(clip.start + clip.duration)}s)`;
}

/** egy UPDATE_CLIP patch mezőnkénti, ember-olvasható diffje */
function updateDetail(clip: Clip | undefined, rawPatch: Record<string, unknown>, t: TFunction): string {
  const p = (rawPatch ?? {}) as KnownPatch;
  const old = (clip ?? {}) as unknown as KnownPatch;
  const L = (k: string) => t(`panels.assistant.field.${k}`);
  const parts: string[] = [];

  if (p.speed !== undefined) {
    parts.push(`${L('speed')} ${num(old.speed ?? 1)}×→${num(p.speed)}×`);
  }
  if (p.volume !== undefined) {
    parts.push(`${L('volume')} ${Math.round((old.volume ?? 1) * 100)}%→${Math.round(p.volume * 100)}%`);
  }
  if (p.filterId !== undefined) {
    parts.push(`${L('filter')}: ${p.filterId}`);
  }
  if (p.filterIntensity !== undefined) {
    parts.push(`${L('filterIntensity')} ${num(p.filterIntensity)}`);
  }
  if (p.adjust) {
    const a = Object.entries(p.adjust).map(([k, v]) => `${k} ${signed(v)}`);
    if (a.length > 0) {
      parts.push(`${L('adjust')}: ${a.join(', ')}`);
    }
  }
  if (p.transitionOut) {
    parts.push(`${L('transition')}: ${p.transitionOut.type ?? ''} ${num(p.transitionOut.duration ?? 0)}s`);
  }
  if (p.fadeInSec !== undefined) {
    parts.push(`${L('fadeIn')} ${num(p.fadeInSec)}s`);
  }
  if (p.fadeOutSec !== undefined) {
    parts.push(`${L('fadeOut')} ${num(p.fadeOutSec)}s`);
  }
  if (p.opacity !== undefined) {
    parts.push(`${L('opacity')} ${num(p.opacity)}`);
  }
  if (p.start !== undefined) {
    parts.push(`${L('start')} ${num(p.start)}s`);
  }
  if (p.duration !== undefined) {
    parts.push(`${L('duration')} ${num(p.duration)}s`);
  }
  if (p.trimIn !== undefined) {
    parts.push(`${L('trimIn')} ${num(p.trimIn)}s`);
  }
  if (p.text !== undefined) {
    parts.push(`${L('text')}: "${p.text.slice(0, 40)}"`);
  }
  if (p.color !== undefined) {
    parts.push(`${L('color')}: ${p.color}`);
  }
  if (p.backgroundColor !== undefined) {
    parts.push(L('background'));
  }
  if (p.fontSize !== undefined) {
    parts.push(`${L('fontSize')} ${num(p.fontSize)}`);
  }
  if (p.position !== undefined) {
    parts.push(L('position'));
  }
  if (p.animation !== undefined) {
    parts.push(`${L('animation')}: ${p.animation}`);
  }
  if (p.stylePreset !== undefined) {
    parts.push(`${L('style')}: ${p.stylePreset}`);
  }
  return parts.join(' · ');
}

/** AI-parancsok → tételes, feloldott terv-elemek (a jóváhagyó UI-nak). */
export function describeAiPlan(
  commands: AiCommand[],
  project: Project,
  t: TFunction
): AiPlanItem[] {
  const byId = new Map<string, Clip>(
    project.tracks.flatMap((tr) => tr.clips).map((c) => [c.id, c])
  );
  return commands.map((cmd) => {
    switch (cmd.type) {
      case 'UPDATE_CLIP': {
        const clip = cmd.clipId ? byId.get(cmd.clipId) : undefined;
        return {
          title: t('panels.assistant.plan.update'),
          detail: `${clipRef(clip, t)}: ${updateDetail(clip, cmd.patch ?? {}, t)}`,
          time: clip?.start ?? null,
          clipId: cmd.clipId,
          reason: cmd.reason,
        };
      }
      case 'REMOVE_CLIP': {
        const clip = cmd.clipId ? byId.get(cmd.clipId) : undefined;
        return {
          title: t('panels.assistant.plan.remove'),
          detail: clipRef(clip, t),
          time: clip?.start ?? null,
          clipId: cmd.clipId,
        };
      }
      case 'SPLIT_CLIP': {
        const clip = cmd.clipId ? byId.get(cmd.clipId) : undefined;
        return {
          title: t('panels.assistant.plan.split'),
          detail: `${clipRef(clip, t)} · ${t('panels.assistant.plan.splitAt', { time: num(cmd.time ?? 0) })}`,
          time: cmd.time ?? null,
          clipId: cmd.clipId,
        };
      }
      case 'ADD_TEXT_CLIPS': {
        const first = cmd.clips?.[0];
        const track = t(`panels.assistant.plan.track_${cmd.trackType ?? 'text'}`);
        const preview = (cmd.clips ?? [])
          .slice(0, 3)
          .map((c) => `"${c.text.slice(0, 24)}"`)
          .join(', ');
        return {
          title: t('panels.assistant.plan.addText', { count: cmd.clips?.length ?? 0, track }),
          detail: preview,
          time: first?.start ?? null,
          reason: cmd.reason,
        };
      }
      case 'SET_ASPECT':
        return {
          title: t('panels.assistant.plan.aspect', { aspect: cmd.aspectRatio ?? '' }),
          detail: '',
          time: null,
        };
      case 'RENAME_PROJECT':
        return {
          title: t('panels.assistant.plan.rename', { name: cmd.name ?? '' }),
          detail: '',
          time: null,
        };
      default:
        return { title: cmd.type, detail: '', time: null };
    }
  });
}

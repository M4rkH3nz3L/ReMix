import { t as tr } from 'i18next';

import { applyBrandCaptions, buildWatermarkClip, deriveBrandKit, type BrandKit } from '@/lib/brandKit';
import { buildBrandSegmentPlan, type IntroTemplate, type OutroTemplate } from '@/lib/brandIntro';
import { makeId } from '@/lib/id';
import { buildMotionPackPlan, type MotionPack } from '@/lib/motionPacks';
import { projectDuration } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AudioClip, Project, TextClip } from '@/types/project';

/**
 * 🎨 Creator Preset — a Brand Kit + Motion pack + intro/outro + hang egyetlen
 * NEVEZETT csomagban ("My YouTube Style"), amit egy gombbal ráhúzhatsz bármely
 * projektre. Pure derive/leírás; az `applyCreatorPreset` a MEGLÉVŐ apply-
 * helpereket komponálja (brand-feliratok, vízjel-logó, motion pack, intro/outro,
 * háttérzene) — mindegyik a store parancsain át, undo-zhatóan.
 */
export interface CreatorPreset {
  id: string;
  name: string;
  savedAt: string;
  /** Font + Colors + Captions + Logo (vízjel) */
  brand: BrandKit | null;
  /** elsődleges betűtípus (a szöveg-klipekre) */
  font: string | null;
  /** származtatott paletta (accent + felirat/szöveg színek) */
  colors: string[];
  /** Motion + Transitions */
  motionPack: MotionPack | null;
  intro: IntroTemplate | null;
  outro: OutroTemplate | null;
  /** háttérzene (a projekt zenesávjából származtatva) */
  sound: { uri: string; name: string } | null;
}

/** Preset összeállítása az aktuális projektből + a választott motion/intro/outro-ból. */
export function deriveCreatorPreset(
  project: Project,
  name: string,
  opts: { motionPack?: MotionPack | null; intro?: IntroTemplate | null; outro?: OutroTemplate | null }
): CreatorPreset {
  const savedAt = new Date().toISOString();
  const brand = deriveBrandKit(project, savedAt);
  const texts = project.tracks
    .flatMap((t) => t.clips)
    .filter((c): c is TextClip => c.kind === 'text');
  // leggyakoribb betűtípus
  const fontCounts = new Map<string, number>();
  for (const c of texts) {
    if (c.fontFamily) {
      fontCounts.set(c.fontFamily, (fontCounts.get(c.fontFamily) ?? 0) + 1);
    }
  }
  const font = [...fontCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const colors = Array.from(
    new Set([brand?.accentColor, brand?.caption?.color, ...texts.map((c) => c.color)].filter(Boolean))
  ) as string[];
  const music = project.tracks.find((t) => t.type === 'music')?.clips.find((c) => c.kind === 'audio');
  const sound =
    music && music.kind === 'audio' ? { uri: music.uri, name: music.label ?? 'audio' } : null;

  return {
    id: makeId('preset'),
    name: name.trim() || tr('panels.creatorPreset.defaultName'),
    savedAt,
    brand,
    font,
    colors,
    motionPack: opts.motionPack ?? null,
    intro: opts.intro ?? null,
    outro: opts.outro ?? null,
    sound,
  };
}

/** Rövid, ember-olvasható összefoglaló (mi van a presetben). */
export function creatorPresetSummary(p: CreatorPreset): string[] {
  const parts: string[] = [];
  if (p.font) parts.push(p.font);
  if (p.colors.length) parts.push(`${p.colors.length} 🎨`);
  if (p.motionPack) parts.push(p.motionPack);
  if (p.intro) parts.push('intro');
  if (p.outro) parts.push('outro');
  if (p.brand?.caption) parts.push(tr('panels.creatorPreset.tagCaptions'));
  if (p.brand?.watermark) parts.push(tr('panels.creatorPreset.tagLogo'));
  if (p.sound) parts.push('♪');
  return parts;
}

/**
 * A preset ráhúzása az AKTUÁLIS projektre — a store parancsain át (több
 * undo-lépés, mindegyik a meglévő, tesztelt apply-úton). @returns a ténylegesen
 * alkalmazott komponensek listája (i18n-kulcs nélkül, nyers azonosítók).
 */
export function applyCreatorPreset(preset: CreatorPreset): string[] {
  const applied: string[] = [];
  const g = () => useEditorStore.getState();
  if (!g().project) {
    return applied;
  }

  // 1) Motion + Transitions (a fő videósáv klipjeit stílusozza)
  if (preset.motionPack) {
    const plan = buildMotionPackPlan(g().project as Project, preset.motionPack);
    if (plan && g().dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips })) {
      applied.push('motion');
    }
  }

  // 2) Font → a szöveg-klipek betűtípusa (a captions-t is)
  if (preset.font) {
    let fontChanged = false;
    for (const type of ['text', 'captions'] as const) {
      const track = g().project?.tracks.find((t) => t.type === type);
      if (track && track.clips.length > 0) {
        const clips = track.clips.map((c) => (c.kind === 'text' ? { ...c, fontFamily: preset.font as string } : c));
        if (g().dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: type, clips })) {
          fontChanged = true;
        }
      }
    }
    if (fontChanged) applied.push('font');
  }

  // 3) Brand-feliratok + logó (vízjel)
  if (preset.brand) {
    const kit = preset.brand;
    if (kit.caption) {
      const ct = g().project?.tracks.find((t) => t.type === 'captions');
      if (ct && ct.clips.length > 0) {
        const { clips, changed } = applyBrandCaptions(ct.clips, kit);
        if (changed > 0) {
          g().dispatch({ type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips });
          applied.push('captions');
        }
      }
    }
    if (kit.watermark) {
      const exists = g()
        .project?.tracks.flatMap((t) => t.clips)
        .some((c) => c.kind === 'shape' && c.imageUri === kit.watermark?.imageUri);
      if (!exists) {
        const clip = buildWatermarkClip(kit.watermark, projectDuration(g().project as Project), makeId('clip'));
        g().dispatch({
          type: 'ADD_CLIP',
          trackType: 'overlay',
          clip,
          asset: {
            id: makeId('ast'),
            kind: 'image',
            uri: kit.watermark.imageUri,
            provider: 'local',
            name: 'logo',
          },
        });
        applied.push('logo');
      }
    }
  }

  // 4) Intro / Outro (ripple)
  if (preset.intro || preset.outro) {
    const project = g().project as Project;
    const plan = buildBrandSegmentPlan(
      project.tracks.map((t) => ({ type: t.type, clips: t.clips })),
      {
        intro: preset.intro ?? undefined,
        outro: preset.outro ?? undefined,
        kit: preset.brand,
        title: project.name,
        makeId: () => makeId('clip'),
      }
    );
    if (plan && g().dispatch({ type: 'REPLACE_TRACKS', tracks: plan.tracks, label: 'preset:intro' })) {
      applied.push('intro/outro');
    }
  }

  // 5) Háttérzene
  if (preset.sound) {
    const dur = Math.min(30, projectDuration(g().project as Project) || 15);
    const clip: AudioClip = {
      kind: 'audio',
      id: makeId('clip'),
      start: 0,
      duration: dur,
      uri: preset.sound.uri,
      label: preset.sound.name,
      volume: 0.6,
      fadeIn: 0.3,
      fadeOut: 0.5,
      source: 'imported',
    };
    if (
      g().dispatch({
        type: 'ADD_CLIP',
        trackType: 'music',
        clip,
        asset: {
          id: makeId('ast'),
          kind: 'audio',
          uri: preset.sound.uri,
          provider: 'local',
          name: preset.sound.name,
        },
      })
    ) {
      applied.push('sound');
    }
  }

  return applied;
}

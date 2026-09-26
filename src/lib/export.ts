import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { serializeAss } from '@/lib/ass';
import { projectDuration } from '@/lib/projectUtils';
import { serializeSrt } from '@/lib/srt';
import { serializeVtt } from '@/lib/vtt';
import type { AspectRatio, InteractiveClip, Project, TextClip } from '@/types/project';

/**
 * Az interaktív elemeket NEM sütjük bele a videóba: a lejátszó (web/mobil)
 * ezt a metaadat-JSON-t értelmezi, és overlay-ként jeleníti meg a hotspotokat
 * a hagyományos MP4 fölött.
 */
export function buildInteractiveMetadata(project: Project) {
  const interactive = project.tracks
    .find((t) => t.type === 'interactive')
    ?.clips.filter((c): c is InteractiveClip => c.kind === 'interactive');
  return {
    format: 'vided-interactive',
    version: 1,
    projectId: project.id,
    title: project.name,
    aspectRatio: project.aspectRatio,
    duration: projectDuration(project),
    interactions: (interactive ?? []).map((clip) => ({
      id: clip.id,
      label: clip.label,
      start: clip.start,
      end: clip.start + clip.duration,
      rect: clip.rect,
      action: clip.action,
    })),
  };
}

async function shareFile(name: string, content: string, mimeType: string): Promise<void> {
  // 🌐 weben nincs natív fájlrendszer/megosztó (a `new File(Paths.cache)` +
  // `Sharing` elszáll) → a böngésző letölti a fájlt (Blob → `<a download>`).
  if (Platform.OS === 'web') {
    downloadTextWeb(name, content, mimeType);
    return;
  }
  const file = new File(Paths.cache, name);
  file.write(content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  }
}

/** 🌐 Szöveges tartalom böngészős letöltése (a web-es „megosztás" megfelelője). */
function downloadTextWeb(name: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function shareJson(name: string, payload: unknown): Promise<void> {
  await shareFile(name, JSON.stringify(payload, null, 2), 'application/json');
}

/** Egy .cube 3D LUT megosztása/mentése (a színkorrekció-export eredménye). */
export async function shareLutCube(name: string, cube: string): Promise<void> {
  const fileName = name.toLowerCase().endsWith('.cube') ? name : `${name}.cube`;
  await shareFile(fileName, cube, 'text/plain');
}

/** a felirat- és szövegsáv szöveg-klipjei, idő szerint rendezve (közös alap) */
function captionTextClips(project: Project): TextClip[] {
  return project.tracks
    .filter((t) => t.type === 'captions' || t.type === 'text')
    .flatMap((t) => t.clips.filter((c): c is TextClip => c.kind === 'text'))
    .slice()
    .sort((a, b) => a.start - b.start);
}

/** PlayRes a képarányból (az ASS pozíció-számításhoz) */
function aspectToPlayRes(aspect: AspectRatio): { width: number; height: number } {
  if (aspect === '9:16') {
    return { width: 1080, height: 1920 };
  }
  if (aspect === '1:1') {
    return { width: 1080, height: 1080 };
  }
  return { width: 1920, height: 1080 };
}

/** A felirat- és szövegsáv klipjei SRT-ként — bármely platform/lejátszó fogadja. */
export async function shareCaptionsSrt(project: Project): Promise<boolean> {
  const clips = captionTextClips(project);
  if (clips.length === 0) {
    return false;
  }
  const cues = clips.map((clip) => ({
    start: clip.start,
    end: clip.start + clip.duration,
    text: clip.text,
  }));
  await shareFile(`${project.name}-felirat.srt`, serializeSrt(cues), 'application/x-subrip');
  return true;
}

/** WebVTT export — a HTML5/webes lejátszók natív felirata, sor-pozícióval együtt. */
export async function shareCaptionsVtt(project: Project): Promise<boolean> {
  const clips = captionTextClips(project);
  if (clips.length === 0) {
    return false;
  }
  const cues = clips.map((clip) => ({
    start: clip.start,
    end: clip.start + clip.duration,
    text: clip.text,
    y: clip.position?.y,
  }));
  await shareFile(`${project.name}-felirat.vtt`, serializeVtt(cues), 'text/vtt');
  return true;
}

/** ASS export — stílussal (szín, félkövér, pontos pozíció, betűméret) együtt. */
export async function shareCaptionsAss(project: Project): Promise<boolean> {
  const clips = captionTextClips(project);
  if (clips.length === 0) {
    return false;
  }
  const res = aspectToPlayRes(project.aspectRatio);
  const cues = clips.map((clip) => ({
    start: clip.start,
    end: clip.start + clip.duration,
    text: clip.text,
    color: clip.color,
    bold: clip.fontWeight === 'bold',
    position: clip.position,
    fontSizePct: clip.fontSize,
  }));
  await shareFile(`${project.name}-felirat.ass`, serializeAss(cues, res), 'text/x-ssa');
  return true;
}

/** Interaktív metaadat megosztása (a lejátszó rétegnek). */
export async function shareInteractiveMetadata(project: Project): Promise<void> {
  await shareJson(`${project.name}-interaktiv.json`, buildInteractiveMetadata(project));
}

/**
 * A teljes projektfájl megosztása. Az MP4-render a Fázis 1 backend-lépése:
 * a szerver ezt a JSON-t + a médiafájlokat kapja meg, és FFmpeg-gel rendereli
 * (mobilon a kivett ffmpeg-kit miatt nincs megbízható natív render-út).
 */
export async function shareProjectFile(project: Project): Promise<void> {
  await shareJson(`${project.name}-projekt.json`, project);
}

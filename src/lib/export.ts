import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { projectDuration } from '@/lib/projectUtils';
import { serializeSrt } from '@/lib/srt';
import type { InteractiveClip, Project, TextClip } from '@/types/project';

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
  const file = new File(Paths.cache, name);
  file.write(content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
  }
}

async function shareJson(name: string, payload: unknown): Promise<void> {
  await shareFile(name, JSON.stringify(payload, null, 2), 'application/json');
}

/** A felirat- és szövegsáv klipjei SRT-ként — bármely platform/lejátszó fogadja. */
export async function shareCaptionsSrt(project: Project): Promise<boolean> {
  const cues = project.tracks
    .filter((t) => t.type === 'captions' || t.type === 'text')
    .flatMap((t) => t.clips.filter((c): c is TextClip => c.kind === 'text'))
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((clip) => ({
      start: clip.start,
      end: clip.start + clip.duration,
      text: clip.text,
    }));
  if (cues.length === 0) {
    return false;
  }
  await shareFile(`${project.name}-felirat.srt`, serializeSrt(cues), 'application/x-subrip');
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

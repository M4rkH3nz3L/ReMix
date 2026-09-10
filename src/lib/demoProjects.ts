import { Directory, File, Paths } from 'expo-file-system';
import { t as tr } from 'i18next';
import { Platform } from 'react-native';

import { buildDemoProjects } from '@/lib/demoData';
import type { DemoMedia } from '@/lib/demoData';
import { renderServerUrl } from '@/lib/render';
import { listProjects, saveProject } from '@/lib/storage';
import type { ProgressUpdate } from '@/lib/progress';

/**
 * Demó-projektek (bemutató): egy gombnyomásra több projekt jön létre, amelyek a
 * vided képességeit demonstrálják — kulcskockás mozgás, blur-háttér, maszk,
 * green screen, beat-vágás, animált feliratok, Voice Studio + ducking, 3D
 * döntés + világítás, mozgás-elmosásos speed ramp, freeform maszk, részecskék,
 * valamint márka-intro/outro Sound Design-nal. A médiát a worker tárából tölti
 * le (weben stream-URL-lel); a projekt-építők a demoData.ts-ben vannak (pure,
 * tesztelhető). A már létező (azonos nevű) demók kimaradnak, így egy új
 * kiadás demói a régiek mellé kerülnek be.
 */

async function resolveLibraryFile(id: string): Promise<DemoMedia | null> {
  const base = renderServerUrl();
  try {
    const res = await fetch(`${base}/library`);
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as {
      entries: { id: string; url: string; duration?: number }[];
    };
    const entry = body.entries.find((e) => e.id === id);
    if (!entry) {
      return null;
    }
    const remote = `${base}${entry.url}`;
    const duration = entry.duration ?? 5;
    if (Platform.OS === 'web') {
      return { uri: remote, duration, provider: 'remote' };
    }
    const dir = new Directory(Paths.document, 'media');
    if (!dir.exists) {
      dir.create();
    }
    const target = new File(dir, `lib_${id.replace(/[^\p{L}\p{N}._-]+/gu, '-')}`);
    if (target.exists) {
      return { uri: target.uri, duration, provider: 'library' };
    }
    const file = await File.downloadFileAsync(remote, target);
    return { uri: file.uri, duration, provider: 'library' };
  } catch {
    return null;
  }
}

/**
 * Demó-projektek létrehozása: média letöltése a worker tárából, projektek
 * összeállítása és mentése. A már létező (azonos nevű) demók kimaradnak.
 * @returns a létrehozott projektek száma
 */
export async function createDemoProjects(
  onProgress?: (u: ProgressUpdate) => void
): Promise<number> {
  onProgress?.({ phase: tr('lib.demoProjects.phaseDownloadMedia'), ratio: 0.1 });
  const [szines, fraktal, zold, beszed, zene, voice, whoosh, click] =
    await Promise.all([
      resolveLibraryFile('demo-szines.mp4'),
      resolveLibraryFile('demo-fraktal.mp4'),
      resolveLibraryFile('demo-zold.mp4'),
      resolveLibraryFile('demo-beszed.mp4'),
      resolveLibraryFile('lofi-demo.m4a'),
      resolveLibraryFile('beszed-voice.m4a'),
      resolveLibraryFile('sfx-whoosh.m4a'),
      resolveLibraryFile('sfx-click.m4a'),
    ]);
  if (!szines || !fraktal || !zold || !beszed || !zene || !voice || !whoosh || !click) {
    throw new Error(tr('lib.demoProjects.mediaUnavailable'));
  }

  onProgress?.({ phase: tr('lib.demoProjects.phaseAssembleProjects'), ratio: 0.7 });
  const existing = new Set((await listProjects()).map((m) => m.name));
  const demos = buildDemoProjects({
    szines,
    fraktal,
    zold,
    beszed,
    zene,
    voice,
    whoosh,
    click,
  });
  let created = 0;
  for (const { project, assets } of demos) {
    if (existing.has(project.name)) {
      continue;
    }
    await saveProject({ ...project, assets });
    created++;
  }
  return created;
}

import { Directory, File } from 'expo-file-system';
import { t as tr } from 'i18next';

import { applyCommand } from '@/lib/commands';
import { projectFolderDir, projectMediaDir } from '@/lib/projectFolderClient';
import { localNameFor, relinkCommands, remoteMediaUris } from '@/lib/remoteMedia';
import type { Project } from '@/types/project';

/**
 * 🌐→📁 Export előtt a távoli (http) források letöltése a projekt mappájába és a projekt
 * átkötése (B28). Ha a projekt a szerkesztőben nyitva van, a parancsok a command buson
 * mennek (undo + mentés); különben a visszaadott (átkötött) projekttel renderelünk.
 * Nincs távoli forrás → a projekt változatlanul jön vissza.
 */
export async function localizeRemoteMedia(
  project: Project,
  onProgress?: (u: { phase: string; ratio: number }) => void
): Promise<Project> {
  const uris = remoteMediaUris(project);
  if (uris.length === 0) {
    return project;
  }
  const dir: Directory = project.folder ? projectFolderDir(project.folder) : projectMediaDir();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const map: Record<string, string> = {};
  for (let i = 0; i < uris.length; i++) {
    onProgress?.({ phase: tr('lib.render.phaseDownloadSources'), ratio: i / uris.length });
    const target = new File(dir, localNameFor(uris[i], i));
    if (!target.exists) {
      await File.downloadFileAsync(uris[i], target);
    }
    map[uris[i]] = target.uri;
  }
  const commands = relinkCommands(map);
  // lusta import: a render-lánc ne húzza be a store-t modul-szinten (körkörös import)
  const { useEditorStore } = await import('@/store/editorStore');
  const st = useEditorStore.getState();
  if (st.project?.id === project.id) {
    st.applyBatch(commands, 'user');
    return useEditorStore.getState().project ?? project;
  }
  return commands.reduce((p, c) => applyCommand(p, c) ?? p, project);
}

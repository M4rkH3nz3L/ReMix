import { getInfoAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import type { Asset, Project } from '@/types/project';

/**
 * File identity (full-plan F2): a médiafájlok tartalom-alapú azonosítója
 * (md5 + méret) — az asset-registry-ben utazik a .vided exporttal, így másik
 * eszközön a hiányzó média név helyett TARTALOM szerint ismerhető fel
 * (autoRelink a videdFile.ts-ben).
 */

export interface FileFingerprint {
  hash?: string;
  size?: number;
}

export async function fingerprintFile(uri: string): Promise<FileFingerprint | null> {
  if (Platform.OS === 'web' || uri.startsWith('http')) {
    return null;
  }
  try {
    const info = await getInfoAsync(uri, { md5: true });
    if (!info.exists) {
      return null;
    }
    return { hash: info.md5, size: info.size };
  } catch {
    return null;
  }
}

/**
 * Export előtt: minden helyi assethez md5+méret. Egyszeri költség a
 * megosztáskor — a munkaprojektet (és az undo-történetet) nem érinti.
 */
export async function withFingerprints(project: Project): Promise<Project> {
  const assets: Asset[] = [];
  let changed = false;
  for (const asset of project.assets) {
    if (asset.hash && asset.size) {
      assets.push(asset);
      continue;
    }
    const fp = await fingerprintFile(asset.uri);
    if (fp) {
      assets.push({ ...asset, hash: fp.hash ?? asset.hash, size: fp.size ?? asset.size });
      changed = true;
    } else {
      assets.push(asset);
    }
  }
  return changed ? { ...project, assets } : project;
}

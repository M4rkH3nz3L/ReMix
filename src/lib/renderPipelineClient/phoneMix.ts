// 🎧 A felhő-render hangja: a telefonon kevert köztes WAV (ha elkészülhet).
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { ProgressUpdate } from '@/lib/progress';
import type { Project } from '@/types/project';
import { logCaught } from '@/lib/logCaught';
import { RenderCancelledError } from '@/lib/renderPipeline/cancel';

/**
 * 🎧 A projekt keverése a telefonon, 32 bites lebegőpontos WAV-ba (a Pro export köztes fájlja).
 * null, ha nem készülhet el (a szerver keveri).
 */
export async function phoneMixFile(project: Project, onProgress?: (u: ProgressUpdate) => void, signal?: AbortSignal): Promise<File | null> {
  if (Platform.OS === 'web') {
    return null;
  }
  try {
    const [{ offlineMixPlan }, { exportOfflineWav, OFFLINE_MAX_SEC }] = await Promise.all([
      import('@/lib/offlineMix'),
      import('@/lib/offlineMixClient'),
    ]);
    const plan = offlineMixPlan(project);
    const { longUris } = await import('@/lib/longSource');
    const { needsWholeWindow } = await import('@/lib/offlineMix');
    const long = longUris(plan.clips);
    // a hosszú forrás egész-ablakos feldolgozása a telefonon nem fér bele: ilyenkor a szerver keveri
    if (plan.clips.length === 0 || plan.duration > OFFLINE_MAX_SEC || plan.clips.some((c) => !c.uri.startsWith('file:') || (long.has(c.uri) && needsWholeWindow(c)))) {
      return null;
    }
    const target = new File(Paths.cache, `remix_mix_${Date.now()}.wav`);
    await exportOfflineWav(project, target, onProgress, signal, 'float32');
    return target;
  } catch (caught) {
    if (signal?.aborted) {
      throw new RenderCancelledError();
    }
    // a telefonos keverés hibája nem állítja meg az exportot: a szerver keveri (régi út)
    logCaught('lib/render.ts:phoneMixFile', caught);
    return null;
  }
}

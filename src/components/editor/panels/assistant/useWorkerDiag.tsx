import { File } from 'expo-file-system';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { firstVideoClip } from '@/lib/assistantPanelOps';
import { logCaught } from '@/lib/logCaught';
import { renderServerUrl } from '@/lib/render';
import { uploadFetch } from '@/lib/upload';
import { useEditorStore } from '@/store/editorStore';

/**
 * worker-diagnosztika: mit hív a kliens, és eléri-e (a „nem érhető el”
 * hibák oka azonnal látszik: rossz URL vs. nem futó worker vs. hálózat)
 */
export function useWorkerDiag(t: TFunction): string {
  const [workerDiag, setWorkerDiag] = useState<string>(t('panels.assistant.workerChecking'));
  // 🤖 melyik AI-modell oldja meg a feladatot (a profilban felvett modellek közül);
  useEffect(() => {
    let alive = true;
    const base = renderServerUrl();
    // az első videóklip fájlja megvan-e — konténer-költözésnél (Expo Go
    // frissítés/újratelepítés) a mentett file:// utak elszakadnak, és minden
    // feltöltés némán elhasal, miközben a worker elérhető
    let fileInfo = '';
    if (Platform.OS !== 'web') {
      const project = useEditorStore.getState().project;
      const firstVideo = firstVideoClip(project);
      if (firstVideo && firstVideo.kind === 'video') {
        try {
          fileInfo = new File(firstVideo.uri).exists
            ? t('panels.assistant.mediaOk')
            : t('panels.assistant.mediaMissing');
        } catch (caught) {
          logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', caught);
          fileInfo = t('panels.assistant.mediaUncheckable');
        }
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    fetch(`${base}/health`, { signal: controller.signal })
      .then((res) => {
        if (alive) {
          setWorkerDiag(
            t('panels.assistant.workerStatus', {
              base,
              status: res.ok
                ? t('panels.assistant.workerReachable')
                : t('panels.assistant.workerHttpError', { status: res.status }),
              fileInfo,
            })
          );
        }
      })
      .catch((caught) => {
      logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', caught);
        if (alive) {
          setWorkerDiag(
            t('panels.assistant.workerStatus', {
              base,
              status: t('panels.assistant.workerUnreachable'),
              fileInfo,
            })
          );
        }
      })
      .finally(() => clearTimeout(timer));

    // automatikus feltöltés-próba: ugyanazzal a mintával, mint az elemzők —
    // ha ez elhasal, a diag-sor a PONTOS kliens-hibaüzenetet mutatja
    if (Platform.OS !== 'web') {
      const project = useEditorStore.getState().project;
      const probeVideo = firstVideoClip(project);
      if (probeVideo && probeVideo.kind === 'video') {
        const form = new FormData();
        form.append('media', new File(probeVideo.uri) as unknown as Blob, 'probe.mp4');
        form.append('atSec', '0');
        uploadFetch(`${base}/color/stats`, { method: 'POST', body: form })
          .then((r) => {
            if (alive) {
              setWorkerDiag(
                (prev) =>
                  `${prev}\n` +
                  t('panels.assistant.uploadProbe', {
                    result: r.ok
                      ? t('panels.assistant.uploadProbeOk')
                      : t('panels.assistant.uploadProbeHttpError', { status: r.status }),
                  })
              );
            }
          })
          .catch((e) => {
          logCaught('components/editor/panels/AssistantPanel.tsx:AssistantPanel', e);
            console.warn('feltöltés-próba hiba:', (e as Error).message);
            if (alive) {
              setWorkerDiag(
                (prev) =>
                  `${prev}\n` +
                  t('panels.assistant.uploadProbeError', { message: (e as Error).message })
              );
            }
          });
      }
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- csak mount-kor futó worker-diagnosztika; a t stabil referencia (i18next)
  }, []);
  return workerDiag;
}

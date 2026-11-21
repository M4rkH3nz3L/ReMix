import { File } from 'expo-file-system';

import { clipTimelineDuration, recordedSourceDuration } from '@/lib/cameraRecorderOps';
import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { ensureProxy } from '@/lib/proxy';
import { useEditorStore } from '@/store/editorStore';
import type { FilterId } from '@/types/project';

/**
 * 🎥 A felvett klip mentése a projekt-mappába és a videósáv végére tétele (REFACTOR: a
 * CameraRecorder.tsx saveAndAdd-je). A sebességet és a szűrőt a hívó adja — ugyanazokat az
 * értékeket, amiket az eredeti closure látott. A logCaught-címke az eredeti ujjlenyomat.
 */
export const saveRecordingToProject = async (uri: string, recorded: number, speed: number, filterId: FilterId) => {
  const project = useEditorStore.getState().project;
  if (!project) {
    return;
  }
  const dir = projectMediaDir();
  try {
    dir.create();
  } catch (caught) {
    logCaught('components/editor/CameraRecorder.tsx:saveAndAdd', caught);
    /* már létezik */
  }
  const target = new File(dir, `rec_${makeId('v')}.mp4`);
  try {
    new File(uri).copy(target);
  } catch (caught) {
    logCaught('components/editor/CameraRecorder.tsx:saveAndAdd', caught);
    /* ha a másolás nem megy, a cache-uri marad */
  }
  const finalUri = target.exists ? target.uri : uri;
  const src = recordedSourceDuration(recorded);
  // a sebesség a klip idővonal-hosszát rövidíti (2× → fele annyi idő), a
  // választott szűrő a klipre kerül és a renderben ég be
  ensureProxy(finalUri).catch((caught) => { logCaught('components/editor/CameraRecorder.tsx:saveAndAdd', caught); });
  useEditorStore.getState().addClip(
    'video',
    {
      kind: 'video',
      id: makeId('clip'),
      start: trackEnd(trackOf(project, 'video')),
      duration: clipTimelineDuration(src, speed),
      uri: finalUri,
      trimIn: 0,
      sourceDuration: src,
      speed,
      volume: 1,
      filterId,
    },
    { id: makeId('ast'), kind: 'video', uri: finalUri, provider: 'local', duration: src }
  );
};

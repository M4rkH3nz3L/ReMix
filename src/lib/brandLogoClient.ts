import { aspectValue } from '@/constants/editor';
import { brandLogoWatermark, buildWatermarkClip } from '@/lib/brandKit';
import { makeId } from '@/lib/id';
import { projectMediaDir } from '@/lib/projectFolderClient';
import { projectDuration } from '@/lib/projectUtils';
import { copyBrandLogoInto } from '@/store/brandStyleStore';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🏷️ S11: a márka-logó vízjelként a nyitott videó-projektre (jobb alsó sarok, az egész videón) — a fájl a
 * projektbe MÁSOLVA, egy parancs (egy visszavonás). `false`, ha nincs projekt vagy a logó fájlja.
 */
export function insertBrandLogoWatermark(uri: string, name: string): boolean {
  const state = useEditorStore.getState();
  const project = state.project;
  if (!project) return false;
  const copy = copyBrandLogoInto(projectMediaDir(), uri);
  if (!copy) return false;
  const clip = buildWatermarkClip(brandLogoWatermark(copy, aspectValue(project.aspectRatio)), projectDuration(project), makeId('clip'));
  return state.dispatch({ type: 'ADD_CLIP', trackType: 'overlay', clip, asset: { id: makeId('ast'), kind: 'image', uri: copy, provider: 'local', name } }, 'user');
}

import type { Ionicons } from '@expo/vector-icons';
import type { TFunction } from 'i18next';
import type { ComponentProps } from 'react';

import type { ToolId } from '@/lib/toolbarSpec';
import type { TutorialTargetId } from '@/lib/tutorial';
import type { EditorState, PanelId } from '@/store/editorStore';
import type { Clip } from '@/types/project';

import type { createAddClipActions } from './addClipActions';
import type { createClipActions } from './clipActions';

/** egy eszköz definíciója: vagy panelt vált (`panel`), vagy akciót futtat (`onPress`) */
export interface ToolDef {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  panel?: NonNullable<PanelId>;
  onPress?: () => void;
  active?: boolean;
  tutorialId?: TutorialTargetId;
}

/** a regiszter bemenete: a gyökér állapota és akciói */
export interface ToolRegistryDeps {
  t: TFunction;
  selected: Clip | null;
  multi: boolean;
  batchCount: number;
  multiSelectMode: boolean;
  rippleMode: boolean;
  add: ReturnType<typeof createAddClipActions>;
  clip: ReturnType<typeof createClipActions>;
  setShowCamera: (v: boolean) => void;
  setShowSource: (v: boolean) => void;
  setShowHelp: (v: boolean) => void;
  linkSelected: EditorState['linkSelected'];
  preCompose: EditorState['preCompose'];
  unlinkClip: EditorState['unlinkClip'];
}

/**
 * 🧰 Az eszközök regisztere (MOBILE-UI §6.4) — MIT csinál egy eszköz. Hogy
 * MIKOR és HOL (elöl vagy a „Több" alatt) jelenik meg, azt a pure
 * `toolbarFor()` dönti el a kontextusból (`@/lib/toolbarSpec`, tesztelve).
 */
export function buildToolRegistry({
  t,
  selected,
  multi,
  batchCount,
  multiSelectMode,
  rippleMode,
  add,
  clip,
  setShowCamera,
  setShowSource,
  setShowHelp,
  linkSelected,
  preCompose,
  unlinkClip,
}: ToolRegistryDeps): Record<ToolId, ToolDef> {
  const { addVideo, addText, addImage, addPip, addAdjust, addHotspot } = add;
  const {
    split,
    frameCaptureAction,
    duplicate,
    copyClipsAction,
    cutClipsAction,
    pasteClipsAction,
    copyStyleAction,
    pasteStyleAction,
    moveToNextTrack,
    toggleMultiSelect,
    toggleRipple,
  } = clip;
  const TOOLS: Record<ToolId, ToolDef> = {
    // — kijelölés nélkül —
    addVideo: { icon: 'videocam-outline', label: t('editor.toolbar.video'), onPress: addVideo, tutorialId: 'toolbar.addVideo' },
    addText: { icon: 'text-outline', label: t('editor.toolbar.text'), onPress: addText, tutorialId: 'toolbar.text' },
    music: { icon: 'musical-notes-outline', label: t('editor.toolbar.music'), panel: 'audio', tutorialId: 'toolbar.music' },
    captions: { icon: 'chatbox-ellipses-outline', label: t('editor.toolbar.captions'), panel: 'captions', tutorialId: 'toolbar.captions' },
    addImage: { icon: 'image-outline', label: t('editor.toolbar.image'), onPress: addImage },
    addPip: { icon: 'albums-outline', label: 'PiP', onPress: addPip },
    record: { icon: 'radio-button-on-outline', label: t('editor.toolbar.record'), onPress: () => setShowCamera(true) },
    source: { icon: 'folder-open-outline', label: t('source.title'), onPress: () => setShowSource(true) },
    sticker: { icon: 'happy-outline', label: t('editor.toolbar.sticker'), panel: 'sticker' },
    transcript: { icon: 'reader-outline', label: t('editor.toolbar.transcript'), panel: 'transcript' },
    addGrade: { icon: 'color-filter-outline', label: t('editor.toolbar.grade'), onPress: addAdjust, tutorialId: 'toolbar.grade' },
    imagedoc: { icon: 'layers-outline', label: t('editor.toolbar.layers'), panel: 'imagedoc' },
    library: { icon: 'server-outline', label: t('editor.toolbar.library'), panel: 'library' },
    multicam: { icon: 'videocam-outline', label: t('editor.toolbar.multicam'), panel: 'multicam', tutorialId: 'toolbar.multicam' },
    addHotspot: { icon: 'scan-outline', label: 'Hotspot', onPress: addHotspot },
    assistant: { icon: 'sparkles-outline', label: 'AI', panel: 'assistant', tutorialId: 'toolbar.ai' },
    creatorPreset: { icon: 'bookmarks-outline', label: t('editor.toolbar.creatorPreset'), panel: 'creatorPreset' },
    workflow: { icon: 'git-branch-outline', label: t('editor.toolbar.workflow'), panel: 'workflow' },
    help: { icon: 'help-circle-outline', label: t('editor.toolbar.help'), onPress: () => setShowHelp(true) },
    // — kijelölt klip —
    split: { icon: 'cut-outline', label: t('editor.toolbar.split'), onPress: split },
    speed: { icon: 'speedometer-outline', label: t('editor.toolbar.speed'), panel: 'speed' },
    filter: { icon: 'color-filter-outline', label: t('editor.toolbar.filter'), panel: 'filter' },
    transition: { icon: 'contrast-outline', label: t('editor.toolbar.transition'), panel: 'transition' },
    pip: { icon: 'ellipse-outline', label: t('editor.toolbar.frame'), panel: 'pip' },
    frameCapture: { icon: 'camera-outline', label: t('editor.toolbar.frameCapture'), onPress: frameCaptureAction },
    text: { icon: 'text-outline', label: t('editor.toolbar.text'), panel: 'text' },
    shape: { icon: 'shapes-outline', label: t('editor.toolbar.shape'), panel: 'shape' },
    grade: { icon: 'color-filter-outline', label: t('editor.toolbar.grade'), panel: 'adjust' },
    mix: { icon: 'options-outline', label: t('editor.toolbar.mix'), panel: 'audio' },
    action: { icon: 'link-outline', label: t('editor.toolbar.action'), panel: 'hotspot' },
    precision: { icon: 'timer-outline', label: t('editor.toolbar.precision'), panel: 'precision' },
    duplicate: {
      icon: 'copy-outline',
      label: multi ? t('editor.toolbar.duplicateCount', { count: batchCount }) : t('common.duplicate'),
      onPress: duplicate,
    },
    copyClip: { icon: 'albums-outline', label: t('editor.toolbar.copyClip'), onPress: copyClipsAction },
    cutClip: { icon: 'cut-outline', label: t('editor.toolbar.cutClip'), onPress: cutClipsAction },
    pasteClip: { icon: 'clipboard-outline', label: t('editor.toolbar.pasteClip'), onPress: pasteClipsAction },
    copyStyle: { icon: 'clipboard-outline', label: t('editor.toolbar.copyStyle'), onPress: copyStyleAction },
    pasteStyle: {
      icon: 'color-wand-outline',
      label: multi ? t('editor.toolbar.pasteStyleCount', { count: batchCount }) : t('editor.toolbar.pasteStyle'),
      onPress: pasteStyleAction,
    },
    moveTrack: { icon: 'swap-vertical-outline', label: t('editor.toolbar.moveTrack'), onPress: moveToNextTrack },
    multiSelect: {
      icon: multiSelectMode ? 'checkmark-done' : 'checkmark-done-outline',
      label: multiSelectMode
        ? t('editor.toolbar.multiSelectActive', { count: batchCount })
        : t('editor.toolbar.multiSelect'),
      onPress: toggleMultiSelect,
      active: multiSelectMode,
    },
    ripple: {
      icon: rippleMode ? 'git-commit' : 'git-commit-outline',
      label: t('editor.toolbar.ripple'),
      onPress: toggleRipple,
      active: rippleMode,
    },
    link: { icon: 'link', label: t('editor.toolbar.link'), onPress: linkSelected },
    precompose: { icon: 'cube-outline', label: t('editor.toolbar.precompose'), onPress: preCompose },
    unlink: { icon: 'unlink', label: t('editor.toolbar.unlink'), onPress: () => selected && unlinkClip(selected.id) },
  };
  return TOOLS;
}

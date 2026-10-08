import { useEffect } from 'react';
import { Platform } from 'react-native';

import { resolveShortcut, type EditorShortcut } from '@/lib/editorKeymap';
import { frameDuration, projectFps } from '@/lib/frames';
import { findClip } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, TrackType } from '@/types/project';

/**
 * ⌨️ A szerkesztő billentyű-parancskészletének BEKÖTÉSE (EDITOR-UX §2.7).
 *
 * A leképezés magja a pure `resolveShortcut` ([editorKeymap.ts]); ez a réteg
 * csak a billentyűt fogja be (web / tablet-billentyűzet) és a feloldott akciót
 * a store-on futtatja. Natíven no-op (ott a gesztusok + a help-overlay vezetnek).
 */

// A vágólap-fajtához illő alap cél-sáv — a Toolbar paste-logikáját tükrözi.
const PASTE_FALLBACK: Record<Clip['kind'], TrackType> = {
  video: 'video',
  image: 'video',
  audio: 'music',
  text: 'text',
  shape: 'overlay',
  adjust: 'adjust',
  interactive: 'interactive',
};

/** Egy feloldott akció végrehajtása a store-on (a billentyű = a gomb). */
export function runEditorShortcut(action: EditorShortcut): void {
  const s = useEditorStore.getState();
  if (!s.project) {
    return;
  }
  const step = frameDuration(projectFps(s.project));
  switch (action) {
    case 'playPause':
      s.setPlaying(!s.isPlaying);
      break;
    case 'stop':
      s.setPlaying(false);
      break;
    case 'jogForward':
      s.setPlaying(true);
      break;
    case 'jogBack':
      // nincs visszafelé-lejátszás → megállunk és egy frame-et hátralépünk
      s.setPlaying(false);
      s.setPlayhead(s.playhead - step, true);
      break;
    case 'frameBack':
      s.setPlaying(false);
      s.setPlayhead(s.playhead - step, true);
      break;
    case 'frameForward':
      s.setPlaying(false);
      s.setPlayhead(s.playhead + step, true);
      break;
    case 'setIn':
      s.setRangeIn();
      break;
    case 'setOut':
      s.setRangeOut();
      break;
    case 'split':
      if (s.selectedClipId) {
        s.splitClipAt(s.selectedClipId, s.playhead);
      }
      break;
    case 'delete':
      if (s.rangeIn != null && s.rangeOut != null) {
        s.deleteRange();
      } else if (s.selectedClipId) {
        s.removeClip(s.selectedClipId);
      }
      break;
    case 'undo':
      s.undo();
      break;
    case 'redo':
      s.redo();
      break;
    case 'copy':
      s.copyClips();
      break;
    case 'cut':
      s.cutClips();
      break;
    case 'paste': {
      const cb = s.clipClipboard;
      if (!cb) {
        break;
      }
      const selectedTrack = s.selectedClipId
        ? findClip(s.project, s.selectedClipId)?.track.type
        : undefined;
      s.pasteClipsAt(selectedTrack ?? PASTE_FALLBACK[cb.kind], s.playhead);
      break;
    }
  }
}

// A DOM `KeyboardEvent` részhalmaza — nem hozunk be `lib.dom`-függőséget.
interface DomKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
  preventDefault: () => void;
}

type KeyListener = (e: DomKeyEvent) => void;

const dom = globalThis as unknown as {
  addEventListener?: (type: string, cb: KeyListener) => void;
  removeEventListener?: (type: string, cb: KeyListener) => void;
};

export function useEditorKeyboard(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !dom.addEventListener) {
      return;
    }
    const handler: KeyListener = (e) => {
      const tag = e.target?.tagName;
      const inTextInput =
        tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(e.target?.isContentEditable);
      const action = resolveShortcut({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        inTextInput,
      });
      if (!action) {
        return;
      }
      e.preventDefault();
      runEditorShortcut(action);
    };
    dom.addEventListener('keydown', handler);
    return () => dom.removeEventListener?.('keydown', handler);
  }, []);
}

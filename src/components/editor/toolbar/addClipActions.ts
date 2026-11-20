import type { TFunction } from 'i18next';

import { makeId } from '@/lib/id';
import { logCaught } from '@/lib/logCaught';
import { pickImage, pickVideo } from '@/lib/media';
import { trackEnd, trackOf } from '@/lib/projectUtils';
import { ensureProxy } from '@/lib/proxy';
import { adjustStartFor, pipCornerFor } from '@/lib/toolbarOps';
import { useEditorStore, type EditorState } from '@/store/editorStore';

/** a hozzáadó akciók a gyökér store-szelektoraiból élnek */
export interface AddClipActionDeps {
  t: TFunction;
  addClip: EditorState['addClip'];
  setPanel: EditorState['setPanel'];
  selectClip: EditorState['selectClip'];
}

/**
 * ➕ Kijelölés nélküli hozzáadás-műveletek: videó, PiP, kép, szöveg, hotspot,
 * grade-réteg — mind a store `addClip`-jén át (command bus, undo).
 */
export function createAddClipActions({ t, addClip, setPanel, selectClip }: AddClipActionDeps) {
  const addVideo = async () => {
    const picked = await pickVideo();
    if (!picked) {
      return;
    }
    const { project } = useEditorStore.getState();
    if (!project) {
      return;
    }
    const duration = picked.duration > 0 ? picked.duration : 5;
    addClip(
      'video',
      {
        kind: 'video',
        id: makeId('clip'),
        start: trackEnd(trackOf(project, 'video')),
        duration,
        uri: picked.uri,
        trimIn: 0,
        sourceDuration: duration,
        speed: 1,
        volume: 1,
        filterId: 'none',
      },
      {
        id: makeId('ast'),
        kind: 'video',
        uri: picked.uri,
        provider: 'local',
        duration,
        width: picked.width,
        height: picked.height,
      }
    );
    // a 720p vágási proxy már készülhet, mire lejátszásra kerül
    ensureProxy(picked.uri).catch((caught) => { logCaught('components/editor/Toolbar.tsx:addVideo', caught); });
  };

  // 🎬 PiP: a videó a PIP-sávra kerül a lejátszófejnél, alap kis mérettel (jobb-fent)
  // — a fő videó FÖLÉ overlay-eződik; húzással/csippentéssel áthelyezhető/méretezhető.
  const addPip = async () => {
    const picked = await pickVideo();
    if (!picked) {
      return;
    }
    const { project, playhead } = useEditorStore.getState();
    if (!project) {
      return;
    }
    const source = picked.duration > 0 ? picked.duration : 5;
    const duration = Math.min(source, 10);
    // több PiP esetén a következő másik sarokba kerül (ne fedjék pontosan egymást)
    const corner = pipCornerFor(project);
    addClip(
      'pip',
      {
        kind: 'video',
        id: makeId('clip'),
        start: playhead,
        duration,
        uri: picked.uri,
        trimIn: 0,
        sourceDuration: source,
        speed: 1,
        volume: 1,
        filterId: 'none',
        transform: { scale: 0.32, x: corner.x, y: corner.y },
      },
      {
        id: makeId('ast'),
        kind: 'video',
        uri: picked.uri,
        provider: 'local',
        duration: source,
        width: picked.width,
        height: picked.height,
      }
    );
    ensureProxy(picked.uri).catch((caught) => { logCaught('components/editor/Toolbar.tsx:addPip', caught); });
  };

  const addImage = async () => {
    const picked = await pickImage();
    if (!picked) {
      return;
    }
    const { project } = useEditorStore.getState();
    if (!project) {
      return;
    }
    addClip(
      'video',
      {
        kind: 'image',
        id: makeId('clip'),
        start: trackEnd(trackOf(project, 'video')),
        duration: 4,
        uri: picked.uri,
        filterId: 'none',
      },
      { id: makeId('ast'), kind: 'image', uri: picked.uri, provider: 'local' }
    );
  };

  const addText = () => {
    const { playhead } = useEditorStore.getState();
    addClip('text', {
      kind: 'text',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      text: t('editor.toolbar.newTextDefault'),
      color: '#ffffff',
      backgroundColor: null,
      fontSize: 7,
      fontWeight: 'bold',
      position: { x: 0.5, y: 0.5 },
      animation: 'fade',
    });
    setPanel('text');
  };

  const addHotspot = () => {
    const { playhead } = useEditorStore.getState();
    addClip('interactive', {
      kind: 'interactive',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      label: 'Hotspot',
      rect: { x: 0.35, y: 0.4, w: 0.3, h: 0.2 },
      // üres URL: a panel placeholderje (https://…) vezeti a felhasználót, és a
      // validáció addig üres/érvénytelen linknek jelzi, míg valódi címet nem ad meg
      action: { type: 'url', url: '' },
    });
    setPanel('hotspot');
  };

  // 🎨 Grade-réteg: az adjust-sávra kerül a lejátszófejnél; a saját szakaszában
  // az ALATTA lévő teljes kompozitra ad nem-destruktív színkorrekciót (CapCut-minta).
  const addAdjust = () => {
    const { project, playhead } = useEditorStore.getState();
    if (!project) {
      return;
    }
    // védett: régi projektben hiányozhat az adjust-sáv (a migráció pótolja, de
    // ne dobjunk, ha valamiért mégsem — a lejátszófejnél kezdünk)
    const track = project.tracks.find((t) => t.type === 'adjust');
    if (!track) {
      return;
    }
    // enyhe alap-grade, hogy rögtön látszódjon a réteg hatása (finomítható)
    const start = adjustStartFor(track, playhead);
    const id = makeId('clip');
    addClip('adjust', {
      kind: 'adjust',
      id,
      start,
      duration: 4,
      adjust: { contrast: 0.08, saturation: 0.1 },
    });
    selectClip(id);
    setPanel('adjust');
  };

  return { addVideo, addPip, addImage, addText, addHotspot, addAdjust };
}

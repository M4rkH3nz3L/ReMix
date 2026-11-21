import type { TFunction } from 'i18next';
import { Alert, Image as RNImage } from 'react-native';

import { aspectValue } from '@/constants/editor';
import { fetchFaces, pickPrimaryFace } from '@/lib/faceClient';
import { makeId } from '@/lib/id';
import { pickImage } from '@/lib/media';
import { activeVisualClip, sourceTimeAt } from '@/lib/projectUtils';
import {
  faceStickerLayout,
  imageAspect,
  logoHeight,
  shapeDefaults,
  type StickerShape,
} from '@/lib/stickerPanelOps';
import { downloadSticker3d } from '@/lib/stickers3d';
import type { Sticker3DEntry } from '@/lib/stickers3d';
import type { EditorState } from '@/store/editorStore';
import { useEditorStore } from '@/store/editorStore';

/**
 * A matrica-panel hook nélküli akció-gyára (REFACTOR: a StickerPanel.tsx-ből): a
 * gyökér állapotát és settereit kapja, a store-t a hívás pillanatában olvassa.
 */
export interface StickerActionDeps {
  t: TFunction;
  addClip: EditorState['addClip'];
  setPanel: EditorState['setPanel'];
  busy3d: string | null;
  setBusy3d: (id: string | null) => void;
  material: string;
  environment: string;
  faceBusy: string | null;
  setFaceBusy: (emoji: string | null) => void;
}

export function createStickerActions({
  t,
  addClip,
  setPanel,
  busy3d,
  setBusy3d,
  material,
  environment,
  faceBusy,
  setFaceBusy,
}: StickerActionDeps) {
  const addSticker3d = async (entry: Sticker3DEntry) => {
    if (busy3d) {
      return;
    }
    setBusy3d(entry.id);
    const uri = await downloadSticker3d(entry, { material, environment });
    setBusy3d(null);
    if (!uri) {
      Alert.alert(t('panels.sticker.object3dTitle'), t('panels.sticker.object3dDownloadFailed'));
      return;
    }
    const { playhead, selectClip } = useEditorStore.getState();
    const id = makeId('clip');
    const w = 0.34;
    addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: playhead,
        duration: 4,
        shape: 'rectangle',
        position: { x: 0.5, y: 0.4 },
        w,
        // négyzetes PNG a 9:16 vásznon: a magasság-arányt a vászon-arány korrigálja
        h: w * 0.5625,
        fill: 'transparent',
        imageUri: uri,
        // 🌒 a 3D objektum alapból vet árnyékot a videóra: ettől „ül" a
        // jelenetben ahelyett, hogy rá lenne ragasztva. A sziluettet követi
        // (a render drop-shadow-ja), a Forma panelen kikapcsolható.
        shadow: true,
      },
      {
        id: makeId('ast'),
        kind: 'image',
        uri,
        provider: 'local',
        name: entry.label,
      }
    );
    selectClip(id);
    setPanel('shape');
  };

  /** 🙂 arc-matrica: az emoji az arcra kerül, és a követés rá is fut */
  const addFaceSticker = async (emoji: string) => {
    const state = useEditorStore.getState();
    if (!state.project || faceBusy) {
      return;
    }
    const video = activeVisualClip(state.project, state.playhead);
    if (!video || video.kind !== 'video') {
      Alert.alert(t('panels.sticker.faceStickerTitle'), t('panels.sticker.faceStickerNeedVideo'));
      return;
    }
    setFaceBusy(emoji);
    try {
      const ar = aspectValue(state.project.aspectRatio);
      const faces = await fetchFaces(video.uri, {
        atSec: sourceTimeAt(video, state.playhead),
        aspectW: ar,
        aspectH: 1,
      });
      const face = faces ? pickPrimaryFace(faces) : null;
      if (!face) {
        Alert.alert(
          t('panels.sticker.faceStickerTitle'),
          faces === null
            ? t('panels.sticker.faceDetectorUnavailable')
            : t('panels.sticker.faceNotFound')
        );
        return;
      }
      const id = makeId('clip');
      const layout = faceStickerLayout(face, video, state.playhead);
      // az arc fölé kerül (a homlok/haj vonalába), az arc méretéhez igazítva
      state.addClip('overlay', {
        kind: 'text',
        id,
        start: state.playhead,
        duration: layout.duration,
        text: emoji,
        color: '#ffffff',
        backgroundColor: null,
        fontSize: layout.fontSize,
        fontWeight: 'normal',
        position: layout.position,
        animation: 'pop',
        stylePreset: 'plain',
      });
      state.selectClip(id);
      Alert.alert(
        t('panels.sticker.faceStickerDoneTitle'),
        t('panels.sticker.faceStickerDoneBody')
      );
    } finally {
      setFaceBusy(null);
    }
  };

  const addSticker = (emoji: string) => {
    const { playhead } = useEditorStore.getState();
    addClip('overlay', {
      kind: 'text',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      text: emoji,
      color: '#ffffff',
      backgroundColor: null,
      fontSize: 12,
      fontWeight: 'normal',
      position: { x: 0.5, y: 0.35 },
      animation: 'pop',
      stylePreset: 'plain',
    });
    setPanel(null);
  };

  const addShape = (shape: StickerShape) => {
    const { playhead, selectClip } = useEditorStore.getState();
    const id = makeId('clip');
    const geo = shapeDefaults(shape);
    addClip('overlay', {
      kind: 'shape',
      id,
      start: playhead,
      duration: 3,
      shape,
      position: { x: 0.5, y: 0.5 },
      w: geo.w,
      h: geo.h,
      fill: geo.fill,
      cornerRadius: geo.cornerRadius,
    });
    selectClip(id);
    setPanel('shape');
  };

  /** logó/kép beszúrása overlay-rétegként — aspect-helyes kezdőmérettel */
  const addLogo = async () => {
    const picked = await pickImage();
    if (!picked) {
      return;
    }
    const { playhead, selectClip } = useEditorStore.getState();
    // a kép arányához igazított kezdőméret (0.3 vászon-szélesség)
    const aspect = await new Promise<number>((resolve) => {
      RNImage.getSize(
        picked.uri,
        (w, h) => resolve(imageAspect(w, h)),
        () => resolve(1)
      );
    });
    const w = 0.3;
    // vászon 9:16 → a magasság-arányt a vászon-arány korrigálja közelítőleg
    const h = logoHeight(w, aspect);
    const id = makeId('clip');
    addClip(
      'overlay',
      {
        kind: 'shape',
        id,
        start: playhead,
        duration: 4,
        shape: 'rectangle',
        position: { x: 0.5, y: 0.35 },
        w,
        h,
        fill: 'transparent',
        imageUri: picked.uri,
      },
      {
        id: makeId('ast'),
        kind: 'image',
        uri: picked.uri,
        provider: 'local',
        name: t('panels.sticker.logoName'),
      }
    );
    selectClip(id);
    setPanel('shape');
  };

  return { addSticker3d, addFaceSticker, addSticker, addShape, addLogo };
}

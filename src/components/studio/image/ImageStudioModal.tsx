import { useEffect } from 'react';
import { Modal } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ImageStudioBody } from '@/components/studio/image/ImageStudioBody';
import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { useEditorStore } from '@/store/editorStore';
import type { Clip, ImageClip, ImageDoc, PhotoLayer } from '@/types/project';

/**
 * 🖼️ A KÖZÖS kép-stúdió a videó-editorból (scoped mód). A régi, DESTRUKTÍV
 * `ImageStudio` helyére lép: ugyanaz az `ImageStudioBody` fut, csak Modalként a
 * kiválasztott kép-klip RÉTEG-FÁJÁN. Nyitáskor, ha a klipnek még nincs
 * dokumentuma, becsomagoljuk egy `ImageDoc`-ba (teljes-vásznas fotó-réteg) — így
 * a sima kép is réteges, nem-destruktív szerkesztést kap. Mentéskor a fát
 * kirasterizáljuk, és a klip `uri`-ját + `docId`-ját visszaírjuk (egy undo-lépés).
 */
export function ImageStudioModal() {
  const clipId = useEditorStore((s) => s.imageStudioClipId);
  const project = useEditorStore((s) => s.project);
  const close = useEditorStore((s) => s.closeImageStudio);

  let clip: Clip | null = null;
  if (clipId && project) {
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found) {
        clip = found;
        break;
      }
    }
  }
  const open = clip?.kind === 'image';
  const imageClip = open ? (clip as ImageClip) : null;

  // nyitáskor gondoskodunk a szerkeszthető réteg-fáról (ha még nincs). A klipet a
  // store-ból oldjuk fel (nem a záró változóból) — így nincs elavult-dep figyelmeztetés.
  useEffect(() => {
    if (!open || !clipId) {
      return;
    }
    const s = useEditorStore.getState();
    const proj = s.project;
    if (!proj) {
      return;
    }
    let target: ImageClip | null = null;
    for (const track of proj.tracks) {
      const found = track.clips.find((c) => c.id === clipId);
      if (found?.kind === 'image') {
        target = found;
      }
      if (found) {
        break;
      }
    }
    if (!target) {
      return;
    }
    const hasDoc = target.docId && proj.imageDocs?.some((d) => d.id === target.docId);
    if (hasDoc) {
      return;
    }
    // sima kép becsomagolása: háttér-fill + teljes-vásznas fotó-réteg a klip
    // aktuális uri-jából (a meglévő szűrő/korrekció átöröklődik a rétegre)
    const base = createImageDoc(proj.name, proj.aspectRatio, () => makeId('lyr'));
    const photo: PhotoLayer = {
      kind: 'photo',
      id: makeId('lyr'),
      uri: target.uri,
      assetId: target.assetId,
      position: { x: 0.5, y: 0.5 },
      w: 1,
      h: 1,
      fit: 'cover',
      filterId: target.filterId,
      filterIntensity: target.filterIntensity,
      adjust: target.adjust,
    };
    const withPhoto = addLayer(base, photo);
    // EGY undo-lépés: a doc + a klip vissza-hivatkozása
    s.applyBatch(
      [
        { type: 'UPSERT_IMAGE_DOC', doc: withPhoto },
        { type: 'UPDATE_CLIP', clipId: target.id, patch: { docId: withPhoto.id } },
      ],
      'user'
    );
  }, [open, clipId]);

  // a raszterizálást a TÖRZS végzi (worker → captureRef fallback); itt csak
  // visszaírjuk az új PNG-t + a docId-t a klipre (a docId a nyitáskor már beállt)
  const saveScoped = async (doc: ImageDoc, uri: string | null) => {
    if (clipId) {
      useEditorStore.getState().updateClip(clipId, uri ? { uri, docId: doc.id } : { docId: doc.id });
    }
    close();
  };

  return (
    <Modal visible={open} animationType="slide" onRequestClose={close}>
      {open && imageClip ? (
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider initialMetrics={initialWindowMetrics}>
            <SafeAreaView style={{ flex: 1, backgroundColor: '#05060a' }} edges={['top', 'bottom']}>
              <ImageStudioBody
                mode="scoped"
                docId={imageClip.docId}
                title={project?.name ?? ''}
                onExit={close}
                onSave={saveScoped}
              />
            </SafeAreaView>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      ) : null}
    </Modal>
  );
}

import { type Ref, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ShapeOverlay } from '@/components/preview/ShapeOverlay';
import { TextOverlay } from '@/components/preview/TextOverlay';
import { FillLayerView } from '@/components/studio/image/FillLayerView';
import { PhotoLayerView } from '@/components/studio/image/PhotoLayerView';
import { SelectionFrame } from '@/components/studio/image/SelectionFrame';
import { aspectValue, palette } from '@/constants/editor';
import { updateLayer, visibleLayers } from '@/lib/imageDoc';
import { layerToShapeClip, layerToTextClip, type LivePatch } from '@/lib/imageLayerClip';
import type { ImageDoc, ImageLayer } from '@/types/project';

function withLive(layer: ImageLayer, patch: LivePatch): ImageLayer {
  return { ...layer, ...patch } as ImageLayer;
}

/**
 * 🖼️ A Kép Stúdió VÁSZNA — a látható rétegeket ALULRÓL FÖLFELÉ rajzolja,
 * PONTOSAN a timeline-előnézet komponenseivel (ShapeOverlay/TextOverlay) →
 * render-paritás. A rétegek húzhatók (move), a kijelölt réteg mérete/forgatása a
 * kijelölő-kereten. Minden módosítás a command-buson megy (undo).
 */
export function ImageCanvas({
  doc,
  selectedId,
  onSelect,
  onRequestEdit,
  commit,
  canvasRef,
  capturing,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRequestEdit?: (id: string) => void;
  commit: (next: ImageDoc, label?: string) => void;
  /** a vászon View-ja — az on-device raszterizáláshoz (captureRef fallback) */
  canvasRef?: Ref<View>;
  /** raszterizálás alatt: a kijelölés-krómot (keret/kijelölő-szegély) elrejtjük */
  capturing?: boolean;
}) {
  const [container, setContainer] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<{ id: string; patch: LivePatch } | null>(null);

  const av = aspectValue(doc.aspectRatio);
  const fit =
    container.w > 0 && container.h > 0
      ? container.w / container.h > av
        ? { w: container.h * av, h: container.h }
        : { w: container.w, h: container.w / av }
      : { w: 0, h: 0 };

  const move = (id: string, position: { x: number; y: number }) =>
    commit(updateLayer(doc, id, { position }), 'move');

  const layers = visibleLayers(doc);
  const selectedLayer = doc.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <View
      style={styles.stage}
      onLayout={(e: LayoutChangeEvent) =>
        setContainer({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })
      }
    >
      {fit.w > 0 ? (
        <View ref={canvasRef} style={[styles.canvas, { width: fit.w, height: fit.h }]}>
          {layers.map((raw) => {
            const l = live?.id === raw.id ? withLive(raw, live.patch) : raw;
            const selected = !capturing && l.id === selectedId;
            if (l.kind === 'fill') {
              return <FillLayerView key={l.id} layer={l} box={fit} onSelect={() => onSelect(l.id)} />;
            }
            if (l.kind === 'photo') {
              return (
                <PhotoLayerView
                  key={l.id}
                  layer={l}
                  box={fit}
                  selected={selected}
                  onSelect={onSelect}
                  onMove={move}
                />
              );
            }
            if (l.kind === 'shape') {
              return (
                <ShapeOverlay
                  key={l.id}
                  clip={layerToShapeClip(l)}
                  box={fit}
                  editable
                  selected={selected}
                  onSelect={onSelect}
                  onMove={move}
                />
              );
            }
            return (
              <TextOverlay
                key={l.id}
                clip={layerToTextClip(l)}
                t={0}
                box={fit}
                editable
                selected={selected}
                onSelect={onSelect}
                onMove={move}
                onEdit={onRequestEdit}
              />
            );
          })}

          {!capturing && selectedLayer && selectedLayer.kind !== 'fill' && !selectedLayer.hidden ? (
            <SelectionFrame
              layer={live?.id === selectedLayer.id ? withLive(selectedLayer, live.patch) : selectedLayer}
              box={fit}
              onLive={(patch) =>
                setLive(Object.keys(patch).length ? { id: selectedLayer.id, patch } : null)
              }
              onCommit={(patch) => {
                setLive(null);
                commit(updateLayer(doc, selectedLayer.id, patch), 'transform');
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  canvas: {
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: '#0b0c12',
  },
});

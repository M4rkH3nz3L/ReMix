import { GeometryFields } from '@/components/studio/image/GeometryFields';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput } from 'react-native';

import { palette } from '@/constants/editor';
import { updateLayer } from '@/lib/imageDoc';
import { loadProjectFonts } from '@/lib/projectFontsClient';
import { useEditorStore } from '@/store/editorStore';
import type { ImageDoc, ImageLayer } from '@/types/project';

import { AdjustLayerSection } from './inspector/AdjustLayerSection';
import { FillLayerSection } from './inspector/FillLayerSection';
import { LayerCompositeSection } from './inspector/LayerCompositeSection';
import { LayerEffectsSection } from './inspector/LayerEffectsSection';
import { MaskFadeSection } from './inspector/MaskFadeSection';
import { PhotoLayerSection } from './inspector/PhotoLayerSection';
import { ShapeLayerSection } from './inspector/ShapeLayerSection';
import { TextLayerSection } from './inspector/TextLayerSection';

// a szekciók az inspector/ alatt: réteg-fajtánként (szöveg/fotó/korrekció/forma/fill) + a közös
// rész (átlátszóság/csoport/maszk/keverés), az effektek és a gradient-maszk; a tiszta opció-listák a
// src/lib/layerInspectorOps.ts-ben

/**
 * 🎛️ Réteg-tulajdonság szerkesztő (a kijelölt réteg kontextuális vezérlői):
 * szöveg-stílus / fotó-illesztés+korrekció / forma kitöltés+blend+kontúr+árnyék+glow /
 * háttér-szín + minden rétegnél átlátszóság. Minden módosítás a command-buson (undo).
 *
 * Megosztott: a [LayerPanel](./LayerPanel.tsx) listája ALATT ÉS a dedikált „Stílus"
 * lapban ([LayerStyleSheet](./LayerStyleSheet.tsx)) — így a gazdag vezérlők a
 * kijelölésből KÖZVETLENÜL is elérhetők (felfedezhetőség), nem csak a réteg-fán át.
 */
export function LayerInspector({
  doc,
  layer,
  commit,
  onOpenAdjust,
  onDrawMask,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onOpenAdjust: () => void;
  /** 🎭 szabadkézi (lasszó) rajzolása a megadott rétegre — a szülő aktiválja a lasszó-módot;
   *  target: 'clip' = vágó-maszk, 'local' = korrekció-maszk, 'heal' = folt-javítás régió */
  onDrawMask?: (layerId: string, target: 'clip' | 'local' | 'heal' | 'paint') => void;
}) {
  const { t } = useTranslation();
  const projectFonts = useEditorStore((st) => st.project?.fonts);
  // 🔤 S10: a projekt fontjai betöltve (a választó és a vászon is azzal rajzol)
  const [, setFontsReady] = useState(0);
  useEffect(() => {
    let alive = true;
    void loadProjectFonts(projectFonts).then(() => alive && setFontsReady((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [projectFonts]);

  return (
    <>
      <TextInput maxFontSizeMultiplier={1.3}
        style={styles.nameInput}
        defaultValue={layer.name ?? ''}
        key={`name-${layer.id}`}
        placeholder={t('studio.image.layerName')}
        placeholderTextColor={palette.textDim}
        accessibilityLabel={t('studio.image.layerName')}
        returnKeyType="done"
        onEndEditing={(e) => {
          const name = e.nativeEvent.text.trim() || undefined;
          if (name !== layer.name) {
            commit(updateLayer(doc, layer.id, { name }), t('studio.image.undoRename'));
          }
        }}
      />
      {layer.kind === 'photo' || layer.kind === 'shape' ? <GeometryFields doc={doc} layer={layer} commit={commit} /> : null}
      {layer.kind === 'text' ? <TextLayerSection doc={doc} layer={layer} commit={commit} projectFonts={projectFonts} /> : null}

      {layer.kind === 'photo' ? <PhotoLayerSection doc={doc} layer={layer} commit={commit} onOpenAdjust={onOpenAdjust} onDrawMask={onDrawMask} /> : null}

      {layer.kind === 'adjust' ? <AdjustLayerSection doc={doc} layer={layer} commit={commit} onOpenAdjust={onOpenAdjust} /> : null}

      {layer.kind === 'shape' ? <ShapeLayerSection doc={doc} layer={layer} commit={commit} /> : null}

      {layer.kind === 'fill' ? <FillLayerSection doc={doc} layer={layer} commit={commit} /> : null}

      <LayerCompositeSection doc={doc} layer={layer} commit={commit} onDrawMask={onDrawMask} />

      {/* 🌑 vetett árnyék / ragyogás / 🖊️ kontúr — pozícionált rétegre (fotó/forma/szöveg) */}
      {layer.kind !== 'fill' ? <LayerEffectsSection doc={doc} layer={layer} commit={commit} /> : null}

      <MaskFadeSection doc={doc} layer={layer} commit={commit} />
    </>
  );
}

const styles = StyleSheet.create({
  nameInput: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    fontSize: 14,
    paddingHorizontal: 10,
  },
});

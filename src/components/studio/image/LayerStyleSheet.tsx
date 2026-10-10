import { useTranslation } from 'react-i18next';

import { LayerInspector } from '@/components/studio/image/LayerInspector';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import { layerLabel } from '@/lib/imageDoc';
import type { ImageDoc, ImageLayer } from '@/types/project';

/**
 * 🎛️ „Stílus" lap — a kijelölt réteg gazdag tulajdonság-szerkesztője KÖZVETLENÜL
 * (a réteg-fa megnyitása nélkül). A [LayerInspector](./LayerInspector.tsx) vezérlőit
 * mutatja egy bottom sheetben; a fejléc a réteg neve. Felfedezhetőség: a „Stílus"
 * eszköz a kijelölésre azonnal ide nyit.
 */
export function LayerStyleSheet({
  doc,
  layer,
  commit,
  onOpenAdjust,
  onClose,
}: {
  doc: ImageDoc;
  layer: ImageLayer;
  commit: (next: ImageDoc, label?: string) => void;
  onOpenAdjust: () => void;
  onClose: () => void;
}) {
  useTranslation();
  return (
    <StudioSheet title={layerLabel(layer)} icon="options-outline" onClose={onClose}>
      <LayerInspector doc={doc} layer={layer} commit={commit} onOpenAdjust={onOpenAdjust} />
    </StudioSheet>
  );
}

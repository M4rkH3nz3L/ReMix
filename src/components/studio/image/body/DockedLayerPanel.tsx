import { useTranslation } from 'react-i18next';

import { LayerPanel } from '@/components/studio/image/LayerPanel';
import { StudioSheetFrameContext } from '@/components/studio/image/StudioSheet';
import { flattenTargets, mergeDownTargets } from '@/lib/imageCanvasOps';
import type { ImageDoc } from '@/types/project';

/** a rétegpanel a munkaterület oszlopa: nincs detent, a lap kitölti a helyét */
const DOCKED_FRAME = { inline: true, docked: true, detents: { peek: 0, half: 0, full: 0 }, detent: 'peek' as const, onDetentChange: () => {} };

/**
 * 🗂️ A munkaterületbe dokkolt rétegpanel (telefonon a vászon fölött, tableten a sorban) — egyesítés,
 * raszterizálás, összevonás a body raszter-műveletén át. VISELKEDÉS-MEGŐRZŐ kiemelés az
 * `ImageStudioBody`-ból.
 */
export function DockedLayerPanel({
  doc,
  selectedId,
  onSelect,
  mergeLayers,
  onOrderPreview,
  commit,
  onClose,
}: {
  doc: ImageDoc;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  mergeLayers: (ids: string[], label: string) => Promise<void>;
  onOrderPreview: (preview: { id: string; to: number } | null) => void;
  commit: (next: ImageDoc, label?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <StudioSheetFrameContext.Provider value={DOCKED_FRAME}>
      <LayerPanel
        doc={doc}
        selectedId={selectedId}
        onSelect={onSelect}
        onMergeDown={(id) => {
          const pair = mergeDownTargets(doc, id);
          if (pair) {
            void mergeLayers(pair, t('studio.image.mergeDown'));
          }
        }}
        onRasterize={(id) => void mergeLayers([id], t('studio.image.rasterize'))}
        onFlatten={() => void mergeLayers(flattenTargets(doc), t('studio.image.flatten'))}
        onOrderPreview={onOrderPreview}
        commit={commit}
        onClose={onClose}
      />
    </StudioSheetFrameContext.Provider>
  );
}

import { useTranslation } from 'react-i18next';

import { SourceBin } from '@/components/SourceBin';
import { StudioSheet } from '@/components/studio/image/StudioSheet';
import type { Asset } from '@/types/project';

/**
 * 🗂️ A projekt forrás-mappája MODAL sheetként (telefon / gyors elérés). A
 * tényleges tartalmat a [SourceBin] adja — UGYANAZ, mint a mindig-látható
 * dokkolt forrás-panelé (tablet/fekvő); ez a komponens csak a sheet-keretet
 * (cím + bezárás) adja hozzá. Így a forrás-mappa minden elrendezésben egy kód.
 */
export function SourceSheet({
  onClose,
  onInsert,
}: {
  onClose: () => void;
  onInsert?: (asset: Asset) => void;
}) {
  const { t } = useTranslation();
  return (
    <StudioSheet title={t('source.title')} icon="folder-open" onClose={onClose}>
      <SourceBin onInsert={onInsert} />
    </StudioSheet>
  );
}

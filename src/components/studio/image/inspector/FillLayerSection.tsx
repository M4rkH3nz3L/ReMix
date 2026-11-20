import { useTranslation } from 'react-i18next';

import { ColorField } from '@/components/studio/image/ColorField';
import { GradientEditor } from '@/components/studio/image/GradientEditor';
import { updateLayer } from '@/lib/imageDoc';
import type { FillLayer, ImageDoc } from '@/types/project';

/** 🎨 háttér (fill) réteg: szín + színátmenet */
export function FillLayerSection({
  doc,
  layer,
  commit,
}: {
  doc: ImageDoc;
  layer: FillLayer;
  commit: (next: ImageDoc, label?: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ColorField
        label={t('studio.image.fill')}
        value={layer.fill}
        onChange={(fill) => commit(updateLayer<FillLayer>(doc, layer.id, { fill }))}
      />
      <GradientEditor
        gradient={layer.gradient}
        baseColor={layer.fill}
        onChange={(gradient) => commit(updateLayer<FillLayer>(doc, layer.id, { gradient }))}
      />
    </>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { My3DModelsSection } from '@/components/editor/panels/My3DModelsSection';
import { FaceStickerSection, TapStickerSection } from '@/components/editor/panels/sticker/EmojiStickerSections';
import { Sticker3dSection } from '@/components/editor/panels/sticker/Sticker3dSection';
import { DrawSection, ParticlesSection } from '@/components/editor/panels/sticker/StickerFxSections';
import { StickerShapesSection } from '@/components/editor/panels/sticker/StickerShapesSection';
import { createStickerActions } from '@/components/editor/panels/sticker/stickerActions';
import { listStickers3d } from '@/lib/stickers3d';
import type { Sticker3DEntry } from '@/lib/stickers3d';
import { useEditorStore } from '@/store/editorStore';

/** Matrica = nagy emoji-szövegklip; húzással pozicionálható, animálható. */
export function StickerPanel() {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne a React Compilerrel (előtte kimaradt: a try/finally
  // a gyökérben volt), de a memoizálás bekapcsolása viselkedés-változás → külön döntés
  // (tools/reactCompiler.test.js KNOWN_BAILS).
  'use no memo';
  const { t } = useTranslation();
  const addClip = useEditorStore((s) => s.addClip);
  const setPanel = useEditorStore((s) => s.setPanel);
  const dispatch = useEditorStore((s) => s.dispatch);
  const particles = useEditorStore((s) => s.project?.particles);
  // 🧊 3D objektumok a workerről (CC0 glTF-csomag) — worker nélkül a szekció rejtve
  const [stickers3d, setStickers3d] = useState<Sticker3DEntry[] | null>(null);
  const [busy3d, setBusy3d] = useState<string | null>(null);
  const [material, setMaterial] = useState<string>('original');
  const [environment, setEnvironment] = useState<string>('studio');
  const [faceBusy, setFaceBusy] = useState<string | null>(null);
  const drawBrush = useEditorStore((s) => s.drawBrush);
  const setDrawBrush = useEditorStore((s) => s.setDrawBrush);

  useEffect(() => {
    let alive = true;
    listStickers3d().then((entries) => {
      if (alive) {
        setStickers3d(entries);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const { addSticker3d, addFaceSticker, addSticker, addShape, addLogo } = createStickerActions({
    t,
    addClip,
    setPanel,
    busy3d,
    setBusy3d,
    material,
    environment,
    faceBusy,
    setFaceBusy,
  });

  return (
    <View>
      <StickerShapesSection addShape={addShape} addLogo={addLogo} />

      <ParticlesSection particles={particles} dispatch={dispatch} />

      <DrawSection drawBrush={drawBrush} setDrawBrush={setDrawBrush} />

      {stickers3d ? (
        <Sticker3dSection
          stickers3d={stickers3d}
          busy3d={busy3d}
          material={material}
          setMaterial={setMaterial}
          environment={environment}
          setEnvironment={setEnvironment}
          addSticker3d={addSticker3d}
        />
      ) : null}

      {/* 🧊 a user saját LiDAR-szkenjei (3D Stúdió) — állókép vagy forgó videó */}
      <My3DModelsSection onInserted={() => setPanel('shape')} />

      <FaceStickerSection faceBusy={faceBusy} addFaceSticker={addFaceSticker} />

      <TapStickerSection addSticker={addSticker} />
    </View>
  );
}

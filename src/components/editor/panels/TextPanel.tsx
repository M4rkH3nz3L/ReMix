import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { TextAnimSections } from '@/components/editor/panels/text/TextAnimSections';
import { Text3dSection } from '@/components/editor/panels/text/Text3dSection';
import { TextContentSections } from '@/components/editor/panels/text/TextContentSections';
import { TextLayoutSections, ToShapeSection } from '@/components/editor/panels/text/TextExtraSections';
import { TextLookSections } from '@/components/editor/panels/text/TextLookSections';
import { TextStyleSection } from '@/components/editor/panels/text/TextStyleSection';
import { TextTrackingSection } from '@/components/editor/panels/text/TextTrackingSection';
import { TextSizeSection, TypographySection } from '@/components/editor/panels/text/TypographySections';
import { createShapeActions, createTrackActions } from '@/components/editor/panels/text/textPanelActions';
import { useEditorStore } from '@/store/editorStore';
import type { TextClip } from '@/types/project';

export function TextPanel({ clip }: { clip: TextClip }) {
  // 🧭 A bontás után a gyökér már FORDÍTHATÓ lenne a React Compilerrel (előtte kimaradt: a try/finally
  // a gyökérben volt), de a memoizálás bekapcsolása viselkedés-változás → külön döntés
  // (tools/reactCompiler.test.js KNOWN_BAILS).
  'use no memo';
  const { t: tr } = useTranslation();
  const [trackStatus, setTrackStatus] = useState<string | null>(null);
  // 🎯 téma-kijelölő: a panel bezárul, a következő vászon-koppintás adja a pontot
  const [pickHint, setPickHint] = useState<string | null>(null);

  const { startTracking, trackFace } = createTrackActions({ clip, trackStatus, setTrackStatus, tr });

  const updateClip = useEditorStore((s) => s.updateClip);
  const [tab, setTab] = useState<'style' | 'anim' | 'extra'>('style');
  const [shapeBusy, setShapeBusy] = useState(false);

  const { convertToShape } = createShapeActions({ clip, shapeBusy, setShapeBusy, tr });

  return (
    <View>
      <TextContentSections clip={clip} updateClip={updateClip} tab={tab} setTab={setTab} />

      {tab === 'style' ? (
        <>
          <TextLookSections clip={clip} updateClip={updateClip} />
          <TypographySection clip={clip} updateClip={updateClip} />
          <TextStyleSection clip={clip} updateClip={updateClip} />
          <Text3dSection clip={clip} updateClip={updateClip} />
          <TextSizeSection clip={clip} updateClip={updateClip} />
        </>
      ) : null}

      {tab === 'anim' ? <TextAnimSections clip={clip} updateClip={updateClip} /> : null}

      {tab === 'extra' ? (
        <>
          <TextLayoutSections clip={clip} updateClip={updateClip} />
          <ToShapeSection shapeBusy={shapeBusy} convertToShape={convertToShape} />
          <TextTrackingSection
            clip={clip}
            trackStatus={trackStatus}
            pickHint={pickHint}
            setPickHint={setPickHint}
            startTracking={startTracking}
            trackFace={trackFace}
          />
        </>
      ) : null}
    </View>
  );
}

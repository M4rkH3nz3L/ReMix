import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { makeId } from '@/lib/id';
import { MOTION_PACKS, buildMotionPackPlan } from '@/lib/motionPacks';
import type { MotionPack } from '@/lib/motionPacks';
import { buildProductAdPlan } from '@/lib/productAd';
import { detectScenes } from '@/lib/cutlist';
import { fetchShotScores } from '@/lib/shotScore';
import { fetchThumbHeadlines } from '@/lib/thumbStudio';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

/**
 * 🎬 Look-csomagok + 🛍️ Product showcase: kamera/átmenet/lighting look-pack egy
 * koppintásra, és a legjobb pillanatokból 10 mp-es termékvideó. Önálló AI-mód; a
 * közös busy-sávot (`busy`/`setBusy`) és az „alkalmazva" visszajelzést
 * (`setApplied`) a panel adja propként.
 */
export function LookPacksSection({
  busy,
  setBusy,
  setApplied,
}: {
  busy: string | null;
  setBusy: (status: string | null) => void;
  setApplied: (message: string | null) => void;
}) {
  const { t } = useTranslation();

  // 🎬 Look-csomag: kamera + átmenetek + lighting egy koppintásra, egy undóban
  const applyMotionPack = (pack: MotionPack) => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    const plan = buildMotionPackPlan(state.project, pack);
    if (!plan) {
      Alert.alert(t('panels.assistant.lookPackTitle'), t('panels.assistant.lookPackNoClip'));
      return;
    }
    Alert.alert(
      t('panels.assistant.lookPackHeader', { pack: MOTION_PACKS[pack].label }),
      t('panels.assistant.lookPackBody', { count: plan.touched }) +
        (plan.skippedCamera > 0
          ? t('panels.assistant.lookPackSkipped', { count: plan.skippedCamera })
          : '') +
        t('panels.assistant.lookPackUndo'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('panels.assistant.applyAction'),
          onPress: () => {
            const ok = useEditorStore
              .getState()
              .dispatch(
                { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                'user'
              );
            setApplied(
              ok
                ? t('panels.assistant.lookPackApplied', {
                    pack: MOTION_PACKS[pack].label,
                    count: plan.touched,
                  })
                : t('panels.assistant.applyFailed')
            );
          },
        },
      ]
    );
  };

  // 🛍️ Product showcase: a legjobb pillanatokból 10 mp-es termékvideó
  const makeProductAd = async () => {
    const state = useEditorStore.getState();
    if (!state.project || busy) {
      return;
    }
    const source = state.project.tracks
      .filter((t) => t.type === 'video')
      .flatMap((t) => t.clips)
      .filter((c): c is VideoClip => c.kind === 'video')
      .sort((a, b) => a.start - b.start)[0];
    if (!source) {
      Alert.alert(t('panels.assistant.productAdTitle'), t('panels.assistant.productAdNeedsClip'));
      return;
    }
    setBusy(t('panels.assistant.productFindingMoments'));
    try {
      const scenes = (await detectScenes(source.uri)) ?? [];
      const times = [0.5, ...scenes.map((s) => s + 0.4)].slice(0, 16);
      const shots = await fetchShotScores(source.uri, times);
      if (!shots || shots.length === 0) {
        Alert.alert(
          t('panels.assistant.productAdTitle'),
          t('panels.assistant.productScoringUnavailable')
        );
        return;
      }
      setBusy(t('panels.assistant.productWritingHeadline'));
      const headlines = await fetchThumbHeadlines(
        t('panels.assistant.productHeadlinePrompt', { name: state.project.name })
      );
      const plan = buildProductAdPlan(source, shots, {
        targetSeconds: 10,
        headline: headlines?.[0],
        cta: t('panels.assistant.productCta'),
        makeId: () => makeId('clip'),
      });
      if (!plan) {
        Alert.alert(t('panels.assistant.productAdTitle'), t('panels.assistant.productNotEnoughMoments'));
        return;
      }
      setBusy(null);
      Alert.alert(
        t('panels.assistant.productAdEmojiTitle'),
        t('panels.assistant.productAdBody', {
          shots: plan.shots,
          seconds: plan.totalSeconds,
        }) +
          (plan.captions.length > 0
            ? t('panels.assistant.productAdCaption', { text: plan.captions[0].text })
            : '') +
          t('panels.assistant.productAdUndo'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('panels.assistant.createAction'),
            onPress: () => {
              const s = useEditorStore.getState();
              const ok = s.dispatch(
                { type: 'REPLACE_TRACK_CLIPS', trackType: 'video', clips: plan.clips },
                'ai'
              );
              if (ok && plan.captions.length > 0) {
                s.dispatch(
                  { type: 'ADD_CLIPS', trackType: 'captions', clips: plan.captions },
                  'ai'
                );
              }
              setApplied(
                ok
                  ? t('panels.assistant.productAdDone', {
                      shots: plan.shots,
                      seconds: plan.totalSeconds,
                    })
                  : t('panels.assistant.applyFailed')
              );
            },
          },
        ]
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <PanelSection title={t('panels.assistant.sectionLookPacks')}>
      <View style={styles.packRow}>
        {(Object.keys(MOTION_PACKS) as MotionPack[]).map((pack) => (
          <Chip
            key={pack}
            label={MOTION_PACKS[pack].label}
            active={false}
            onPress={() => applyMotionPack(pack)}
          />
        ))}
      </View>
      <Text style={styles.note}>{t('panels.assistant.lookPacksNote')}</Text>
      <PrimaryButton
        icon="pricetag-outline"
        label={busy ?? t('panels.assistant.makeProductAdBtn')}
        onPress={() => {
          makeProductAd().catch((err: Error) =>
            Alert.alert(t('panels.assistant.productAdTitle'), err.message)
          );
        }}
      />
      <Text style={styles.note}>{t('panels.assistant.productAdNote')}</Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  packRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});

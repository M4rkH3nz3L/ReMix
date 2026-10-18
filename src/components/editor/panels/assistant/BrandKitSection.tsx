import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import {
  applyBrandCaptions,
  buildWatermarkClip,
  deriveBrandKit,
  describeBrandKit,
} from '@/lib/brandKit';
import type { BrandKit } from '@/lib/brandKit';
import {
  INTRO_TEMPLATES,
  OUTRO_TEMPLATES,
  buildBrandSegmentPlan,
} from '@/lib/brandIntro';
import type { IntroTemplate, OutroTemplate } from '@/lib/brandIntro';
import { loadBrandKit, saveBrandKit } from '@/lib/brandStore';
import { makeId } from '@/lib/id';
import { projectDuration } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';

/**
 * 🎨 Brand Kit + 🎬 Intro/outro: stílusprofil mentése/alkalmazása + a mentett
 * márka alapján intro/outro beszúrása (ripple, egy undo-lépés). Önálló AI-mód;
 * a `brandKit`-et mountkor tölti (mint korábban a panel).
 */
export function BrandKitSection() {
  const { t } = useTranslation();
  const [brandKit, setBrandKit] = useState<BrandKit | null>(null);
  const [intro, setIntro] = useState<IntroTemplate | null>(null);
  const [outro, setOutro] = useState<OutroTemplate | null>(null);

  useEffect(() => {
    let alive = true;
    loadBrandKit().then((kit) => {
      if (alive) {
        setBrandKit(kit);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // 🎨 Brand Kit: stílusprofil mentése a nyitott projektből
  const learnBrand = async () => {
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const kit = deriveBrandKit(project, new Date().toISOString());
    if (!kit) {
      Alert.alert(
        t('panels.assistant.brandKitTitle'),
        t('panels.assistant.brandKitNoStyle')
      );
      return;
    }
    await saveBrandKit(kit);
    setBrandKit(kit);
    Alert.alert(t('panels.assistant.brandKitSaved'), describeBrandKit(kit));
  };

  // 🎨 Brand Kit: a mentett márka alkalmazása a nyitott projektre
  const applyBrand = async () => {
    const state = useEditorStore.getState();
    const project = state.project;
    if (!project) {
      return;
    }
    const kit = brandKit ?? (await loadBrandKit());
    if (!kit) {
      Alert.alert(t('panels.assistant.brandKitTitle'), t('panels.assistant.brandKitNoSaved'));
      return;
    }
    let captionCount = 0;
    const captionsTrack = project.tracks.find((t) => t.type === 'captions');
    if (kit.caption && captionsTrack && captionsTrack.clips.length > 0) {
      const { clips, changed } = applyBrandCaptions(captionsTrack.clips, kit);
      if (changed > 0) {
        state.dispatch(
          { type: 'REPLACE_TRACK_CLIPS', trackType: 'captions', clips },
          'user'
        );
        captionCount = changed;
      }
    }
    let watermarkAdded = false;
    if (kit.watermark) {
      const exists = project.tracks
        .flatMap((t) => t.clips)
        .some((c) => c.kind === 'shape' && c.imageUri === kit.watermark!.imageUri);
      if (!exists) {
        const clip = buildWatermarkClip(
          kit.watermark,
          projectDuration(project),
          makeId('clip')
        );
        watermarkAdded = state.dispatch(
          {
            type: 'ADD_CLIP',
            trackType: 'overlay',
            clip,
            asset: {
              id: makeId('ast'),
              kind: 'image',
              uri: kit.watermark.imageUri,
              provider: 'local',
              name: t('panels.assistant.watermarkName'),
            },
          },
          'user'
        );
      }
    }
    if (captionCount === 0 && !watermarkAdded) {
      Alert.alert(t('panels.assistant.brandKitTitle'), t('panels.assistant.brandNothingToApply'));
      return;
    }
    Alert.alert(
      t('panels.assistant.brandApplied'),
      [
        captionCount > 0
          ? t('panels.assistant.brandCaptionsRestyled', { count: captionCount })
          : null,
        watermarkAdded ? t('panels.assistant.brandWatermarkAdded') : null,
      ]
        .filter(Boolean)
        .join(' · ') + t('panels.assistant.brandUndoStepwise')
    );
  };

  /**
   * 🎬 Intro/outro beszúrása a mentett márka (szín + logó + felirat-stílus)
   * alapján. Az intro RIPPLE: minden sáv csúszik a hosszával, ezért az egész
   * egyetlen REPLACE_TRACKS parancsban megy be — egy undo-lépés.
   */
  const applyBrandSegments = async () => {
    const state = useEditorStore.getState();
    if (!state.project) {
      return;
    }
    if (!intro && !outro) {
      Alert.alert(t('panels.assistant.introOutroTitle'), t('panels.assistant.introOutroPickTemplate'));
      return;
    }
    const kit = brandKit ?? (await loadBrandKit());
    const plan = buildBrandSegmentPlan(
      state.project.tracks.map((t) => ({ type: t.type, clips: t.clips })),
      {
        intro: intro ?? undefined,
        outro: outro ?? undefined,
        kit,
        title: state.project.name,
        makeId: () => makeId('clip'),
      }
    );
    if (!plan) {
      Alert.alert(t('panels.assistant.introOutroTitle'), t('panels.assistant.introOutroBuildFailed'));
      return;
    }
    Alert.alert(
      t('panels.assistant.introOutroTitle'),
      t('panels.assistant.introOutroBody', { summary: plan.summary }) +
        (plan.duration > 0
          ? t('panels.assistant.introOutroShift', { duration: plan.duration.toFixed(1) })
          : '') +
        (kit?.watermark
          ? t('panels.assistant.introOutroLogoIncluded')
          : t('panels.assistant.introOutroNoLogo')) +
        t('panels.assistant.introOutroUndo'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('panels.assistant.insertAction'),
          onPress: () => {
            useEditorStore.getState().dispatch(
              {
                type: 'REPLACE_TRACKS',
                tracks: plan.tracks,
                label: t('panels.assistant.introOutroUndoLabel', { summary: plan.summary }),
              },
              'user'
            );
          },
        },
      ]
    );
  };

  return (
    <PanelSection title={t('panels.assistant.sectionBrandKit')}>
      <PrimaryButton
        icon="bookmark-outline"
        label={t('panels.assistant.brandSaveStyle')}
        onPress={() => {
          void learnBrand();
        }}
      />
      <PrimaryButton
        icon="color-wand-outline"
        label={t('panels.assistant.brandApplyBtn')}
        onPress={() => {
          void applyBrand();
        }}
      />
      <Text style={styles.note}>
        {brandKit
          ? t('panels.assistant.brandSavedInfo', { info: describeBrandKit(brandKit) })
          : t('panels.assistant.brandNoSavedHint')}
      </Text>

      <Text style={styles.subLabel}>{t('panels.assistant.introLabel')}</Text>
      <View style={styles.row}>
        {INTRO_TEMPLATES.map((tpl) => (
          <Chip
            key={tpl.id}
            label={t(tpl.label)}
            active={intro === tpl.id}
            onPress={() => setIntro(intro === tpl.id ? null : tpl.id)}
          />
        ))}
      </View>
      <Text style={styles.subLabel}>{t('panels.assistant.outroLabel')}</Text>
      <View style={styles.row}>
        {OUTRO_TEMPLATES.map((tpl) => (
          <Chip
            key={tpl.id}
            label={t(tpl.label)}
            active={outro === tpl.id}
            onPress={() => setOutro(outro === tpl.id ? null : tpl.id)}
          />
        ))}
      </View>
      <PrimaryButton
        icon="albums-outline"
        label={t('panels.assistant.insertIntroOutroBtn')}
        onPress={() => {
          applyBrandSegments().catch((err: Error) =>
            Alert.alert(t('panels.assistant.introOutroTitle'), err.message)
          );
        }}
      />
      <Text style={styles.note}>{t('panels.assistant.introOutroNote')}</Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  subLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 4,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});

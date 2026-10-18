import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ScopesView } from '@/components/editor/ScopesView';
import { ToneCurveEditor } from '@/components/editor/ToneCurveEditor';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { ADJUST_FIELDS } from '@/constants/adjust';
import { palette } from '@/constants/editor';
import { requestCutout } from '@/lib/bgremove';
import { statsToAutoAdjust, statsToMatchAdjust } from '@/lib/colorAuto';
import { exportLutCube, fetchColorStats } from '@/lib/colorClient';
import { shareLutCube } from '@/lib/export';
import { pickLut } from '@/lib/media';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { ImageClip, VideoClip } from '@/types/project';

const ADJUSTS = ADJUST_FIELDS;

/** a klip közepének FORRÁS-ideje (a statisztika reprezentatív kockájához) */
const sourceMidSec = (c: VideoClip | ImageClip) =>
  c.kind === 'video' ? c.trimIn + (c.duration * c.speed) / 2 : 0;

/**
 * ✨ Fejlesztés: Auto/Match color + manuális adjust + curves + LUT + scopes +
 * AI-kijelölés (téma/háttér). Önálló szekció — saját busy-állapotok és
 * handlerek; a `playhead`-et csak a scopes mintaidejéhez olvassa.
 */
export function EnhanceSection({ clip }: { clip: VideoClip | ImageClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const playhead = useEditorStore((s) => s.playhead);
  const [colorBusy, setColorBusy] = useState<'auto' | 'match' | null>(null);
  const [lutBusy, setLutBusy] = useState(false);
  const [selectBusy, setSelectBusy] = useState(false);

  // 🎨 Auto Color: mérés a workeren → konzervatív adjust-javaslat
  const autoColor = async () => {
    if (colorBusy) {
      return;
    }
    setColorBusy('auto');
    const stats = await fetchColorStats(clip.uri, sourceMidSec(clip));
    setColorBusy(null);
    if (!stats) {
      Alert.alert(t('panels.filter.autoColorTitle'), t('panels.filter.colorAnalysisUnavailable'));
      return;
    }
    const adjust = statsToAutoAdjust(stats);
    if (Object.keys(adjust).length === 0) {
      Alert.alert(t('panels.filter.autoColorTitle'), t('panels.filter.autoColorBalanced'));
      return;
    }
    updateClip(clip.id, { adjust: { ...clip.adjust, ...adjust } });
  };

  // 🎯 Match Color: az idővonalon ELŐZŐ vizuális klip színvilágához igazít
  const matchColor = async () => {
    if (colorBusy) {
      return;
    }
    const project = useEditorStore.getState().project;
    const track = project?.tracks.find((t) => t.type === 'video');
    const prev = track?.clips
      .filter(
        (c) =>
          (c.kind === 'video' || c.kind === 'image') && c.start < clip.start
      )
      .sort((a, b) => b.start - a.start)[0] as VideoClip | ImageClip | undefined;
    if (!prev) {
      Alert.alert(t('panels.filter.matchColorTitle'), t('panels.filter.matchColorNoPrev'));
      return;
    }
    setColorBusy('match');
    const [target, reference] = await Promise.all([
      fetchColorStats(clip.uri, sourceMidSec(clip)),
      fetchColorStats(prev.uri, sourceMidSec(prev)),
    ]);
    setColorBusy(null);
    if (!target || !reference) {
      Alert.alert(t('panels.filter.matchColorTitle'), t('panels.filter.colorAnalysisUnavailable'));
      return;
    }
    const adjust = statsToMatchAdjust(target, reference);
    if (Object.keys(adjust).length === 0) {
      Alert.alert(t('panels.filter.matchColorTitle'), t('panels.filter.matchColorAligned'));
      return;
    }
    updateClip(clip.id, { adjust: { ...clip.adjust, ...adjust } });
  };

  // 🎞️ 3D LUT (.cube) importálása a klip grade-jébe
  const importLut = async () => {
    const res = await pickLut();
    if (res === null) {
      return;
    }
    if (res === 'invalid') {
      Alert.alert(t('panels.adjust.lutTitle'), t('panels.adjust.lutInvalid'));
      return;
    }
    updateClip(clip.id, { adjust: { ...clip.adjust, lut: { uri: res.uri, name: res.name } } });
  };

  // 🎞️ A klip aktuális képjavítása (curves + HSL is) → .cube LUT megosztása
  const exportLut = async () => {
    if (!clip.adjust || lutBusy) {
      return;
    }
    setLutBusy(true);
    const cube = await exportLutCube(clip.adjust);
    setLutBusy(false);
    if (!cube) {
      Alert.alert(t('panels.adjust.lutTitle'), t('panels.adjust.lutExportFail'));
      return;
    }
    await shareLutCube(`remix-clip-${clip.id.slice(0, 6)}`, cube);
  };

  // 🎯 AI Select: a képjavítás csak a témára / csak a háttérre hasson
  const applySelective = async (target: 'subject' | 'background') => {
    if (clip.kind !== 'image' || selectBusy) {
      return;
    }
    if (clip.selective?.target === target) {
      updateClip(clip.id, { selective: undefined });
      return;
    }
    setSelectBusy(true);
    const result = await requestCutout(clip.uri);
    setSelectBusy(false);
    if (!result) {
      Alert.alert(
        t('panels.filter.aiSelectTitle'),
        t('panels.filter.aiSelectUnavailable')
      );
      return;
    }
    updateClip(clip.id, { selective: { id: result.id, target } });
  };

  return (
    <PanelSection title={t('panels.filter.sectionEnhance')}>
      <View style={styles.row}>
        <Chip
          label={colorBusy === 'auto' ? t('panels.filter.chipAnalyzingColor') : t('panels.filter.chipAutoColor')}
          active={false}
          onPress={() => {
            void autoColor();
          }}
        />
        <Chip
          label={colorBusy === 'match' ? t('panels.filter.chipAnalyzingMatch') : t('panels.filter.chipMatchPrev')}
          active={false}
          onPress={() => {
            void matchColor();
          }}
        />
      </View>
      {ADJUSTS.map(({ key, step, min, max }) => {
        const value = clip.adjust?.[key] ?? 0;
        const set = (v: number) =>
          updateClip(clip.id, {
            adjust: { ...clip.adjust, [key]: Math.round(clamp(v, min, max) * 100) / 100 },
          });
        return (
          <Stepper
            key={key}
            label={t('panels.filter.adjust_' + key)}
            value={`${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
            onDec={() => set(value - step)}
            onInc={() => set(value + step)}
          />
        );
      })}
      {clip.adjust ? (
        <Chip
          label={t('common.reset')}
          active={false}
          onPress={() => updateClip(clip.id, { adjust: undefined })}
        />
      ) : null}
      <Text style={styles.subLabel}>{t('panels.adjust.curvesTitle')}</Text>
      <ToneCurveEditor
        value={clip.adjust?.curves}
        onChange={(curves) => updateClip(clip.id, { adjust: { ...clip.adjust, curves } })}
      />
      <Text style={styles.subLabel}>{t('panels.adjust.lutTitle')}</Text>
      <View style={styles.row}>
        {clip.adjust?.lut ? (
          <>
            <Chip label={`🎞️ ${clip.adjust.lut.name}`} active onPress={importLut} />
            <Chip
              label={t('panels.adjust.lutRemove')}
              active={false}
              onPress={() => updateClip(clip.id, { adjust: { ...clip.adjust, lut: undefined } })}
            />
          </>
        ) : (
          <Chip label={t('panels.adjust.lutImport')} active={false} onPress={importLut} />
        )}
        {clip.adjust ? (
          <Chip
            label={lutBusy ? t('panels.adjust.lutExporting') : t('panels.adjust.lutExport')}
            active={false}
            onPress={exportLut}
          />
        ) : null}
      </View>
      <Text style={styles.subLabel}>{t('panels.adjust.scopesTitle')}</Text>
      <ScopesView
        uri={clip.uri}
        atSec={
          clip.kind === 'video'
            ? clip.trimIn + Math.max(0, playhead - clip.start) * clip.speed
            : 0
        }
      />
      {clip.kind === 'image' ? (
        <View style={styles.row}>
          <Chip
            label={t('panels.filter.chipSelectAll')}
            active={!clip.selective}
            onPress={() => updateClip(clip.id, { selective: undefined })}
          />
          <Chip
            label={selectBusy ? t('panels.filter.chipSelecting') : t('panels.filter.chipSubjectOnly')}
            active={clip.selective?.target === 'subject'}
            onPress={() => {
              void applySelective('subject');
            }}
          />
          <Chip
            label={selectBusy ? t('panels.filter.chipSelecting') : t('panels.filter.chipBackgroundOnly')}
            active={clip.selective?.target === 'background'}
            onPress={() => {
              void applySelective('background');
            }}
          />
        </View>
      ) : null}
      <Text style={styles.note}>
        {t('panels.filter.noteEnhance')}
      </Text>
    </PanelSection>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  subLabel: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 4,
  },
});

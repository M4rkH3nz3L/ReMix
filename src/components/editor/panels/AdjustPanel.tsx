import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { ToneCurveEditor } from '@/components/editor/ToneCurveEditor';
import { Chip, PanelSection, Stepper } from '@/components/ui/controls';
import { ADJUST_FIELDS, ADJUST_GROUPS, ADJUST_META } from '@/constants/adjust';
import { palette } from '@/constants/editor';
import { GRADES } from '@/constants/grades';
import { exportLutCube } from '@/lib/colorClient';
import { shareLutCube } from '@/lib/export';
import { pickLut } from '@/lib/media';
import { clamp } from '@/lib/time';
import { useEditorStore } from '@/store/editorStore';
import type { AdjustClip } from '@/types/project';

/**
 * Grade-réteg panel: az adjust-sáv egy klipjének színvilága. Fent a filmes
 * look-presetek (LUT-szerű grade), alatta a kézi finomhangolás — a preset a
 * kézi adjusttal KOMBINÁLHATÓ (a render előbb a presetet, majd a kézi láncot
 * alkalmazza). A hatás a klip idővonal-ablakában az ALATTA lévő TELJES
 * kompozitra megy (nem-destruktív, CapCut-minta); a pontos színkorrekció a
 * renderben ég be, az előnézet tinttel közelít.
 */
export function AdjustPanel({ clip }: { clip: AdjustClip }) {
  const { t } = useTranslation();
  const updateClip = useEditorStore((s) => s.updateClip);
  const adjust = clip.adjust ?? {};
  const grade = clip.grade ?? 'none';
  const isNeutral = ADJUST_FIELDS.every(({ key }) => (adjust[key] ?? 0) === 0);
  const [lutBusy, setLutBusy] = useState(false);

  const renderStepper = (key: (typeof ADJUST_FIELDS)[number]['key']) => {
    const { step, min, max } = ADJUST_META[key];
    const value = adjust[key] ?? 0;
    const set = (v: number) =>
      updateClip(clip.id, {
        adjust: { ...adjust, [key]: Math.round(clamp(v, min, max) * 100) / 100 },
      });
    return (
      <Stepper
        key={key}
        label={t('panels.adjust.adjust_' + key)}
        value={`${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
        onDec={() => set(value - step)}
        onInc={() => set(value + step)}
      />
    );
  };

  // 🎨 3-way color balance: egy tartomány (árnyék/középtónus/csúcsfény) egy
  // csatornája (R/G/B); az érték -1…1, a többi mező megmarad (mély-merge).
  const balance = adjust.balance ?? {};
  const setBalance = (range: 'sh' | 'mid' | 'hi', ch: 'r' | 'g' | 'b', v: number) => {
    const cur = balance[range] ?? {};
    const nv = Math.round(clamp(v, -1, 1) * 100) / 100;
    updateClip(clip.id, {
      adjust: { ...adjust, balance: { ...balance, [range]: { ...cur, [ch]: nv } } },
    });
  };
  const renderBalanceRange = (range: 'sh' | 'mid' | 'hi') =>
    (['r', 'g', 'b'] as const).map((ch) => {
      const value = balance[range]?.[ch] ?? 0;
      return (
        <Stepper
          key={`${range}${ch}`}
          label={t('panels.adjust.balCh_' + ch)}
          value={`${value > 0 ? '+' : ''}${Math.round(value * 100)}`}
          onDec={() => setBalance(range, ch, value - 0.1)}
          onInc={() => setBalance(range, ch, value + 0.1)}
        />
      );
    });

  const importLut = async () => {
    const res = await pickLut();
    if (res === null) {
      return;
    }
    if (res === 'invalid') {
      Alert.alert(t('panels.adjust.lutTitle'), t('panels.adjust.lutInvalid'));
      return;
    }
    updateClip(clip.id, { adjust: { ...adjust, lut: { uri: res.uri, name: res.name } } });
  };

  const exportLut = async () => {
    if (lutBusy) {
      return;
    }
    setLutBusy(true);
    const cube = await exportLutCube(adjust, grade === 'none' ? undefined : grade, clip.strength);
    setLutBusy(false);
    if (!cube) {
      Alert.alert(t('panels.adjust.lutTitle'), t('panels.adjust.lutExportFail'));
      return;
    }
    await shareLutCube(`remix-grade-${clip.id.slice(0, 6)}`, cube);
  };

  return (
    <View>
      <PanelSection title={t('panels.adjust.filmLookTitle')}>
        <View style={styles.row}>
          {GRADES.map((g) => (
            <Chip
              key={g.id}
              label={t('panels.adjust.grade_' + g.id)}
              active={grade === g.id}
              onPress={() => updateClip(clip.id, { grade: g.id === 'none' ? undefined : g.id })}
            />
          ))}
        </View>
        <Text style={styles.note}>{t('panels.adjust.filmLookNote')}</Text>
        <Stepper
          label={t('panels.adjust.strengthLabel')}
          value={`${Math.round((clip.strength ?? 1) * 100)}%`}
          onDec={() =>
            updateClip(clip.id, { strength: clamp((clip.strength ?? 1) - 0.1, 0, 1) })
          }
          onInc={() =>
            updateClip(clip.id, { strength: clamp((clip.strength ?? 1) + 0.1, 0, 1) })
          }
        />
        <Stepper
          label={t('panels.adjust.fadeInLabel')}
          value={`${(clip.fadeInSec ?? 0).toFixed(1)}s`}
          onDec={() => updateClip(clip.id, { fadeInSec: clamp((clip.fadeInSec ?? 0) - 0.2, 0, 5) })}
          onInc={() => updateClip(clip.id, { fadeInSec: clamp((clip.fadeInSec ?? 0) + 0.2, 0, 5) })}
        />
        <Stepper
          label={t('panels.adjust.fadeOutLabel')}
          value={`${(clip.fadeOutSec ?? 0).toFixed(1)}s`}
          onDec={() =>
            updateClip(clip.id, { fadeOutSec: clamp((clip.fadeOutSec ?? 0) - 0.2, 0, 5) })
          }
          onInc={() =>
            updateClip(clip.id, { fadeOutSec: clamp((clip.fadeOutSec ?? 0) + 0.2, 0, 5) })
          }
        />
      </PanelSection>

      {ADJUST_GROUPS.filter((g) => g.id === 'tone' || g.id === 'color').map((group) => (
        <PanelSection key={group.id} title={t('panels.adjust.group_' + group.id)}>
          {group.keys.map(renderStepper)}
        </PanelSection>
      ))}

      <PanelSection title={t('panels.adjust.curvesTitle')}>
        <ToneCurveEditor
          value={adjust.curves}
          onChange={(curves) => updateClip(clip.id, { adjust: { ...adjust, curves } })}
        />
        <Text style={styles.note}>{t('panels.adjust.curvesNote')}</Text>
      </PanelSection>

      {ADJUST_GROUPS.filter((g) => g.id === 'hsl').map((group) => (
        <PanelSection key={group.id} title={t('panels.adjust.group_' + group.id)}>
          {group.keys.map(renderStepper)}
          <Text style={styles.note}>{t('panels.adjust.hslNote')}</Text>
        </PanelSection>
      ))}

      {/* 🎨 3-way color balance (color wheels): árnyék / középtónus / csúcsfény */}
      <PanelSection title={t('panels.adjust.balanceTitle')}>
        <Text style={styles.balLabel}>{t('panels.adjust.balShadows')}</Text>
        {renderBalanceRange('sh')}
        <Text style={styles.balLabel}>{t('panels.adjust.balMidtones')}</Text>
        {renderBalanceRange('mid')}
        <Text style={styles.balLabel}>{t('panels.adjust.balHighlights')}</Text>
        {renderBalanceRange('hi')}
        <Text style={styles.note}>{t('panels.adjust.balanceNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.adjust.lutTitle')}>
        <View style={styles.row}>
          {adjust.lut ? (
            <>
              <Chip label={`🎞️ ${adjust.lut.name}`} active onPress={importLut} />
              <Chip
                label={t('panels.adjust.lutRemove')}
                active={false}
                onPress={() => updateClip(clip.id, { adjust: { ...adjust, lut: undefined } })}
              />
            </>
          ) : (
            <Chip label={t('panels.adjust.lutImport')} active={false} onPress={importLut} />
          )}
          <Chip
            label={lutBusy ? t('panels.adjust.lutExporting') : t('panels.adjust.lutExport')}
            active={false}
            onPress={exportLut}
          />
        </View>
        <Text style={styles.note}>{t('panels.adjust.lutNote')}</Text>
      </PanelSection>

      {ADJUST_GROUPS.filter((g) => g.id === 'effect').map((group) => (
        <PanelSection key={group.id} title={t('panels.adjust.group_' + group.id)}>
          {group.keys.map(renderStepper)}
          {!isNeutral ||
          adjust.curves ||
          grade !== 'none' ||
          (clip.strength ?? 1) !== 1 ||
          clip.fadeInSec ||
          clip.fadeOutSec ? (
            <Chip
              label={t('common.reset')}
              active={false}
              onPress={() =>
                updateClip(clip.id, {
                  adjust: {},
                  grade: undefined,
                  strength: undefined,
                  fadeInSec: undefined,
                  fadeOutSec: undefined,
                })
              }
            />
          ) : null}
          <Text style={styles.note}>{t('panels.adjust.manualTuningNote')}</Text>
        </PanelSection>
      ))}
    </View>
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
  balLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
  },
});

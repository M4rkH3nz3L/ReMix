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
  // 📊 szintek (levels) + 🎨 csatorna-mixer + 🎨 gradient-map — a Kép Stúdióval azonos szín-eszközök
  const levels = adjust.levels;
  const setLevels = (patch: Partial<NonNullable<typeof levels>>) =>
    updateClip(clip.id, { adjust: { ...adjust, levels: { black: 0, white: 1, gamma: 1, ...levels, ...patch } } });
  const mix = adjust.channelMix;
  const setMix = (patch: Record<string, number>) =>
    updateClip(clip.id, { adjust: { ...adjust, channelMix: { rr: 1, gg: 1, bb: 1, ...mix, ...patch } } });
  const DUOTONES = [
    { n: 'Kék→Arany', s: '#0d1b3a', h: '#ffd27f' },
    { n: 'Lila→Narancs', s: '#2a0d3a', h: '#ff8c42' },
    { n: 'Fekete→Fehér', s: '#000000', h: '#ffffff' },
    { n: 'Teal→Rózsa', s: '#0f3b3b', h: '#ff9ec4' },
  ];
  // 🎨 split-tone presetek (árnyék-szín + csúcsfény-szín); a kép-struktúra megmarad
  const SPLIT_TONES = [
    { n: 'Kék/Narancs', s: '#2b6cff', h: '#ff9e42' },
    { n: 'Teal/Arany', s: '#1f9e9e', h: '#ffcf66' },
    { n: 'Lila/Zöld', s: '#8a4bff', h: '#5bd98a' },
    { n: 'Hideg/Meleg', s: '#4080ff', h: '#ff6b4d' },
  ];

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

      {/* 📊 szintek (levels) — a Kép Stúdióval azonos (render: lutrgb) */}
      <PanelSection title={t('panels.adjust.levelsTitle', { defaultValue: '📊 Szintek' })}>
        <View style={styles.row}>
          <Chip
            label={levels ? t('common.off', { defaultValue: 'Ki' }) : t('common.on', { defaultValue: 'Be' })}
            active={!!levels}
            onPress={() => updateClip(clip.id, { adjust: { ...adjust, levels: levels ? undefined : { black: 0, white: 1, gamma: 1 } } })}
          />
        </View>
        {levels ? (
          <>
            <Stepper label={t('panels.adjust.levelsBlack', { defaultValue: 'Fekete-pont' })} value={`${Math.round((levels.black ?? 0) * 100)}`} onDec={() => setLevels({ black: clamp((levels.black ?? 0) - 0.05, 0, 0.9) })} onInc={() => setLevels({ black: clamp((levels.black ?? 0) + 0.05, 0, 0.9) })} />
            <Stepper label={t('panels.adjust.levelsWhite', { defaultValue: 'Fehér-pont' })} value={`${Math.round((levels.white ?? 1) * 100)}`} onDec={() => setLevels({ white: clamp((levels.white ?? 1) - 0.05, 0.1, 1) })} onInc={() => setLevels({ white: clamp((levels.white ?? 1) + 0.05, 0.1, 1) })} />
            <Stepper label={t('panels.adjust.levelsGamma', { defaultValue: 'Gamma' })} value={`${((levels.gamma ?? 1)).toFixed(2)}`} onDec={() => setLevels({ gamma: clamp((levels.gamma ?? 1) - 0.1, 0.2, 3) })} onInc={() => setLevels({ gamma: clamp((levels.gamma ?? 1) + 0.1, 0.2, 3) })} />
          </>
        ) : null}
      </PanelSection>

      {/* 🎨 csatorna-mixer — a Kép Stúdióval azonos (render: colorchannelmixer) */}
      <PanelSection title={t('panels.adjust.channelMixTitle', { defaultValue: '🎨 Csatorna-mixer' })}>
        <View style={styles.row}>
          <Chip
            label={mix ? t('common.off', { defaultValue: 'Ki' }) : t('common.on', { defaultValue: 'Be' })}
            active={!!mix}
            onPress={() => updateClip(clip.id, { adjust: { ...adjust, channelMix: mix ? undefined : { rr: 1, gg: 1, bb: 1 } } })}
          />
        </View>
        {mix
          ? ([['rr', 'R←R'], ['rg', 'R←G'], ['rb', 'R←B'], ['gr', 'G←R'], ['gg', 'G←G'], ['gb', 'G←B'], ['br', 'B←R'], ['bg', 'B←G'], ['bb', 'B←B']] as const).map(([k, lbl]) => {
              const dv = k === 'rr' || k === 'gg' || k === 'bb' ? 1 : 0;
              const v = mix[k] ?? dv;
              return (
                <Stepper key={k} label={lbl} value={`${v.toFixed(2)}`} onDec={() => setMix({ [k]: Math.round(clamp(v - 0.1, -1, 2) * 100) / 100 })} onInc={() => setMix({ [k]: Math.round(clamp(v + 0.1, -1, 2) * 100) / 100 })} />
              );
            })
          : null}
      </PanelSection>

      {/* 🎨 gradient-map (egyedi duotone) — preset-párok (render: geq luma→szín) */}
      <PanelSection title={t('panels.adjust.gradientMapTitle', { defaultValue: '🎨 Gradient-map (duotone)' })}>
        <View style={styles.row}>
          <Chip
            label={t('common.off', { defaultValue: 'Ki' })}
            active={!adjust.gradientMap}
            onPress={() => (adjust.gradientMap ? updateClip(clip.id, { adjust: { ...adjust, gradientMap: undefined } }) : undefined)}
          />
          {DUOTONES.map((d) => (
            <Chip
              key={d.n}
              label={d.n}
              active={adjust.gradientMap?.shadow === d.s && adjust.gradientMap?.highlight === d.h}
              onPress={() => updateClip(clip.id, { adjust: { ...adjust, gradientMap: { shadow: d.s, highlight: d.h } } })}
            />
          ))}
        </View>
      </PanelSection>

      {/* 🎨 split-toning: árnyék-szín + csúcsfény-szín (a kép-struktúra megmarad) */}
      <PanelSection title={t('panels.adjust.splitToneTitle', { defaultValue: '🎨 Split-tone (árnyék/csúcsfény)' })}>
        <View style={styles.row}>
          <Chip
            label={t('common.off', { defaultValue: 'Ki' })}
            active={!adjust.splitTone}
            onPress={() => (adjust.splitTone ? updateClip(clip.id, { adjust: { ...adjust, splitTone: undefined } }) : undefined)}
          />
          {SPLIT_TONES.map((d) => (
            <Chip
              key={d.n}
              label={d.n}
              active={adjust.splitTone?.shadow === d.s && adjust.splitTone?.highlight === d.h}
              onPress={() => updateClip(clip.id, { adjust: { ...adjust, splitTone: { shadow: d.s, highlight: d.h, strength: adjust.splitTone?.strength ?? 0.8 } } })}
            />
          ))}
        </View>
        {adjust.splitTone ? (
          <Stepper
            label={t('panels.adjust.splitToneStrength', { defaultValue: 'Erősség' })}
            value={`${Math.round((adjust.splitTone.strength ?? 0.8) * 100)}%`}
            onDec={() => updateClip(clip.id, { adjust: { ...adjust, splitTone: { ...adjust.splitTone!, strength: clamp((adjust.splitTone!.strength ?? 0.8) - 0.1, 0.1, 1) } } })}
            onInc={() => updateClip(clip.id, { adjust: { ...adjust, splitTone: { ...adjust.splitTone!, strength: clamp((adjust.splitTone!.strength ?? 0.8) + 0.1, 0.1, 1) } } })}
          />
        ) : null}
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

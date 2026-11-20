import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { palette } from '@/constants/editor';
import { EDIT_MODES } from '@/lib/toolbarSpec';
import { useEditorPrefs } from '@/store/editorPrefsStore';
import { useEditorStore } from '@/store/editorStore';

import { openSnapMenu } from './timelineMenus';

/** a vezérlősor görgetés-állapota (a jobb oldali „van még” jelzéshez) */
export interface ControlsScrollState {
  w: number;
  content: number;
  x: number;
}

/**
 * ↔️ Az idővonal vezérlősora: szerkesztési mód, insight-fülek, trim/borotva/tartomány,
 * illesztés + régió. Az állapotot (`controls`) a Timeline tartja, hogy a compact
 * ki-be kapcsolása ne nullázza — a kiemelés előtt is ott élt.
 */
export function TimelineControlsBar({
  controls,
  setControls,
}: {
  controls: ControlsScrollState;
  setControls: Dispatch<SetStateAction<ControlsScrollState>>;
}) {
  const { t } = useTranslation();
  const insightLane = useEditorStore((s) => s.insightLane);
  // 🎚️ kezelési beállítások (eszköz-szintű): szerkesztési mód + kiegészítő sorok
  const editMode = useEditorPrefs((st) => st.editMode);
  const setEditMode = useEditorPrefs((st) => st.setEditMode);
  const timelineExtras = useEditorPrefs((st) => st.timelineExtras);
  const setTimelineExtras = useEditorPrefs((st) => st.setTimelineExtras);
  const setInsightLane = useEditorStore((s) => s.setInsightLane);
  const addRegion = useEditorStore((s) => s.addRegion);
  const snapStrength = useEditorStore((s) => s.snapStrength);
  const cycleSnapStrength = useEditorStore((s) => s.cycleSnapStrength);
  const snapTargets = useEditorStore((s) => s.snapTargets);
  const toggleSnapTarget = useEditorStore((s) => s.toggleSnapTarget);
  // ✂️ borotva-mód (koppintásra vág)
  const razorMode = useEditorStore((s) => s.razorMode);
  const toggleRazorMode = useEditorStore((s) => s.toggleRazorMode);
  // ✂️ trim-mód (normal/ripple/roll/slip/slide) — a fogantyú/test-húzás viselkedése
  const trimMode = useEditorStore((s) => s.trimMode);
  const cycleTrimMode = useEditorStore((s) => s.cycleTrimMode);
  // 🅸🅾 tartomány-kijelölés
  const rangeIn = useEditorStore((s) => s.rangeIn);
  const rangeOut = useEditorStore((s) => s.rangeOut);
  const setRangeIn = useEditorStore((s) => s.setRangeIn);
  const setRangeOut = useEditorStore((s) => s.setRangeOut);

  return (
    <View style={styles.controlsWrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.insightTabsBar}
        contentContainerStyle={styles.insightTabs}
        onLayout={(e) => {
          // az eseményt AZONNAL olvassuk — a state-frissítő később fut, addigra a RN az
          // eseményt nullázza („Cannot read property 'layout' of null")
          const w = e.nativeEvent.layout.width;
          setControls((c) => (c.w === w ? c : { ...c, w }));
        }}
        onContentSizeChange={(w) => setControls((c) => ({ ...c, content: w }))}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x;
          setControls((c) => (Math.abs(c.x - x) > 4 ? { ...c, x } : c));
        }}
        scrollEventThrottle={64}
      >
        {/* 🎚️ szerkesztési mód: Gyors / Haladó / AI (D5) — a Gyors mód elrejti a haladó
            idővonal-vezérlőket és a kiegészítő sorokat, az eszköztár is rövidül */}
        <View style={styles.modeSeg} accessibilityRole="tablist" accessibilityLabel={t('editor.mode.label')}>
          {EDIT_MODES.map((m) => (
            <Pressable
              key={m}
              onPress={() => setEditMode(m)}
              hitSlop={6}
              style={[styles.modeBtn, editMode === m ? styles.modeBtnActive : null]}
              accessibilityRole="tab"
              accessibilityState={{ selected: editMode === m }}
              accessibilityHint={t(`editor.mode.hint_${m}`)}
            >
              <Text style={[styles.modeText, editMode === m ? styles.modeTextActive : null]}>
                {t(`editor.mode.${m}`)}
              </Text>
            </Pressable>
          ))}
        </View>
        {editMode === 'quick' ? null : (
          <>
            {/* 🔎 insight-sáv: sztori / tempó (NEM szerkesztési mód — elemző sáv) */}
            {(['story', 'pacing'] as const).map((k) => (
              <Pressable
                key={k}
                onPress={() => {
                  setInsightLane(k);
                  setTimelineExtras(true);
                }}
                hitSlop={6}
                style={[styles.insightTab, timelineExtras && insightLane === k ? styles.insightTabActive : null]}
                accessibilityRole="button"
                accessibilityState={{ selected: timelineExtras && insightLane === k }}
              >
                <Text
                  style={[
                    styles.insightTabText,
                    timelineExtras && insightLane === k ? styles.insightTabTextActive : null,
                  ]}
                >
                  {t('editor.insight.' + k)}
                </Text>
              </Pressable>
            ))}
            {/* ⌃ a kiegészítő sorok (sztori/tempó-sáv + térkép) EGY gesztussal csukhatók (D6) */}
            <Pressable
              onPress={() => setTimelineExtras(!timelineExtras)}
              hitSlop={6}
              style={styles.iconBtn}
              accessibilityRole="button"
              accessibilityLabel={t(timelineExtras ? 'editor.timeline.extrasHide' : 'editor.timeline.extrasShow')}
            >
              <Ionicons name={timelineExtras ? 'chevron-up' : 'chevron-down'} size={13} color={palette.textDim} />
            </Pressable>
          {/* ✂️ trim-mód: normal → ripple → roll → slip → slide (a fogantyú/test-húzás viselkedése) */}
          <Pressable
            onPress={cycleTrimMode}
            hitSlop={4}
            style={[styles.snapBtn, { marginLeft: 'auto' }, trimMode !== 'normal' ? styles.iconBtnActive : null]}
            accessibilityLabel={t('editor.trim.label')}
          >
            <Ionicons
              name="git-compare-outline"
              size={12}
              color={trimMode === 'normal' ? palette.textDim : palette.accent}
            />
            <Text style={[styles.regionAddText, trimMode === 'normal' ? { color: palette.textDim } : { color: palette.accent }]}>
              {t('editor.trim.' + trimMode)}
            </Text>
          </Pressable>
          {/* ✂️ borotva-mód: koppintásra vág az idővonalon */}
          <Pressable
            onPress={toggleRazorMode}
            hitSlop={4}
            style={[styles.iconBtn, razorMode ? styles.iconBtnActive : null]}
            accessibilityLabel={t('editor.razor.label')}
          >
            <Ionicons name="cut" size={13} color={razorMode ? palette.accent : palette.textDim} />
          </Pressable>
          {/* ⇥⇤ tartomány kezdet/vég a lejátszófejnél — ikon + Be/Ki felirat (a csupasz I/O betű helyett, D4) */}
          <Pressable
            onPress={setRangeIn}
            hitSlop={4}
            style={[styles.iconBtn, rangeIn != null ? styles.iconBtnActive : null]}
            accessibilityLabel={t('editor.range.setIn')}
          >
            <Ionicons name="log-in-outline" size={13} color={rangeIn != null ? palette.accent : palette.textDim} />
            <Text style={[styles.ioText, rangeIn != null ? { color: palette.accent } : null]}>{t('editor.range.inShort')}</Text>
          </Pressable>
          <Pressable
            onPress={setRangeOut}
            hitSlop={4}
            style={[styles.iconBtn, rangeOut != null ? styles.iconBtnActive : null]}
            accessibilityLabel={t('editor.range.setOut')}
          >
            <Ionicons name="log-out-outline" size={13} color={rangeOut != null ? palette.accent : palette.textDim} />
            <Text style={[styles.ioText, rangeOut != null ? { color: palette.accent } : null]}>{t('editor.range.outShort')}</Text>
          </Pressable>
          {/* 🧲 illesztés + 🏷️ régió — MINDIG egy sorban (nem törhet külön a kettő) */}
          <View style={styles.snapRegionGroup}>
            {/* 🧲 illesztés-erősség: normál → erős → ki (hosszú nyomás: célpont-menü) */}
            <Pressable
              onPress={cycleSnapStrength}
              onLongPress={() => openSnapMenu(t, snapTargets, toggleSnapTarget)}
              hitSlop={4}
              style={styles.snapBtn}
              accessibilityLabel={t('editor.snap.label')}
            >
              <Ionicons
                name={snapStrength === 'off' ? 'magnet-outline' : 'magnet'}
                size={12}
                color={snapStrength === 'off' ? palette.textDim : palette.accent2}
              />
              <Text style={[styles.regionAddText, snapStrength === 'off' ? { color: palette.textDim } : null]}>
                {t('editor.snap.' + snapStrength)}
              </Text>
            </Pressable>
            {/* 🏷️ régió a kijelölt klipből / a lejátszófejnél */}
            <Pressable
              onPress={addRegion}
              hitSlop={4}
              style={styles.regionAddBtn}
              accessibilityLabel={t('editor.regions.add')}
            >
              <Ionicons name="bookmarks-outline" size={12} color={palette.accent2} />
              <Text style={styles.regionAddText}>{t('editor.regions.add')}</Text>
            </Pressable>
          </View>
          </>
        )}
      </ScrollView>
      {/* ➡️ görgetés-jelzés: ha jobbra még van vezérlő, elhalványuló szél + nyíl (D4) */}
      {controls.content - controls.x - controls.w > 6 ? (
        <LinearGradient
          pointerEvents="none"
          colors={[`${palette.bg}00`, palette.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.moreFade}
        >
          <Ionicons name="chevron-forward" size={14} color={palette.textDim} />
        </LinearGradient>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  snapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  // 🧲+🏷️ illesztés és régió EGY sorban tartva — a csoport egyben tördel (soha nem
  // válik szét két sorba). A jobbra-tolást a trim gomb `marginLeft: auto`-ja intézi;
  // itt NINCS második auto-margó (az okozta korábban a két sorba csúszást).
  snapRegionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  regionAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  regionAddText: {
    color: palette.accent2,
    fontSize: 11,
    fontWeight: '700',
  },
  // a vízszintes ScrollView kerete (fix magasság, nem nő a vezérlőkkel)
  insightTabsBar: {
    flexGrow: 0,
    marginHorizontal: 8,
    marginBottom: 3,
  },
  // a görgethető TARTALOM: egy sor; minWidth:100% → ha kifér, a trim marginLeft:auto-ja
  // jobbra igazít (mint eddig); ha nem fér ki, görgethető (nem tör új sorba)
  insightTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: '100%',
  },
  iconBtn: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 28,
    minHeight: 28,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  iconBtnActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  ioText: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '800',
  },
  controlsWrap: {
    position: 'relative',
  },
  moreFade: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 3,
    width: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  modeSeg: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  modeBtn: {
    paddingHorizontal: 9,
    minHeight: 28,
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
  },
  modeBtnActive: {
    backgroundColor: palette.accentSoft,
  },
  modeText: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
  },
  modeTextActive: {
    color: palette.accent,
  },
  insightTab: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    minHeight: 28,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surfaceHigh,
  },
  insightTabActive: {
    borderColor: palette.accent,
    backgroundColor: palette.accentSoft,
  },
  insightTabText: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  insightTabTextActive: {
    color: palette.accent,
  },
});

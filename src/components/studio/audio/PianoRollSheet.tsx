import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UserPresetRow } from '@/components/studio/audio/UserPresetRow';
import { PreviewPlayButton } from '@/components/studio/audio/PreviewPlayButton';
import { auditionNote } from '@/lib/instrumentPreview';
import { padTo, renderSynthPcm } from '@/lib/instrumentRender';
import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { palette } from '@/constants/editor';
import { registerDevAction } from '@/lib/devActions';
import { makeId } from '@/lib/id';
import {
  cycleNoteVelocity,
  DEFAULT_HIGH_MIDI,
  DEFAULT_LOW_MIDI,
  isBlackKey,
  noteAt,
  noteLabel,
  NOTE_VELOCITIES,
  pitchRows,
  synthDurationSec,
  toggleNote,
  type SynthNote,
  type SynthWave,
} from '@/lib/synth';

/** a hang-sor magassága — a workspace-ben 28 pt (könnyebb eltalálni, mint a régi 20) */
const ROW_H = 28;
const CELL_W = 34;
const GUTTER_W = 42;
const WAVES: SynthWave[] = ['sine', 'square', 'triangle', 'sawtooth'];
const WAVE_ICON: Record<SynthWave, keyof typeof Ionicons.glyphMap> = {
  sine: 'pulse-outline',
  square: 'square-outline',
  triangle: 'triangle-outline',
  sawtooth: 'trending-up-outline',
};

const VEL_KEY: Record<number, string> = { 50: 'soft', 100: 'mid', 127: 'hard' };

/**
 * 🎹 PIANO-ROLL (AUDIOT §5): hangjegy-szerkesztő rács (hangmagasság-sorok × ütem-oszlopok).
 * Koppintás = hang hozzáad/törlés (a választott erősséggel); hosszan nyomva a hang erőssége
 * (közepes → erős → halk); a hullámforma választható. A „Sávra" a worker `/synth`-jén
 * hanggá rendereli (MIDI→frekvencia), és a Hang Stúdió sima klipként teszi a music-sávra.
 */
export function PianoRollSheet({
  bpm,
  busy,
  onClose,
  onBake,
}: {
  bpm: number;
  busy: boolean;
  onClose: () => void;
  onBake: (notes: SynthNote[], wave: SynthWave) => void;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<SynthNote[]>([]);
  const [wave, setWave] = useState<SynthWave>('sine');
  const [bars, setBars] = useState(4);
  /** az új hangok velocity-je */
  const [noteVel, setNoteVel] = useState<number>(100);
  // 🧪 füstteszt (R7): a hangjegyek beállítása + a jelenlegiek
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const bakeRef = useRef(() => onBake(notes, wave));
  bakeRef.current = () => onBake(notes, wave);
  useEffect(() => {
    const offs = [
      registerDevAction('synth.set', (arg) => {
        const a = arg as { notes: Omit<SynthNote, 'id'>[]; wave?: SynthWave; bars?: number };
        setNotes(a.notes.map((n) => ({ ...n, id: makeId('note') })));
        if (a.wave) setWave(a.wave);
        if (a.bars) setBars(a.bars);
        return true;
      }),
      registerDevAction('synth.bake', () => bakeRef.current()),
      registerDevAction('synth.notes', () => notesRef.current.map((n) => `${n.midi}@${n.startBeat}v${n.velocity ?? 100}`).join(',')),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const rows = pitchRows(DEFAULT_LOW_MIDI, DEFAULT_HIGH_MIDI);
  const beats = bars * 4;
  const cols = Array.from({ length: beats }, (_, i) => i);
  const durSec = synthDurationSec(notes, bpm);

  const tap = (midi: number, beat: number) => {
    // 🎧 az új hang azonnal megszólal (offline, a telefonon)
    if (!noteAt(notes, midi, beat)) void auditionNote(midi, wave, bpm, noteVel);
    setNotes((prev) => toggleNote(prev, midi, beat, () => makeId('note'), 1, noteVel));
  };
  const longPress = (midi: number, beat: number) => {
    const n = noteAt(notes, midi, beat);
    if (!n) return;
    const next = cycleNoteVelocity(notes, n.id);
    setNotes(next);
    void auditionNote(midi, wave, bpm, next.find((x) => x.id === n.id)?.velocity ?? 100);
  };

  return (
    <AudioSheetFrame id="pianoRoll" onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.handleRow}>
        <Text style={styles.title}>
          <Ionicons name="musical-notes" size={16} color={palette.accent} /> {t('studio.pianoRoll.title', { defaultValue: 'Zeneszerzés' })}
        </Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Ionicons name="close" size={24} color={palette.textDim} />
        </Pressable>
      </View>

      {/* vezérlők */}
      <View style={styles.controls}>
        {WAVES.map((w) => (
          <Pressable key={w} onPress={() => setWave(w)} style={[styles.waveBtn, wave === w && styles.waveBtnActive]}>
            <Ionicons name={WAVE_ICON[w]} size={14} color={wave === w ? '#fff' : palette.textDim} />
            <Text style={[styles.waveText, wave === w && { color: '#fff' }]}>{t(`studio.pianoRoll.wave.${w}`, { defaultValue: w })}</Text>
          </Pressable>
        ))}
        <View style={styles.spacer} />
        <Pressable onPress={() => setBars((b) => Math.max(1, b - 1))} hitSlop={6} style={styles.stepBtn}>
          <Ionicons name="remove" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.barsText}>{bars} {t('studio.pianoRoll.bars', { defaultValue: 'ütem' })}</Text>
        <Pressable onPress={() => setBars((b) => Math.min(8, b + 1))} hitSlop={6} style={styles.stepBtn}>
          <Ionicons name="add" size={16} color={palette.text} />
        </Pressable>
      </View>

      {/* az új hangok erőssége (a meglévőé: hosszan nyomva) */}
      <View style={styles.controls}>
        <Text style={styles.velLabel}>{t('studio.pianoRoll.velocity', { defaultValue: 'Erősség' })}</Text>
        {NOTE_VELOCITIES.map((v) => (
          <Pressable key={v} testID={`pianoroll-vel-${v}`} onPress={() => setNoteVel(v)} style={[styles.waveBtn, noteVel === v && styles.waveBtnActive]} accessibilityState={{ selected: noteVel === v }}>
            <Text style={[styles.waveText, noteVel === v && { color: '#fff' }]}>{t(`studio.pianoRoll.vel.${VEL_KEY[v]}`, { defaultValue: VEL_KEY[v] })}</Text>
          </Pressable>
        ))}
      </View>

      {/* ⭐ saját dallamok (hangjegyek + hullámforma + ütemszám) */}
      <UserPresetRow
        kind="synth"
        getValue={() => (notes.length > 0 ? { bars, wave, notes: notes.map(({ id: _id, ...n }) => n) } : null)}
        onApply={(v) => {
          setBars(v.bars);
          setWave(v.wave);
          setNotes(v.notes.map((n) => ({ ...n, id: makeId('note') })));
        }}
      />

      {/* rács: függőleges (hangmagasság) + vízszintes (ütem) görgetés */}
      <ScrollView style={styles.gridV} contentContainerStyle={{ paddingBottom: 4 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {rows.map((midi) => {
              const black = isBlackKey(midi);
              return (
                <View key={midi} style={styles.row}>
                  <View style={[styles.gutter, black && styles.gutterBlack]}>
                    <Text style={styles.gutterText}>{noteLabel(midi)}</Text>
                  </View>
                  {cols.map((beat) => {
                    const note = noteAt(notes, midi, beat);
                    const on = !!note;
                    const vel = note?.velocity ?? 100;
                    const barStart = beat % 4 === 0;
                    return (
                      <Pressable
                        key={beat}
                        onPress={() => tap(midi, beat)}
                        onLongPress={() => longPress(midi, beat)}
                        accessibilityLabel={`${noteLabel(midi)} ${beat + 1}`}
                        accessibilityState={{ selected: on }}
                        style={[
                          styles.cell,
                          black && styles.cellBlack,
                          barStart && styles.cellBar,
                          on && styles.cellOn,
                          on && vel >= 127 && styles.cellHard,
                          on && vel < 100 && styles.cellSoft,
                        ]}
                      />
                    );
                  })}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerInfo}>
          {notes.length} {t('studio.pianoRoll.notes', { defaultValue: 'hang' })} · {durSec.toFixed(1)}s
        </Text>
        <PreviewPlayButton
          testID="pianoroll-play"
          disabled={notes.length === 0}
          version={`${wave}|${bpm}|${bars}|${notes.map((n) => `${n.midi}@${n.startBeat}v${n.velocity ?? 100}`).join(',')}`}
          build={() => (notes.length > 0 ? padTo(renderSynthPcm(notes, wave, bpm), Math.max(bars * 4, Math.ceil(synthDurationSec(notes, bpm) * (bpm / 60))) * (60 / bpm)) : null)}
        />
        <Pressable onPress={() => setNotes([])} style={styles.clearBtn} disabled={notes.length === 0}>
          <Ionicons name="trash-outline" size={15} color={notes.length === 0 ? palette.border : palette.textDim} />
          <Text style={styles.clearText}>{t('common.clear', { defaultValue: 'Törlés' })}</Text>
        </Pressable>
        <Pressable
          onPress={() => onBake(notes, wave)}
          disabled={busy || notes.length === 0}
          style={[styles.bakeBtn, (busy || notes.length === 0) && styles.disabled]}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="checkmark" size={16} color="#fff" />
          )}
          <Text style={styles.bakeText}>{t('studio.pianoRoll.bake', { defaultValue: 'Sávra' })}</Text>
        </Pressable>
      </View>
    </AudioSheetFrame>
  );
}

const styles = StyleSheet.create({
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 12, maxHeight: '90%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  waveBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: palette.border, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 6, backgroundColor: palette.surface },
  waveBtnActive: { backgroundColor: palette.accent, borderColor: palette.accent },
  waveText: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  spacer: { flex: 1 },
  stepBtn: { padding: 5, borderWidth: 1, borderColor: palette.border, borderRadius: 8 },
  barsText: { color: palette.text, fontSize: 12, fontWeight: '700', minWidth: 46, textAlign: 'center' },
  // a rács kitölti a workspace-t (a régi fix 360 pt helyett)
  gridV: { flex: 1 },
  row: { flexDirection: 'row', height: ROW_H },
  gutter: { width: GUTTER_W, height: ROW_H, justifyContent: 'center', paddingLeft: 4, backgroundColor: '#0d0f16', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  gutterBlack: { backgroundColor: '#070910' },
  gutterText: { color: palette.textDim, fontSize: 8, fontWeight: '700' },
  cell: { width: CELL_W, height: ROW_H, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: `${palette.border}55`, backgroundColor: '#0b0d14' },
  cellBlack: { backgroundColor: '#080a11' },
  cellBar: { borderLeftWidth: 1, borderLeftColor: palette.border },
  cellOn: { backgroundColor: palette.accent },
  cellHard: { borderWidth: 2, borderColor: '#fff' },
  cellSoft: { opacity: 0.45 },
  velLabel: { color: palette.textDim, fontSize: 11, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  footerInfo: { flex: 1, color: palette.textDim, fontSize: 12, fontWeight: '600' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  clearText: { color: palette.textDim, fontSize: 13, fontWeight: '700' },
  bakeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.accent, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  bakeText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  disabled: { opacity: 0.5 },
});

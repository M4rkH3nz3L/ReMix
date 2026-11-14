import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { UserPresetRow } from '@/components/studio/audio/UserPresetRow';
import { PreviewPlayButton } from '@/components/studio/audio/PreviewPlayButton';
import { auditionNote } from '@/lib/instrumentPreview';
import { padTo, renderSynthPcm } from '@/lib/instrumentRender';
import { AudioSheetFrame } from '@/components/studio/audio/AudioSheetFrame';
import { palette } from '@/constants/editor';
import { registerDevAction } from '@/lib/devActions';
import type { InstrumentDoc } from '@/types/project';
import { makeId } from '@/lib/id';
import { exportMidiFile, pickMidiFile, readMidiFile } from '@/lib/midiClient';
import type { MidiSong } from '@/lib/midiFile';
import { snapMidiToScale, type MusicKey, type ScaleName } from '@/lib/pitch';
import {
  cycleNoteVelocity,
  DEFAULT_HIGH_MIDI,
  DEFAULT_LOW_MIDI,
  inScale,
  isBlackKey,
  noteAt,
  noteCovering,
  noteLabel,
  NOTE_VELOCITIES,
  pitchRows,
  shiftOctave,
  STEP_GRIDS,
  synthDurationSec,
  tapCell,
  type StepsPerBeat,
  type SynthNote,
  type SynthWave,
} from '@/lib/synth';

/** a felületen választható skálák (a `pitch.ts` kulcsai közül a leggyakoribbak) */
const SCALE_CHOICES: ScaleName[] = ['major', 'naturalMinor', 'pentatonicMajor', 'pentatonicMinor', 'dorian', 'mixolydian'];
const ROOT_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

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
  initial = null,
}: {
  bpm: number;
  busy: boolean;
  onClose: () => void;
  onBake: (notes: SynthNote[], wave: SynthWave, bars: number) => void;
  /** 🎹 a szerkesztett hangszer-minta (újraszerkesztés); null = új dallam */
  initial?: InstrumentDoc | null;
}) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<SynthNote[]>(() => initial?.synth?.notes.map((n) => ({ ...n })) ?? []);
  const [wave, setWave] = useState<SynthWave>(() => initial?.synth?.wave ?? 'sine');
  const [bars, setBars] = useState(() => initial?.bars ?? 4);
  /** az új hangok velocity-je */
  const [noteVel, setNoteVel] = useState<number>(100);
  // 🎹 S11: rács-felbontás, skála (kiemelés + illesztés), látható oktávok
  const [stepsPerBeat, setStepsPerBeat] = useState<StepsPerBeat>(4);
  const [key, setKey] = useState<MusicKey | null>(null);
  const [snap, setSnap] = useState(true);
  const [range, setRange] = useState({ lowMidi: DEFAULT_LOW_MIDI, highMidi: DEFAULT_HIGH_MIDI });
  const rows = pitchRows(range.lowMidi, range.highMidi);
  const cols = Array.from({ length: bars * 4 * stepsPerBeat }, (_, i) => i);
  const durSec = synthDurationSec(notes, bpm);

  /** a sor, amire a koppintás esik: skála-illesztéssel a legközelebbi skálahang */
  const targetMidi = (midi: number) => (key && snap ? snapMidiToScale(midi, key) : midi);
  const tap = (midi: number, beat: number) => {
    const m = targetMidi(midi);
    // 🎧 az új vagy hosszabbodó hang azonnal megszólal (offline, a telefonon)
    if (!noteAt(notes, m, beat)) void auditionNote(m, wave, bpm, noteVel);
    setNotes((prev) => tapCell(prev, m, beat, stepsPerBeat, () => makeId('note'), noteVel));
  };
  const longPress = (midi: number, beat: number) => {
    const n = noteAt(notes, midi, beat) ?? noteCovering(notes, midi, beat);
    if (!n) return;
    const next = cycleNoteVelocity(notes, n.id);
    setNotes(next);
    void auditionNote(midi, wave, bpm, next.find((x) => x.id === n.id)?.velocity ?? 100);
  };

  // 🧪 füstteszt (R7 + S11): a hangjegyek, a rács, a skála, az oktáv beállítása + a jelenlegiek
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const bakeRef = useRef(() => onBake(notes, wave, bars));
  bakeRef.current = () => onBake(notes, wave, bars);
  // 🎼 V1: MIDI be / ki — a hangok a piano roll modelljébe (beat, erősség), a rács hossza a dallamhoz
  const applyMidi = (song: MidiSong | null | undefined) => {
    if (song === undefined) return false;
    if (!song || song.notes.length === 0) {
      Alert.alert(t('studio.pianoRoll.midiImport'), t('studio.pianoRoll.midiEmpty'));
      return false;
    }
    const next = song.notes.slice(0, 400).map((n) => ({ id: makeId('note'), midi: n.midi, startBeat: n.startBeat, lengthBeats: n.lengthBeats, velocity: n.velocity }));
    const endBeat = next.reduce((m, n) => Math.max(m, n.startBeat + n.lengthBeats), 0);
    setNotes(next);
    setBars(Math.max(1, Math.min(8, Math.ceil(endBeat / 4))));
    const lo = Math.min(...next.map((n) => n.midi));
    if (lo < range.lowMidi || lo > range.highMidi) setRange({ lowMidi: Math.max(24, Math.min(60, lo - (lo % 12))), highMidi: Math.max(24, Math.min(60, lo - (lo % 12))) + 36 });
    return true;
  };
  const importMidi = async () => applyMidi(await pickMidiFile());
  const exportMidi = (share = true) => exportMidiFile(t('studio.pianoRoll.title'), notes, { bpm, share });
  const midiRef = useRef({ applyMidi, exportMidi });
  midiRef.current = { applyMidi, exportMidi };
  const tapRef = useRef(tap);
  tapRef.current = tap;
  const stateRef = useRef({ stepsPerBeat, key, snap, range });
  stateRef.current = { stepsPerBeat, key, snap, range };
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
      registerDevAction('synth.notesFull', () => notesRef.current.map((n) => `${n.midi}@${n.startBeat}+${Math.round(n.lengthBeats * 1000) / 1000}`).join(',')),
      registerDevAction('synth.grid', (arg) => {
        setStepsPerBeat(arg as StepsPerBeat);
        return true;
      }),
      registerDevAction('synth.scale', (arg) => {
        const a = arg as { root?: number; scale?: ScaleName; snap?: boolean } | null;
        setKey(a && a.scale ? { root: a.root ?? 0, scale: a.scale } : null);
        if (a && a.snap !== undefined) setSnap(a.snap);
        return true;
      }),
      registerDevAction('synth.octave', (arg) => {
        setRange((r) => shiftOctave(r.lowMidi, r.highMidi, (arg as 1 | -1) ?? 1));
        return true;
      }),
      registerDevAction('synth.tap', (arg) => {
        const a = arg as { midi: number; beat: number };
        tapRef.current(a.midi, a.beat);
        return true;
      }),
      registerDevAction('synth.state', () => ({ ...stateRef.current })),
      registerDevAction('synth.midiExport', () => midiRef.current.exportMidi(false)),
      registerDevAction('synth.midiImport', (arg) => midiRef.current.applyMidi(readMidiFile(String(arg)))),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  return (
    <AudioSheetFrame id="pianoRoll" onClose={onClose} sheetStyle={styles.sheet}>
      <View style={styles.handleRow}>
        <Text style={styles.title}>
          <Ionicons name="musical-notes" size={16} color={palette.accent} /> {t('studio.pianoRoll.title', { defaultValue: 'Zeneszerzés' })}
        </Text>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('common.close')}>
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
        <Pressable onPress={() => setBars((b) => Math.max(1, b - 1))} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.fewerBars')}>
          <Ionicons name="remove" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.barsText}>{bars} {t('studio.pianoRoll.bars', { defaultValue: 'ütem' })}</Text>
        <Pressable onPress={() => setBars((b) => Math.min(8, b + 1))} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.audio.a11y.moreBars')}>
          <Ionicons name="add" size={16} color={palette.text} />
        </Pressable>
      </View>

      {/* az új hangok erőssége (a meglévőé: hosszan nyomva) + a rács felbontása */}
      <View style={styles.controls}>
        <Text style={styles.velLabel}>{t('studio.pianoRoll.velocity', { defaultValue: 'Erősség' })}</Text>
        {NOTE_VELOCITIES.map((v) => (
          <Pressable key={v} testID={`pianoroll-vel-${v}`} onPress={() => setNoteVel(v)} style={[styles.waveBtn, noteVel === v && styles.waveBtnActive]} accessibilityRole="button" accessibilityState={{ selected: noteVel === v }}>
            <Text style={[styles.waveText, noteVel === v && { color: '#fff' }]}>{t(`studio.pianoRoll.vel.${VEL_KEY[v]}`, { defaultValue: VEL_KEY[v] })}</Text>
          </Pressable>
        ))}
        <View style={styles.spacer} />
        <Text style={styles.velLabel}>{t('studio.pianoRoll.grid')}</Text>
        {STEP_GRIDS.map((g) => (
          <Pressable key={g} testID={`pianoroll-grid-${g}`} onPress={() => setStepsPerBeat(g)} style={[styles.waveBtn, stepsPerBeat === g && styles.waveBtnActive]} accessibilityRole="button" accessibilityState={{ selected: stepsPerBeat === g }}>
            <Text style={[styles.waveText, stepsPerBeat === g && { color: '#fff' }]}>{t(`studio.pianoRoll.gridStep_${g}`)}</Text>
          </Pressable>
        ))}
      </View>

      {/* 🎼 skála: kiemelés a rácson + illesztés a legközelebbi skálahangra; oktáv-görgetés C1…C7 */}
      <View style={styles.controls}>
        <Text style={styles.velLabel}>{t('studio.pianoRoll.scale')}</Text>
        <Pressable testID="pianoroll-scale-off" onPress={() => setKey(null)} style={[styles.waveBtn, !key && styles.waveBtnActive]} accessibilityRole="button" accessibilityState={{ selected: !key }}>
          <Text style={[styles.waveText, !key && { color: '#fff' }]}>{t('studio.pianoRoll.scaleOff')}</Text>
        </Pressable>
        <Pressable
          testID="pianoroll-scale-root"
          onPress={() => setKey((k) => ({ root: ((k?.root ?? -1) + 1) % 12, scale: k?.scale ?? 'major' }))}
          style={[styles.waveBtn, !!key && styles.waveBtnActive]}
          accessibilityRole="button"
          accessibilityLabel={`${t('studio.pianoRoll.scale')}: ${key ? ROOT_NAMES[key.root] : t('studio.pianoRoll.scaleOff')}`}
        >
          <Text style={[styles.waveText, !!key && { color: '#fff' }]}>{key ? ROOT_NAMES[key.root] : 'C'}</Text>
        </Pressable>
        <Pressable
          testID="pianoroll-scale-name"
          onPress={() => setKey((k) => ({ root: k?.root ?? 0, scale: SCALE_CHOICES[(SCALE_CHOICES.indexOf(k?.scale ?? 'mixolydian') + 1) % SCALE_CHOICES.length] }))}
          style={[styles.waveBtn, !!key && styles.waveBtnActive]}
          accessibilityRole="button"
          accessibilityLabel={`${t('studio.pianoRoll.scale')}: ${t(`studio.pianoRoll.scaleName_${key?.scale ?? 'major'}`)}`}
        >
          <Text style={[styles.waveText, !!key && { color: '#fff' }]}>{t(`studio.pianoRoll.scaleName_${key?.scale ?? 'major'}`)}</Text>
        </Pressable>
        {key ? (
          <Pressable testID="pianoroll-scale-snap" onPress={() => setSnap((s) => !s)} style={[styles.waveBtn, snap && styles.waveBtnActive]} accessibilityRole="switch" accessibilityState={{ checked: snap }} accessibilityLabel={t('studio.pianoRoll.snapScale')}>
            <Ionicons name="magnet-outline" size={14} color={snap ? '#fff' : palette.textDim} />
          </Pressable>
        ) : null}
        <View style={styles.spacer} />
        <Pressable onPress={() => setRange((r) => shiftOctave(r.lowMidi, r.highMidi, 1))} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.pianoRoll.octaveUp')} testID="pianoroll-octave-up">
          <Ionicons name="chevron-up" size={16} color={palette.text} />
        </Pressable>
        <Text style={styles.barsText}>{noteLabel(range.lowMidi)}–{noteLabel(range.highMidi)}</Text>
        <Pressable onPress={() => setRange((r) => shiftOctave(r.lowMidi, r.highMidi, -1))} hitSlop={6} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={t('studio.pianoRoll.octaveDown')} testID="pianoroll-octave-down">
          <Ionicons name="chevron-down" size={16} color={palette.text} />
        </Pressable>
      </View>
      <View style={styles.controls}>
        <Text style={[styles.hint, { flex: 1 }]} numberOfLines={2}>{t('studio.pianoRoll.tapHint')}</Text>
        <Pressable onPress={() => void importMidi()} style={styles.waveBtn} accessibilityRole="button" accessibilityLabel={t('studio.pianoRoll.midiImport')} testID="pianoroll-midi-in">
          <Ionicons name="download-outline" size={14} color={palette.textDim} />
          <Text style={styles.waveText}>{t('studio.pianoRoll.midiImport')}</Text>
        </Pressable>
        <Pressable onPress={() => void exportMidi()} disabled={notes.length === 0} style={[styles.waveBtn, notes.length === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel={t('studio.pianoRoll.midiExport')} testID="pianoroll-midi-out">
          <Ionicons name="share-outline" size={14} color={palette.textDim} />
          <Text style={styles.waveText}>{t('studio.pianoRoll.midiExport')}</Text>
        </Pressable>
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
              const scaled = inScale(midi, key);
              return (
                <View key={midi} style={styles.row}>
                  <View style={[styles.gutter, black && styles.gutterBlack, key && scaled && styles.gutterScale]}>
                    <Text style={[styles.gutterText, key && scaled && styles.gutterTextScale]}>{noteLabel(midi)}</Text>
                  </View>
                  {cols.map((col) => {
                    const beat = col / stepsPerBeat;
                    const start = noteAt(notes, midi, beat);
                    const covering = start ?? noteCovering(notes, midi, beat);
                    const on = !!covering;
                    const vel = covering?.velocity ?? 100;
                    const barStart = col % (4 * stepsPerBeat) === 0;
                    const beatStart = col % stepsPerBeat === 0;
                    return (
                      <Pressable
                        key={col}
                        onPress={() => tap(midi, beat)}
                        onLongPress={() => longPress(midi, beat)}
                        accessibilityLabel={`${noteLabel(midi)} ${Math.floor(beat) + 1}${stepsPerBeat > 1 ? `.${col % stepsPerBeat + 1}` : ''}`}
                        accessibilityState={{ selected: on }}
                        style={[
                          styles.cell,
                          { width: stepsPerBeat === 1 ? CELL_W : Math.max(18, Math.round(CELL_W / (stepsPerBeat / 2))) },
                          black && styles.cellBlack,
                          key && !scaled && styles.cellOffScale,
                          beatStart && styles.cellBeat,
                          barStart && styles.cellBar,
                          on && styles.cellOn,
                          on && !start && styles.cellOnTail,
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
          onPress={() => onBake(notes, wave, bars)}
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
  gutterScale: { borderLeftWidth: 3, borderLeftColor: palette.accent },
  gutterTextScale: { color: palette.text },
  hint: { color: palette.textDim, fontSize: 10, marginBottom: 6 },
  cell: { width: CELL_W, height: ROW_H, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: `${palette.border}55`, backgroundColor: '#0b0d14' },
  cellBlack: { backgroundColor: '#080a11' },
  cellOffScale: { opacity: 0.55 },
  cellBeat: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: `${palette.border}99` },
  cellBar: { borderLeftWidth: 1, borderLeftColor: palette.border },
  cellOn: { backgroundColor: palette.accent },
  cellOnTail: { borderRightWidth: 0, opacity: 0.85 },
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

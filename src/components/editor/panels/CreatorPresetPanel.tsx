import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { INTRO_TEMPLATES, OUTRO_TEMPLATES, type IntroTemplate, type OutroTemplate } from '@/lib/brandIntro';
import {
  applyCreatorPreset,
  creatorPresetSummary,
  deriveCreatorPreset,
  type CreatorPreset,
} from '@/lib/creatorPreset';
import {
  deleteCreatorPreset,
  loadCreatorPresets,
  saveCreatorPreset,
} from '@/lib/creatorPresetStore';
import { MOTION_PACKS, type MotionPack } from '@/lib/motionPacks';
import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';

const PACKS = Object.keys(MOTION_PACKS) as MotionPack[];

/**
 * 🎨 Creator Preset — a saját "stílus" (Font/Colors/Captions/Logo + Motion +
 * Intro/Outro + Sound) NEVEZETT csomagba mentve, egy gombbal a projektre húzva.
 */
export function CreatorPresetPanel() {
  const { t } = useTranslation();
  const setPanel = useEditorStore((s) => s.setPanel);

  const [presets, setPresets] = useState<CreatorPreset[]>([]);
  const [name, setName] = useState('');
  const [pack, setPack] = useState<MotionPack | null>(null);
  const [intro, setIntro] = useState<IntroTemplate | null>(null);
  const [outro, setOutro] = useState<OutroTemplate | null>(null);

  useEffect(() => {
    let alive = true;
    loadCreatorPresets().then((list) => {
      if (alive) setPresets(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    const project = useEditorStore.getState().project;
    if (!project) {
      return;
    }
    const preset = deriveCreatorPreset(project, name, { motionPack: pack, intro, outro });
    const next = await saveCreatorPreset(preset);
    setPresets(next);
    setName('');
    Alert.alert(t('panels.creatorPreset.title'), t('panels.creatorPreset.saved', { name: preset.name }));
  };

  const apply = (preset: CreatorPreset) => {
    const applied = applyCreatorPreset(preset);
    Alert.alert(
      t('panels.creatorPreset.title'),
      applied.length
        ? t('panels.creatorPreset.applied', { name: preset.name, parts: applied.join(', ') })
        : t('panels.creatorPreset.nothingToApply')
    );
    if (applied.length) {
      setPanel(null);
    }
  };

  const remove = (preset: CreatorPreset) => {
    deleteCreatorPreset(preset.id).then(setPresets);
  };

  return (
    <View>
      <PanelSection title={t('panels.creatorPreset.saveTitle')}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t('panels.creatorPreset.namePlaceholder')}
          placeholderTextColor={palette.textDim}
          style={styles.input}
        />
        <Text style={styles.subLabel}>{t('panels.creatorPreset.motion')}</Text>
        <View style={styles.row}>
          <Chip label={t('common.none')} active={!pack} onPress={() => setPack(null)} />
          {PACKS.map((p) => (
            <Chip key={p} label={MOTION_PACKS[p].label} active={pack === p} onPress={() => setPack(p)} />
          ))}
        </View>
        <Text style={styles.subLabel}>{t('panels.creatorPreset.intro')}</Text>
        <View style={styles.row}>
          <Chip label={t('common.none')} active={!intro} onPress={() => setIntro(null)} />
          {INTRO_TEMPLATES.map((it) => (
            <Chip key={it.id} label={t(it.label)} active={intro === it.id} onPress={() => setIntro(it.id)} />
          ))}
        </View>
        <Text style={styles.subLabel}>{t('panels.creatorPreset.outro')}</Text>
        <View style={styles.row}>
          <Chip label={t('common.none')} active={!outro} onPress={() => setOutro(null)} />
          {OUTRO_TEMPLATES.map((it) => (
            <Chip key={it.id} label={t(it.label)} active={outro === it.id} onPress={() => setOutro(it.id)} />
          ))}
        </View>
        <PrimaryButton icon="bookmark-outline" label={t('panels.creatorPreset.saveButton')} onPress={() => void save()} />
        <Text style={styles.note}>{t('panels.creatorPreset.saveNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.creatorPreset.listTitle')}>
        {presets.length === 0 ? (
          <Text style={styles.note}>{t('panels.creatorPreset.empty')}</Text>
        ) : (
          presets.map((preset) => (
            <View key={preset.id} style={styles.presetRow}>
              <View style={styles.presetInfo}>
                <Text style={styles.presetName}>{preset.name}</Text>
                <Text style={styles.presetMeta}>{creatorPresetSummary(preset).join(' · ') || '—'}</Text>
              </View>
              <Pressable hitSlop={6} onPress={() => remove(preset)} style={styles.iconBtn}>
                <Ionicons name="trash-outline" size={18} color={palette.danger} />
              </Pressable>
              <Pressable hitSlop={6} onPress={() => apply(preset)} style={styles.applyBtn}>
                <Text style={styles.applyText}>{t('panels.creatorPreset.apply')}</Text>
              </Pressable>
            </View>
          ))
        )}
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  subLabel: { color: palette.textDim, fontSize: 11, fontWeight: '700', marginTop: 10, marginBottom: 4 },
  note: { color: palette.textDim, fontSize: 11, lineHeight: 16, marginTop: 6 },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
  },
  presetInfo: { flex: 1 },
  presetName: { color: palette.text, fontSize: 14, fontWeight: '700' },
  presetMeta: { color: palette.textDim, fontSize: 11, marginTop: 2 },
  iconBtn: { padding: 4 },
  applyBtn: {
    backgroundColor: palette.accent,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  applyText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';

import { styles } from '@/components/editor/panels/export/exportStyles';
import type { ExportSettingsState } from '@/components/editor/panels/export/useExportSettings';
import { Chip } from '@/components/ui/controls';
import { palette } from '@/constants/editor';

/** 🎚️ Advanced export-kontroll (lenyitható): bitráta / GOP / mélység / szín / audio */
export function AdvancedExportControls({ settings }: { settings: ExportSettingsState }) {
  const { t } = useTranslation();
  const {
    advOpen,
    setAdvOpen,
    setBitrateMode,
    setBitrateMbps,
    setGop,
    setBitDepth,
    setColorMode,
    setSampleRate,
    setChannels,
  } = settings;
  const { bitrateMode, bitrateMbps, gop, bitDepth, colorMode, sampleRate, channels } = settings.values;
  return (
    <>
      {/* 🎚️ Advanced export-kontroll: bitráta / GOP / mélység / szín / audio */}
      <Pressable style={styles.advToggle} onPress={() => setAdvOpen((v) => !v)}>
        <Ionicons name={advOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={palette.textDim} />
        <Text style={styles.advToggleText}>{t('panels.export.advanced')}</Text>
      </Pressable>
      {advOpen ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.settingLabel}>{t('panels.export.bitrateMode')}</Text>
          <View style={styles.row}>
            {(['crf', 'vbr', 'cbr'] as const).map((m) => (
              <Chip
                key={m}
                label={t('panels.export.bitrate_' + m)}
                active={bitrateMode === m}
                onPress={() => setBitrateMode(m)}
              />
            ))}
          </View>
          {bitrateMode !== 'crf' ? (
            <>
              <Text style={styles.settingLabel}>{t('panels.export.bitrate')}</Text>
              <View style={styles.row}>
                {[6, 10, 16, 24, 40].map((b) => (
                  <Chip key={b} label={`${b} Mbps`} active={bitrateMbps === b} onPress={() => setBitrateMbps(b)} />
                ))}
              </View>
            </>
          ) : null}
          <Text style={styles.settingLabel}>{t('panels.export.gop')}</Text>
          <View style={styles.row}>
            {[
              { v: 0, l: t('panels.export.gopAuto') },
              { v: 30, l: '30' },
              { v: 60, l: '60' },
              { v: 120, l: '120' },
            ].map((g) => (
              <Chip key={g.v} label={g.l} active={gop === g.v} onPress={() => setGop(g.v)} />
            ))}
          </View>
          <Text style={styles.settingLabel}>{t('panels.export.bitDepth')}</Text>
          <View style={styles.row}>
            {([8, 10] as const).map((d) => (
              <Chip key={d} label={`${d}-bit`} active={bitDepth === d} onPress={() => setBitDepth(d)} />
            ))}
          </View>
          <Text style={styles.settingLabel}>{t('panels.export.colorSpace')}</Text>
          <View style={styles.row}>
            {(
              [
                { id: 'rec709', l: 'Rec.709' },
                { id: 'rec2020', l: 'Rec.2020' },
                { id: 'hdr', l: 'HDR' },
              ] as const
            ).map((c) => (
              <Chip key={c.id} label={c.l} active={colorMode === c.id} onPress={() => setColorMode(c.id)} />
            ))}
          </View>
          <Text style={styles.settingLabel}>{t('panels.export.audio')}</Text>
          <View style={styles.row}>
            {([44100, 48000] as const).map((sr) => (
              <Chip key={sr} label={`${sr / 1000} kHz`} active={sampleRate === sr} onPress={() => setSampleRate(sr)} />
            ))}
            {(
              [
                { v: 1, l: t('panels.export.mono') },
                { v: 2, l: t('panels.export.stereo') },
              ] as const
            ).map((ch) => (
              <Chip key={ch.v} label={ch.l} active={channels === ch.v} onPress={() => setChannels(ch.v)} />
            ))}
          </View>
          <Text style={styles.note}>{t('panels.export.advancedNote')}</Text>
        </View>
      ) : null}
    </>
  );
}

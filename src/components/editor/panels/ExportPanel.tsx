import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Chip, PanelSection, PrimaryButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { deactivateProDev } from '@/lib/billing';
import { isNativeRenderAvailable } from '@/lib/nativeRender';
import { useEntitlement } from '@/store/entitlementStore';
import { guardPro, usePaywall } from '@/store/paywallStore';
import { withCancellableProgress, withProgress } from '@/store/progressStore';
import {
  composeThumbnail,
  fetchThumbHeadlines,
  saveAndShareThumbnail,
  suggestThumbnails,
} from '@/lib/thumbStudio';
import type { ThumbCandidate } from '@/lib/thumbStudio';
import {
  shareCaptionsAss,
  shareCaptionsSrt,
  shareCaptionsVtt,
  shareInteractiveMetadata,
} from '@/lib/export';
import { projectDuration } from '@/lib/projectUtils';
import { getTimelineTranscript } from '@/lib/transcripts';
import {
  collectAndShareProject,
  isRenderCancelledError,
  PLATFORM_PRESETS,
  renderAndPost,
  renderAndShareMp4,
} from '@/lib/render';
import type { ExportPlatform, PostTarget, RenderSettings } from '@/lib/render';
import { shareVidedFile } from '@/lib/videdFile';
import { publishRenderedProject } from '@/lib/feed';
import { useEditorStore } from '@/store/editorStore';
import { AiProviderPicker } from '@/components/editor/AiProviderPicker';
import { pullProject, pushProject } from '@/lib/cloudSync';

const RESOLUTIONS = [
  { label: '480p', value: 480 },
  { label: '720p', value: 720 },
  { label: '1080p', value: 1080 },
  { label: '4K', value: 2160 },
  { label: '8K', value: 4320 },
] as const;
const FPS_OPTIONS = [24, 30, 60] as const;
const QUALITIES = [
  { id: 'low' },
  { id: 'medium' },
  { id: 'high' },
] as const;
/** kodekek (a nevek fixek); az AV1/ProRes csak felhő-render (Pro) */
const CODECS = [
  { id: 'h264', label: 'H.264' },
  { id: 'hevc', label: 'HEVC' },
  { id: 'av1', label: 'AV1' },
  { id: 'prores', label: 'ProRes' },
] as const;

/** hozzávetőleges bitráta (Mbps) felbontás + minőség szerint, 30 fps-re */
const BASE_MBPS: Record<number, number> = { 480: 2.2, 720: 4.5, 1080: 8, 2160: 28, 4320: 90 };
const QUALITY_MULT = { low: 0.55, medium: 1, high: 1.5 } as const;

export function ExportPanel() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const restoreProject = useEditorStore((s) => s.restoreProject);
  const isPro = useEntitlement((s) => s.isPro());
  const proUntil = useEntitlement((s) => s.proUntil);
  const openPaywall = usePaywall((s) => s.open);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [collectStatus, setCollectStatus] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  const [resolution, setResolution] = useState<number>(1080);
  const [fps, setFps] = useState<number>(30);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [codec, setCodec] = useState<'h264' | 'hevc' | 'av1' | 'prores'>('h264');
  const [platform, setPlatform] = useState<ExportPlatform | null>(null);
  // 🎚️ Pro export-kontroll (Advanced): bitráta / GOP / bit-mélység / szín / audio
  const [advOpen, setAdvOpen] = useState(false);
  const [bitrateMode, setBitrateMode] = useState<'crf' | 'vbr' | 'cbr'>('crf');
  const [bitrateMbps, setBitrateMbps] = useState<number>(10);
  const [gop, setGop] = useState<number>(0); // 0 = auto (fps × 2)
  const [bitDepth, setBitDepth] = useState<8 | 10>(8);
  const [colorMode, setColorMode] = useState<'rec709' | 'rec2020' | 'hdr'>('rec709');
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(48000);
  const [channels, setChannels] = useState<1 | 2>(2);
  const [thumbStatus, setThumbStatus] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<ThumbCandidate[] | null>(null);
  const [headlines, setHeadlines] = useState<string[] | null>(null);
  const [headlineStatus, setHeadlineStatus] = useState<string | null>(null);
  const [selectedHeadline, setSelectedHeadline] = useState<string | null>(null);

  if (!project) {
    return null;
  }

  // 🎬 AI-címjavaslatok: projektnév + átirat-részlet a témához
  const loadHeadlines = async () => {
    if (headlineStatus) {
      return;
    }
    setHeadlineStatus(t('panels.export.writingHeadlines'));
    try {
      const transcript = await getTimelineTranscript(project).catch(() => null);
      const lines = (transcript ?? []).slice(0, 12).map((l) => l.text);
      const summary = `${project.name}\n${lines.join('\n')}`.slice(0, 800);
      const list = await fetchThumbHeadlines(summary);
      if (!list) {
        Alert.alert(t('panels.export.aiHeadlinesTitle'), t('panels.export.headlinesUnavailable'));
        return;
      }
      setHeadlines(list);
      setSelectedHeadline(list[0]);
    } finally {
      setHeadlineStatus(null);
    }
  };

  // kocka kiválasztása: címmel ráégetés, anélkül nyers mentés/megosztás
  const pickThumb = async (thumb: ThumbCandidate) => {
    try {
      let final = thumb;
      if (selectedHeadline) {
        setThumbStatus(t('panels.export.burningHeadline'));
        const composed = await composeThumbnail(thumb, selectedHeadline);
        setThumbStatus(null);
        if (!composed) {
          Alert.alert('Thumbnail Studio', t('panels.export.headlineBurnFailed'));
          return;
        }
        final = composed;
      }
      await saveAndShareThumbnail(final, project.name);
    } catch {
      setThumbStatus(null);
      Alert.alert('Thumbnail Studio', t('panels.export.saveFailed'));
    }
  };

  const durationSec = projectDuration(project);
  const mbps =
    bitrateMode === 'crf'
      ? (BASE_MBPS[resolution] ?? 8) * QUALITY_MULT[quality] * (0.35 + 0.65 * (fps / 30))
      : bitrateMbps;
  const estimatedMb = (durationSec * mbps) / 8;

  // az összes chip → egyetlen RenderSettings (a worker/natív render ezt kapja)
  const buildSettings = (): RenderSettings => ({
    resolution,
    fps,
    quality,
    codec,
    bitrateMode,
    bitrateMbps: bitrateMode === 'crf' ? undefined : bitrateMbps,
    gop: gop > 0 ? gop : undefined,
    bitDepth: colorMode === 'hdr' ? 10 : bitDepth,
    colorSpace: colorMode === 'rec2020' ? 'rec2020' : 'rec709',
    hdr: colorMode === 'hdr',
    sampleRate,
    channels,
    audioBitrateKbps: 192,
  });

  // 📲 platform-preset alkalmazása a chipekre (a felhasználó utána felülírhatja)
  const applyPlatform = (p: ExportPlatform) => {
    setPlatform(p);
    const s = PLATFORM_PRESETS[p].settings;
    if (s.resolution) setResolution(s.resolution);
    if (s.fps) setFps(s.fps);
    if (s.quality) setQuality(s.quality);
    if (s.codec) setCodec(s.codec);
    if (s.bitrateMode) setBitrateMode(s.bitrateMode);
    if (s.bitrateMbps) setBitrateMbps(s.bitrateMbps);
  };

  // 📱 Export az ESZKÖZÖN (ingyen, szerver nélkül) — a build natív renderelője
  const exportLocal = () => {
    if (renderStatus) {
      return; // már fut
    }
    setRenderStatus(t('common.processing'));
    withCancellableProgress(t('panels.export.exportOnDevice'), (report, signal) =>
      renderAndShareMp4(project, report, buildSettings(), { mode: 'local', signal })
    )
      .catch((err: Error) => {
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('panels.export.exportOnDevice'), err.message);
        }
      })
      .finally(() => setRenderStatus(null));
  };

  // ☁️ Felhő HD render (Pro) — a fizetős workereken; Pro-hiánynál paywall
  const exportCloud = () => {
    if (renderStatus) {
      return; // már fut
    }
    setRenderStatus(t('common.processing'));
    void guardPro(
      () =>
        withCancellableProgress(t('panels.export.cloudHdRender'), (report, signal) =>
          renderAndShareMp4(project, report, buildSettings(), { mode: 'cloud', signal })
        ),
      (err) => {
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('panels.export.cloudRenderTitle'), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  // 📱 Megosztás a FEEDBE: render (ha kell) → publikus feltöltés → poszt a
  // renderelt videóval. A renderelt változat a projekten marad (újramegosztáshoz).
  const shareToFeed = () => {
    if (renderStatus) {
      return;
    }
    setRenderStatus(t('common.processing'));
    void guardPro(
      () =>
        withProgress(t('feed.rendering'), (report) =>
          publishRenderedProject(project, report).then((res) => {
            useEditorStore.getState().setRendered(res.project.rendered);
            Alert.alert(t('feed.shareToFeed'), t('feed.sharedOk'), [
              { text: t('common.ok') },
              { text: t('nav.feed'), onPress: () => router.push('/feed') },
            ]);
          })
        ),
      (err) => {
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('feed.shareToFeed'), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  const guard = (fn: () => Promise<void>) => () => {
    fn().catch(() => Alert.alert(t('common.error'), t('panels.export.shareFailed')));
  };

  // 📲 Posztolás egy platformra: render → Fotókba mentés → a platform megnyitása.
  // 'auto': ha a build tudja, eszközön renderel (ingyen); különben felhő (Pro).
  const postTo = (target: PostTarget) => {
    if (renderStatus) {
      return;
    }
    setRenderStatus(t('common.processing'));
    void guardPro(
      () =>
        withCancellableProgress(t('panels.export.postTo', { target }), (report, signal) =>
          renderAndPost(project, target, report, buildSettings(), { mode: 'auto', signal })
        ),
      (err) => {
        if (!isRenderCancelledError(err)) {
          Alert.alert(t('panels.export.postingTitle'), err.message);
        }
      }
    ).finally(() => setRenderStatus(null));
  };

  // felirat-export a választott formátumban (SRT / WebVTT / ASS)
  const exportCaptions = (fmt: 'srt' | 'vtt' | 'ass') => {
    const share =
      fmt === 'vtt' ? shareCaptionsVtt : fmt === 'ass' ? shareCaptionsAss : shareCaptionsSrt;
    share(project)
      .then((had) => {
        if (!had) {
          Alert.alert(t('panels.export.noCaptionsTitle'), t('panels.export.noCaptionsMessage'));
        }
      })
      .catch(() => Alert.alert(t('common.error'), t('panels.export.shareFailed')));
  };

  // ☁️ projekt-terv felhő-mentése (Pro; a médiafájlok külön, későbbi lépés)
  const cloudBackup = async () => {
    if (cloudStatus) {
      return;
    }
    setCloudStatus(t('panels.export.cloudBackingUp'));
    try {
      await guardPro(
        async () => {
          await pushProject(project);
          Alert.alert(t('panels.export.cloudTitle'), t('panels.export.cloudBackupDone'));
        },
        (e) => Alert.alert(t('panels.export.cloudTitle'), e.message)
      );
    } finally {
      setCloudStatus(null);
    }
  };

  // ☁️ a felhő-mentett terv visszaállítása (undo-zható; a helyi restoreProject-en át)
  const cloudRestore = async () => {
    if (cloudStatus) {
      return;
    }
    setCloudStatus(t('panels.export.cloudRestoring'));
    try {
      await guardPro(
        async () => {
          const cloud = await pullProject(project.id);
          if (!cloud) {
            Alert.alert(t('panels.export.cloudTitle'), t('panels.export.cloudRestoreNone'));
            return;
          }
          restoreProject(cloud);
          Alert.alert(t('panels.export.cloudTitle'), t('panels.export.cloudRestoreDone'));
        },
        (e) => Alert.alert(t('panels.export.cloudTitle'), e.message)
      );
    } finally {
      setCloudStatus(null);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {isPro ? (
        // a hosszú-nyomásos Free-re-váltás CSAK dev-buildben (rejtett teszt-gesztus)
        <Pressable
          style={styles.proActive}
          onLongPress={__DEV__ ? () => void deactivateProDev() : undefined}
        >
          <Ionicons name="sparkles" size={15} color={palette.accent} />
          <Text style={styles.proActiveText}>
            {proUntil
              ? t('panels.export.proActiveUntil', {
                  date: new Date(proUntil).toLocaleDateString(),
                })
              : t('panels.export.proActive')}
          </Text>
        </Pressable>
      ) : (
        <Pressable style={styles.proBanner} onPress={() => openPaywall()}>
          <Ionicons name="rocket-outline" size={16} color={palette.text} />
          <Text style={styles.proBannerText}>
            {t('panels.export.proBanner')}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={palette.textDim} />
        </Pressable>
      )}

      <PrimaryButton
        label={t('feed.shareToFeed')}
        icon="play-circle-outline"
        onPress={shareToFeed}
        disabled={!!renderStatus}
      />
      {project.rendered ? (
        <Text style={{ color: palette.textDim, fontSize: 12, textAlign: 'center' }}>
          {t('panels.export.renderedReady')}
        </Text>
      ) : null}

      <PanelSection title={t('panels.export.videoSection')}>
        <Text style={styles.settingLabel}>{t('panels.export.platformPreset')}</Text>
        <View style={styles.row}>
          {(Object.keys(PLATFORM_PRESETS) as ExportPlatform[]).map((p) => (
            <Chip
              key={p}
              label={`${PLATFORM_PRESETS[p].label} ${PLATFORM_PRESETS[p].aspect}`}
              active={platform === p}
              onPress={() => applyPlatform(p)}
            />
          ))}
        </View>
        <Text style={styles.settingLabel}>{t('panels.export.resolution')}</Text>
        <View style={styles.row}>
          {RESOLUTIONS.map((r) => (
            <Chip
              key={r.value}
              label={r.label}
              active={resolution === r.value}
              onPress={() => setResolution(r.value)}
            />
          ))}
        </View>
        <Text style={styles.settingLabel}>{t('panels.export.frameRate')}</Text>
        <View style={styles.row}>
          {FPS_OPTIONS.map((f) => (
            <Chip
              key={f}
              label={`${f} fps`}
              active={fps === f}
              onPress={() => setFps(f)}
            />
          ))}
        </View>
        <Text style={styles.settingLabel}>{t('panels.export.quality')}</Text>
        <View style={styles.row}>
          {QUALITIES.map((q) => (
            <Chip
              key={q.id}
              label={t('panels.export.quality_' + q.id)}
              active={quality === q.id}
              onPress={() => setQuality(q.id)}
            />
          ))}
        </View>
        <Text style={styles.settingLabel}>{t('panels.export.codec')}</Text>
        <View style={styles.row}>
          {CODECS.map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              active={codec === c.id}
              onPress={() => setCodec(c.id)}
            />
          ))}
        </View>
        <Text style={styles.estimate}>
          {CODECS.find((c) => c.id === codec)?.label ?? 'H.264'} · {fps} fps · ~
          {estimatedMb < 1 ? '<1' : Math.round(estimatedMb)} MB
        </Text>
        <Text style={styles.note}>{t('panels.export.codecCloudNote')}</Text>

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

        <PrimaryButton
          icon="phone-portrait-outline"
          label={renderStatus ?? t('panels.export.exportOnDeviceFree')}
          onPress={exportLocal}
        />
        <Pressable
          style={[styles.cloudBtn, renderStatus ? styles.postBtnOff : null]}
          disabled={renderStatus !== null}
          onPress={exportCloud}
        >
          <Ionicons name="cloud-upload-outline" size={16} color={palette.accent} />
          <Text style={styles.cloudText}>{t('panels.export.cloudHdRender')}</Text>
          <View style={styles.proTag}>
            <Text style={styles.proTagText}>PRO</Text>
          </View>
        </Pressable>
        <Text style={styles.note}>
          {t('panels.export.videoNoteA')}<Text style={styles.strong}>{t('panels.export.videoNoteBoldLocal')}</Text>{t('panels.export.videoNoteB')}<Text style={styles.strong}>{t('panels.export.videoNoteBoldCloud')}</Text>{t('panels.export.videoNoteC')}
          {!isNativeRenderAvailable()
            ? t('panels.export.videoNoteExpoGo')
            : ''}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.export.postSection')}>
        <View style={styles.postRow}>
          {(
            [
              { target: 'tiktok', icon: 'logo-tiktok', color: palette.text, label: 'TikTok' },
              { target: 'reels', icon: 'logo-instagram', color: '#e1306c', label: 'Reels' },
              { target: 'youtube', icon: 'logo-youtube', color: '#ff0033', label: 'YouTube' },
              { target: 'other', icon: 'share-social-outline', color: palette.textDim, label: t('panels.export.otherPlatform') },
            ] as const
          ).map((p) => (
            <Pressable
              key={p.target}
              style={[styles.postBtn, renderStatus ? styles.postBtnOff : null]}
              disabled={renderStatus !== null}
              onPress={() => postTo(p.target)}
            >
              <Ionicons name={p.icon} size={20} color={p.color} />
              <Text style={styles.postText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.note}>
          {t('panels.export.postNote')}
        </Text>
      </PanelSection>

      <PanelSection title="Thumbnail Studio">
        <AiProviderPicker task="thumbHeadlines" />
        <PrimaryButton
          icon="images-outline"
          label={thumbStatus ?? t('panels.export.thumbSuggestions')}
          onPress={() => {
            if (thumbStatus) {
              return;
            }
            setThumbs(null);
            setThumbStatus(t('panels.export.findingBestFrames'));
            suggestThumbnails(project)
              .then((result) => {
                if (!result) {
                  Alert.alert(
                    'Thumbnail Studio',
                    t('panels.export.noVideoClip')
                  );
                  return;
                }
                setThumbs(result);
              })
              .finally(() => setThumbStatus(null));
          }}
        />
        {thumbs ? (
          <>
            <View style={styles.thumbRow}>
              {thumbs.map((thumb) => (
                <Pressable
                  key={thumb.t}
                  onPress={() => {
                    void pickThumb(thumb);
                  }}
                >
                  <Image source={{ uri: thumb.uri }} style={styles.thumb} contentFit="cover" />
                  <Text style={styles.thumbMeta}>{t('panels.export.seconds', { seconds: thumb.t.toFixed(0) })}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.headlineRow}>
              <Chip
                label={headlineStatus ?? t('panels.export.aiHeadlineChip')}
                active={false}
                onPress={() => {
                  void loadHeadlines();
                }}
              />
              {headlines?.map((h) => (
                <Chip
                  key={h}
                  label={h}
                  active={selectedHeadline === h}
                  onPress={() =>
                    setSelectedHeadline(selectedHeadline === h ? null : h)
                  }
                />
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.note}>
          {t('panels.export.thumbNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.export.captionsSection')}>
        <View style={styles.row}>
          <Chip label="SRT" active={false} onPress={() => exportCaptions('srt')} />
          <Chip label="WebVTT" active={false} onPress={() => exportCaptions('vtt')} />
          <Chip label="ASS" active={false} onPress={() => exportCaptions('ass')} />
        </View>
        <Text style={styles.note}>
          {t('panels.export.captionsNote')}
        </Text>
        <Text style={styles.note}>{t('panels.export.captionsFormatsNote')}</Text>
      </PanelSection>

      <PanelSection title={t('panels.export.interactiveSection')}>
        <PrimaryButton
          icon="code-download-outline"
          label={t('panels.export.shareHotspotJson')}
          onPress={guard(() => shareInteractiveMetadata(project))}
        />
        <Text style={styles.note}>
          {t('panels.export.interactiveNote')}
        </Text>
      </PanelSection>

      <PanelSection title={t('panels.export.projectFileSection')}>
        <PrimaryButton
          icon="document-outline"
          label={t('panels.export.shareRemixFile')}
          onPress={guard(() => shareVidedFile(project))}
        />
        <PrimaryButton
          icon="archive-outline"
          label={collectStatus ?? t('panels.export.collectZip')}
          onPress={() => {
            if (collectStatus) {
              return; // már fut
            }
            setCollectStatus(t('common.processing'));
            withProgress(t('panels.export.collectPackaging'), (report) =>
              collectAndShareProject(project, report)
            )
              .catch((err: Error) => Alert.alert('Collect', err.message))
              .finally(() => setCollectStatus(null));
          }}
        />
        <PrimaryButton
          icon="cloud-upload-outline"
          label={cloudStatus ?? t('panels.export.cloudBackupBtn')}
          onPress={() => {
            cloudBackup().catch((err: Error) => Alert.alert(t('panels.export.cloudTitle'), err.message));
          }}
        />
        <PrimaryButton
          icon="cloud-download-outline"
          label={t('panels.export.cloudRestoreBtn')}
          onPress={() => {
            cloudRestore().catch((err: Error) => Alert.alert(t('panels.export.cloudTitle'), err.message));
          }}
        />
        <Text style={styles.note}>
          {t('panels.export.projectFileNote')}
        </Text>
        <Text style={styles.note}>{t('panels.export.cloudSyncNote')}</Text>
      </PanelSection>
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    color: palette.textDim,
    fontSize: 11,
    lineHeight: 16,
  },
  strong: {
    color: palette.text,
    fontWeight: '700',
  },
  proBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.accentSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  proBannerText: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  proActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  proActiveText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  cloudBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingVertical: 12,
  },
  cloudText: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  proTag: {
    backgroundColor: palette.accent,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  proTagText: {
    color: palette.text,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  postRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  postBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: palette.surfaceHigh,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 12,
  },
  postBtnOff: {
    opacity: 0.45,
  },
  postText: {
    color: palette.text,
    fontSize: 11,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  settingLabel: {
    color: palette.textDim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  estimate: {
    color: palette.text,
    fontSize: 12,
    fontWeight: '600',
  },
  advToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  advToggleText: {
    color: palette.textDim,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  thumbRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  headlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  thumb: {
    width: 70,
    height: 124,
    borderRadius: 10,
    backgroundColor: palette.surfaceHigh,
  },
  thumbMeta: {
    color: palette.textDim,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 2,
  },
});

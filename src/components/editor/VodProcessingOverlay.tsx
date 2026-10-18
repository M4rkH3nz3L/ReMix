import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { palette } from '@/constants/editor';
import { useEditorStore } from '@/store/editorStore';
import type { VideoClip } from '@/types/project';

/**
 * ⏳ Live-VOD feldolgozás-loader (LIVE/05.1). Amikor a user leállítja a rögzített
 * adást, a VOD-projekt azonnal létrejön, de az egress a felvételt MÉG tölti fel az
 * R2-be → a videó-klip `pending`. Ez az overlay az editor fölött vár + pollozza a
 * klip `uri`-ját, és amint elérhető (HTTP 200/206), törli a `pending`-et a
 * command-buson (UPDATE_CLIP) → a klip-referencia változik → a PreviewSurface
 * `replaceAsync`-ja újratölti a mostanra kész videót.
 */

const POLL_MS = 2500;
// ennyi várakozás után felajánljuk a „most megnyitom" kézi feloldást (ne ragadjon be)
const SOFT_TIMEOUT_MS = 90_000;

function pendingVideoClips(project: ReturnType<typeof useEditorStore.getState>['project']): VideoClip[] {
  if (!project) {
    return [];
  }
  return project.tracks
    .flatMap((tr) => tr.clips)
    .filter((c): c is VideoClip => c.kind === 'video' && !!(c as VideoClip).pending && !!c.uri);
}

export function VodProcessingOverlay() {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [dismissed, setDismissed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const pending = useMemo(() => pendingVideoClips(project), [project]);
  // stabil kulcs a poll-effekt függőségéhez (a klipek id-je, nem a tömb-referencia)
  const pendingKey = pending.map((c) => c.id).join(',');

  useEffect(() => {
    if (dismissed || pending.length === 0) {
      return;
    }
    let active = true;
    const startedMs = Date.now();
    const check = async () => {
      for (const clip of pending) {
        try {
          // Range-GET: olcsó létezés-próba (206 ha van, 404 ha még nincs) — a HEAD-nél
          // megbízhatóbb az R2 publikus URL-en.
          const res = await fetch(clip.uri, { headers: { Range: 'bytes=0-0' } });
          if (active && res.ok) {
            useEditorStore
              .getState()
              .dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { pending: false } }, 'system');
          }
        } catch {
          // hálózati hiba → a következő körben újrapróbáljuk
        }
      }
      if (active) {
        setElapsedMs(Date.now() - startedMs);
      }
    };
    void check();
    const id = setInterval(() => void check(), POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [pendingKey, dismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (dismissed || pending.length === 0) {
    return null;
  }

  const slow = elapsedMs >= SOFT_TIMEOUT_MS;
  return (
    <View style={styles.overlay}>
      <ActivityIndicator size="large" color={palette.accent} />
      <Text style={styles.title}>{t('live.vodProcessing', { defaultValue: 'A felvétel feldolgozása…' })}</Text>
      <Text style={styles.sub}>
        {slow
          ? t('live.vodProcessingSlow', {
              defaultValue: 'A feltöltés tovább tart a vártnál. Megnyithatod most is — a videó magától betöltődik, amint kész.',
            })
          : t('live.vodProcessingSub', {
              defaultValue: 'Az élő adás videója pár másodpercen belül elkészül.',
            })}
      </Text>
      {slow ? (
        <Pressable onPress={() => setDismissed(true)} style={styles.btn} hitSlop={8}>
          <Text style={styles.btnText}>{t('live.vodOpenAnyway', { defaultValue: 'Megnyitom most' })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000e6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
    zIndex: 100,
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '800', textAlign: 'center' },
  sub: { color: palette.textDim, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  btn: {
    marginTop: 6,
    backgroundColor: palette.accent,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 11,
  },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/editor';
import {
  activeSong,
  addSong,
  canRemoveSong,
  initAlbum,
  makeSong,
  removeSong,
  renameSong,
  renderedSongCount,
  reorderSongs,
  setActiveSong,
  setCover,
  songCount,
} from '@/lib/albumDoc';
import { addLayer, createImageDoc } from '@/lib/imageDoc';
import { makeId } from '@/lib/id';
import { pickAudio, pickImage } from '@/lib/media';
import { createEmptyProject } from '@/lib/projectUtils';
import { useEditorStore } from '@/store/editorStore';
import type { AlbumDoc, AudioClip, ImageDoc, PhotoLayer, Track } from '@/types/project';

/**
 * 🎧💿 ALBUM-lap (Hang Stúdió): a hang-projekt több SZÁMA + a BORÍTÓ egy helyen. A szám-váltás
 * az `APPLY_ALBUM` command-on megy (snapshot + swap): az aktív szám a `project.tracks`-ban él,
 * a többi az `album.songs`-ban. A borító egy `ImageDoc` a `project.imageDocs`-ban → a kép-
 * szerkesztővel szerkeszthető. A pure manifeszt-CRUD az `albumDoc.ts`-ben.
 */
export function AlbumSheet({ onClose, onShareAlbum }: { onClose: () => void; onShareAlbum: () => void }) {
  const { t } = useTranslation();
  const project = useEditorStore((s) => s.project);
  const [busy, setBusy] = useState(false);

  if (!project) {
    return null;
  }
  const album = project.album;
  const songs = album?.songs ?? [];
  const current = activeSong(album);

  const apply = (next: AlbumDoc, label?: string) =>
    useEditorStore.getState().dispatch({ type: 'APPLY_ALBUM', album: next, label });

  // üres audio-sávkészlet (kanonikus music/voiceover/sfx) egy új számhoz
  const emptyAudioTracks = (): Track[] =>
    createEmptyProject('x', project.aspectRatio, undefined, 'audio').tracks;

  /** Album létrehozása a JELENLEGI idővonalból (az első szám = a mostani project.tracks). */
  const enableAlbum = () => {
    const first = makeSong(makeId('song'), project.name || 'Szám 1', project.tracks, project.assets);
    apply(initAlbum(first), 'Album létrehozva');
  };

  const addEmptySong = () => {
    if (!album) {
      return;
    }
    const s = makeSong(makeId('song'), `Szám ${songs.length + 1}`, emptyAudioTracks(), []);
    apply(addSong(album, s), `Új szám: ${s.name}`);
  };

  const importSong = async () => {
    if (!album || busy) {
      return;
    }
    setBusy(true);
    try {
      const picked = await pickAudio();
      if (!picked) {
        return;
      }
      if (!picked.intake.ok) {
        Alert.alert(t('common.error', { defaultValue: 'Hiba' }), picked.intake.message ?? '');
        return;
      }
      const clip: AudioClip = {
        kind: 'audio',
        id: makeId('clip'),
        start: 0,
        duration: picked.duration > 0 ? picked.duration : 10,
        uri: picked.uri,
        label: picked.name,
        volume: 1,
        fadeIn: 0,
        fadeOut: 0,
        source: 'imported',
      };
      const tracks = emptyAudioTracks().map((tr) => (tr.type === 'music' ? { ...tr, clips: [clip] } : tr));
      // az importált fájl MAGA a renderelt hang → a szám azonnal megosztható (nincs render)
      const s = {
        ...makeSong(makeId('song'), picked.name, tracks, [
          { id: makeId('ast'), kind: 'audio', uri: picked.uri, provider: 'local', name: picked.name, duration: picked.duration },
        ]),
        renderedUri: picked.uri,
        durationSec: picked.duration > 0 ? picked.duration : 10,
      };
      apply(addSong(album, s), `Szám importálva: ${picked.name}`);
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (id: string) => {
    if (album) {
      apply(setActiveSong(album, id), 'Szám-váltás');
    }
  };

  const remove = (id: string, name: string) => {
    if (!album || !canRemoveSong(album)) {
      return;
    }
    Alert.alert(t('common.delete'), `„${name}" szám törlése?`, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => apply(removeSong(album, id), 'Szám törölve') },
    ]);
  };

  const rename = (id: string, currentName: string) => {
    if (!album) {
      return;
    }
    Alert.prompt?.(t('common.rename', { defaultValue: 'Átnevezés' }), undefined, (text) => {
      if (text) {
        apply(renameSong(album, id, text), 'Szám átnevezve');
      }
    }, 'plain-text', currentName);
  };

  const move = (idx: number, dir: -1 | 1) => {
    if (album) {
      const next = reorderSongs(album, idx, idx + dir);
      if (next !== album) {
        apply(next, 'Számok átrendezése');
      }
    }
  };

  /** Borító: kép kiválasztása → egy ImageDoc (fotó-réteggel) a project.imageDocs-ba + coverDocId. */
  const pickCover = async () => {
    if (!album || busy) {
      return;
    }
    setBusy(true);
    try {
      const picked = await pickImage();
      if (!picked) {
        return;
      }
      const base = createImageDoc(t('studio.audio.album.cover', { defaultValue: 'Borító' }), project.aspectRatio, () => makeId('lyr'), {
        width: picked.width,
        height: picked.height,
      });
      const photo: PhotoLayer = {
        kind: 'photo',
        id: makeId('lyr'),
        uri: picked.uri,
        position: { x: 0.5, y: 0.5 },
        w: 1,
        h: 1,
      } as PhotoLayer;
      const coverDoc = { ...addLayer(base, photo), renderedUri: picked.uri };
      const s = useEditorStore.getState();
      s.dispatch({ type: 'UPSERT_IMAGE_DOC', doc: coverDoc as ImageDoc, label: 'Borító' });
      s.dispatch({ type: 'APPLY_ALBUM', album: setCover(album, coverDoc.id), label: 'Borító beállítva' });
    } finally {
      setBusy(false);
    }
  };

  /** A borító szerkesztése a Kép Stúdióban (ugyanaz a projekt — a cover ImageDoc lapja). */
  const editCover = () => {
    onClose();
    router.push(`/studio/image/${project.id}`);
  };

  const coverDoc = album?.coverDocId ? project.imageDocs?.find((d) => d.id === album.coverDocId) : undefined;
  const coverUri = coverDoc?.renderedUri;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.handleRow}>
            <Text style={styles.title}>
              <Ionicons name="albums" size={16} color={palette.accent} /> {t('studio.audio.album.title', { defaultValue: 'Album' })}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={24} color={palette.textDim} />
            </Pressable>
          </View>

          {!album ? (
            <View style={styles.enableWrap}>
              <Text style={styles.enableHint}>
                {t('studio.audio.album.enableHint', {
                  defaultValue: 'Alakítsd a projektet albummá: több szám + borító, egy lapozható/album-posztban.',
                })}
              </Text>
              <Pressable style={styles.primary} onPress={enableAlbum}>
                <Ionicons name="albums-outline" size={16} color="#fff" />
                <Text style={styles.primaryText}>{t('studio.audio.album.enable', { defaultValue: 'Album létrehozása' })}</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 12 }}>
              {/* borító */}
              <View style={styles.coverRow}>
                {coverUri ? (
                  <Image source={{ uri: coverUri }} style={styles.cover} contentFit="cover" />
                ) : (
                  <View style={[styles.cover, styles.coverEmpty]}>
                    <Ionicons name="image-outline" size={24} color={palette.textDim} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 8 }}>
                  <Pressable style={styles.secondary} onPress={pickCover} disabled={busy}>
                    <Ionicons name="image-outline" size={15} color={palette.text} />
                    <Text style={styles.secondaryText}>
                      {coverUri
                        ? t('studio.audio.album.changeCover', { defaultValue: 'Borító cseréje' })
                        : t('studio.audio.album.addCover', { defaultValue: 'Borító hozzáadása' })}
                    </Text>
                  </Pressable>
                  {coverDoc ? (
                    <Pressable style={styles.secondary} onPress={editCover}>
                      <Ionicons name="color-wand-outline" size={15} color={palette.text} />
                      <Text style={styles.secondaryText}>{t('studio.audio.album.editCover', { defaultValue: 'Szerkesztés' })}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              {/* szám-lista */}
              <Text style={styles.section}>
                {t('studio.audio.album.songs', { defaultValue: 'Számok' })} · {songCount(album)} ·{' '}
                {t('studio.audio.album.rendered', { defaultValue: 'renderelt' })}: {renderedSongCount(album)}
              </Text>
              {songs.map((s, i) => {
                const isActive = s.id === current?.id;
                return (
                  <View key={s.id} style={[styles.songRow, isActive && styles.songRowActive]}>
                    <Pressable style={styles.songMain} onPress={() => switchTo(s.id)} onLongPress={() => rename(s.id, s.name)}>
                      <Ionicons
                        name={isActive ? 'musical-note' : 'musical-note-outline'}
                        size={16}
                        color={isActive ? palette.accent : palette.textDim}
                      />
                      <Text style={[styles.songName, isActive && { color: palette.text }]} numberOfLines={1}>
                        {i + 1}. {s.name}
                      </Text>
                      {s.renderedUri ? <Ionicons name="checkmark-circle" size={13} color="#39d98a" /> : null}
                    </Pressable>
                    <Pressable onPress={() => move(i, -1)} disabled={i === 0} hitSlop={6} style={styles.songBtn}>
                      <Ionicons name="chevron-up" size={16} color={i === 0 ? palette.border : palette.textDim} />
                    </Pressable>
                    <Pressable onPress={() => move(i, 1)} disabled={i === songs.length - 1} hitSlop={6} style={styles.songBtn}>
                      <Ionicons name="chevron-down" size={16} color={i === songs.length - 1 ? palette.border : palette.textDim} />
                    </Pressable>
                    <Pressable onPress={() => remove(s.id, s.name)} disabled={!canRemoveSong(album)} hitSlop={6} style={styles.songBtn}>
                      <Ionicons name="trash-outline" size={15} color={canRemoveSong(album) ? palette.textDim : palette.border} />
                    </Pressable>
                  </View>
                );
              })}

              <View style={styles.addRow}>
                <Pressable style={styles.secondary} onPress={addEmptySong}>
                  <Ionicons name="add" size={16} color={palette.text} />
                  <Text style={styles.secondaryText}>{t('studio.audio.album.newSong', { defaultValue: 'Új szám' })}</Text>
                </Pressable>
                <Pressable style={styles.secondary} onPress={importSong} disabled={busy}>
                  {busy ? (
                    <ActivityIndicator size="small" color={palette.text} />
                  ) : (
                    <Ionicons name="cloud-upload-outline" size={16} color={palette.text} />
                  )}
                  <Text style={styles.secondaryText}>{t('studio.audio.album.import', { defaultValue: 'Hang importálása' })}</Text>
                </Pressable>
              </View>

              <Pressable
                style={[styles.primary, renderedSongCount(album) === 0 && styles.disabled]}
                disabled={busy}
                onPress={() => {
                  onClose();
                  onShareAlbum();
                }}
              >
                <Ionicons name="share-outline" size={16} color="#fff" />
                <Text style={styles.primaryText}>{t('studio.audio.album.share', { defaultValue: 'Megosztás albumként' })}</Text>
              </Pressable>
              <Text style={styles.hint}>
                {t('studio.audio.album.shareHint', {
                  defaultValue: 'Megosztáskor a számok renderelődnek; a borító + a számok egy album-poszt lesz.',
                })}
              </Text>
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: palette.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, maxHeight: '86%' },
  handleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  title: { color: palette.text, fontSize: 17, fontWeight: '800' },
  enableWrap: { gap: 14, paddingVertical: 16, paddingBottom: 28 },
  enableHint: { color: palette.textDim, fontSize: 13, lineHeight: 19 },
  coverRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  cover: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#0d0f16' },
  coverEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border },
  section: { color: palette.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, borderRadius: 10, paddingHorizontal: 8, marginBottom: 4, backgroundColor: '#0d0f16' },
  songRowActive: { borderWidth: 1, borderColor: palette.accent },
  songMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  songName: { flex: 1, color: palette.textDim, fontSize: 14, fontWeight: '600' },
  songBtn: { padding: 6 },
  addRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.accent, borderRadius: 12, paddingVertical: 13, marginTop: 14 },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  secondary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.surfaceHigh, borderWidth: 1, borderColor: palette.border, borderRadius: 12, paddingVertical: 11 },
  secondaryText: { color: palette.text, fontSize: 13, fontWeight: '700' },
  hint: { color: palette.textDim, fontSize: 12, marginTop: 8, lineHeight: 17 },
  disabled: { opacity: 0.5 },
});

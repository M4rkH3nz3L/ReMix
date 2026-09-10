import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';

import { CameraRecorder } from '@/components/editor/CameraRecorder';
import { ToolButton } from '@/components/ui/controls';
import { palette } from '@/constants/editor';
import { captureFrame } from '@/lib/captureFrame';
import { makeId } from '@/lib/id';
import { pickImage, pickVideo } from '@/lib/media';
import { ensureProxy } from '@/lib/proxy';
import { describeStyle, duplicateOffset } from '@/lib/batchEdit';
import { clipEnd, findClip, trackEnd, trackOf } from '@/lib/projectUtils';
import { selectSelectedClip, useEditorStore } from '@/store/editorStore';
import type { Clip } from '@/types/project';

/**
 * Kontextusfüggő eszköztár: kijelölés nélkül a hozzáadás-műveletek, kijelölt
 * klipnél a klip-műveletek (vágás, duplikálás, törlés + típus-specifikus panelek).
 */
export function Toolbar() {
  const selected = useEditorStore(selectSelectedClip);
  const [showCamera, setShowCamera] = useState(false);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setPanel = useEditorStore((s) => s.setPanel);
  const addClip = useEditorStore((s) => s.addClip);
  const removeClip = useEditorStore((s) => s.removeClip);
  const splitClipAt = useEditorStore((s) => s.splitClipAt);
  const selectClip = useEditorStore((s) => s.selectClip);
  const multiSelectIds = useEditorStore((s) => s.multiSelectIds);
  const multiSelectMode = useEditorStore((s) => s.multiSelectMode);
  const setMultiSelectMode = useEditorStore((s) => s.setMultiSelectMode);
  const batchCount = multiSelectIds.length + 1;
  const styleClipboard = useEditorStore((s) => s.styleClipboard);
  // beilleszteni csak azonos fajtájú klipre lehet (a stílus-mezők kind-függők)
  const rippleMode = useEditorStore((s) => s.rippleMode);
  const setRippleMode = useEditorStore((s) => s.setRippleMode);
  const canPasteStyle = Boolean(
    styleClipboard && selected && styleClipboard.kind === selected.kind
  );
  // 🎬 a kijelölt klip a pip-sávon van-e? (a „Keret" gomb csak ott jelenik meg)
  const onPipTrack = useEditorStore(
    (s) =>
      !!selected &&
      (s.project?.tracks.find((t) => t.type === 'pip')?.clips.some((c) => c.id === selected.id) ??
        false)
  );

  const addVideo = async () => {
    const picked = await pickVideo();
    if (!picked) {
      return;
    }
    const { project } = useEditorStore.getState();
    if (!project) {
      return;
    }
    const duration = picked.duration > 0 ? picked.duration : 5;
    addClip(
      'video',
      {
        kind: 'video',
        id: makeId('clip'),
        start: trackEnd(trackOf(project, 'video')),
        duration,
        uri: picked.uri,
        trimIn: 0,
        sourceDuration: duration,
        speed: 1,
        volume: 1,
        filterId: 'none',
      },
      {
        id: makeId('ast'),
        kind: 'video',
        uri: picked.uri,
        provider: 'local',
        duration,
        width: picked.width,
        height: picked.height,
      }
    );
    // a 720p vágási proxy már készülhet, mire lejátszásra kerül
    ensureProxy(picked.uri).catch(() => {});
  };

  // 🎬 PiP: a videó a PIP-sávra kerül a lejátszófejnél, alap kis mérettel (jobb-fent)
  // — a fő videó FÖLÉ overlay-eződik; húzással/csippentéssel áthelyezhető/méretezhető.
  const addPip = async () => {
    const picked = await pickVideo();
    if (!picked) {
      return;
    }
    const { project, playhead } = useEditorStore.getState();
    if (!project) {
      return;
    }
    const source = picked.duration > 0 ? picked.duration : 5;
    const duration = Math.min(source, 10);
    // több PiP esetén a következő másik sarokba kerül (ne fedjék pontosan egymást)
    const pipCount = project.tracks.find((t) => t.type === 'pip')?.clips.length ?? 0;
    const CORNERS = [
      { x: 0.3, y: -0.32 },
      { x: -0.3, y: -0.32 },
      { x: 0.3, y: 0.32 },
      { x: -0.3, y: 0.32 },
    ];
    const corner = CORNERS[pipCount % CORNERS.length];
    addClip(
      'pip',
      {
        kind: 'video',
        id: makeId('clip'),
        start: playhead,
        duration,
        uri: picked.uri,
        trimIn: 0,
        sourceDuration: source,
        speed: 1,
        volume: 1,
        filterId: 'none',
        transform: { scale: 0.32, x: corner.x, y: corner.y },
      },
      {
        id: makeId('ast'),
        kind: 'video',
        uri: picked.uri,
        provider: 'local',
        duration: source,
        width: picked.width,
        height: picked.height,
      }
    );
    ensureProxy(picked.uri).catch(() => {});
  };

  const addImage = async () => {
    const picked = await pickImage();
    if (!picked) {
      return;
    }
    const { project } = useEditorStore.getState();
    if (!project) {
      return;
    }
    addClip(
      'video',
      {
        kind: 'image',
        id: makeId('clip'),
        start: trackEnd(trackOf(project, 'video')),
        duration: 4,
        uri: picked.uri,
        filterId: 'none',
      },
      { id: makeId('ast'), kind: 'image', uri: picked.uri, provider: 'local' }
    );
  };

  const addText = () => {
    const { playhead } = useEditorStore.getState();
    addClip('text', {
      kind: 'text',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      text: 'Új szöveg',
      color: '#ffffff',
      backgroundColor: null,
      fontSize: 7,
      fontWeight: 'bold',
      position: { x: 0.5, y: 0.5 },
      animation: 'fade',
    });
    setPanel('text');
  };

  const addHotspot = () => {
    const { playhead } = useEditorStore.getState();
    addClip('interactive', {
      kind: 'interactive',
      id: makeId('clip'),
      start: playhead,
      duration: 3,
      label: 'Hotspot',
      rect: { x: 0.35, y: 0.4, w: 0.3, h: 0.2 },
      action: { type: 'url', url: 'https://' },
    });
    setPanel('hotspot');
  };

  // 🎨 Grade-réteg: az adjust-sávra kerül a lejátszófejnél; a saját szakaszában
  // az ALATTA lévő teljes kompozitra ad nem-destruktív színkorrekciót (CapCut-minta).
  const addAdjust = () => {
    const { project, playhead } = useEditorStore.getState();
    if (!project) {
      return;
    }
    // védett: régi projektben hiányozhat az adjust-sáv (a migráció pótolja, de
    // ne dobjunk, ha valamiért mégsem — a lejátszófejnél kezdünk)
    const track = project.tracks.find((t) => t.type === 'adjust');
    if (!track) {
      return;
    }
    // enyhe alap-grade, hogy rögtön látszódjon a réteg hatása (finomítható)
    const start = Math.max(playhead, trackEnd(track) > playhead ? trackEnd(track) : playhead);
    const id = makeId('clip');
    addClip('adjust', {
      kind: 'adjust',
      id,
      start,
      duration: 4,
      adjust: { contrast: 0.08, saturation: 0.1 },
    });
    selectClip(id);
    setPanel('adjust');
  };

  const split = () => {
    if (!selected) {
      return;
    }
    const { playhead } = useEditorStore.getState();
    const ok = splitClipAt(selected.id, playhead);
    if (ok) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } else {
      Alert.alert('Nem vágható itt', 'A lejátszófej nem a klip belsejében áll.');
    }
  };

  const duplicate = () => {
    const state = useEditorStore.getState();
    const { project } = state;
    if (!selected || !project) {
      return;
    }
    const ids = state.allSelectedIds();
    if (ids.length === 1) {
      // a klip a saját sávjára duplikálódik (a kind többsávos is lehet)
      const found = findClip(project, selected.id);
      if (!found) {
        return;
      }
      addClip(found.track.type, {
        ...selected,
        id: makeId('clip'),
        start: clipEnd(selected),
      });
      return;
    }
    // 🧩 kötegelt duplikálás: a másolatok a kijelölés UTÁN, a saját relatív
    // távolságukat megtartva — a ritmus nem borul fel; egy undo-lépés
    const picked = ids
      .map((id) => findClip(project, id))
      .filter((f): f is NonNullable<typeof f> => f != null);
    const offset = duplicateOffset(picked.map((f) => f.clip));
    const byTrack = new Map<string, Clip[]>();
    for (const { track, clip } of picked) {
      const list = byTrack.get(track.type) ?? [...track.clips];
      list.push({ ...clip, id: makeId('clip'), start: clip.start + offset });
      byTrack.set(track.type, list);
    }
    state.dispatch(
      {
        type: 'REPLACE_TRACKS',
        tracks: [...byTrack.entries()].map(([trackType, clips]) => ({
          trackType: trackType as never,
          clips: clips.sort((a, b) => a.start - b.start),
        })),
        label: `${ids.length} klip duplikálva`,
      },
      'user'
    );
  };

  const remove = () => {
    const state = useEditorStore.getState();
    const { project } = state;
    if (!selected || !project) {
      return;
    }
    const ids = new Set(state.allSelectedIds());
    // ⏭️ ripple módban a lyuk bezárul — minden sáv csúszik, a szinkron marad
    if (state.rippleMode) {
      const list = [...ids];
      Alert.alert(
        'Ripple-törlés',
        `${list.length} klip törlődik, és a mögötte lévő minden sáv a helyére ` +
          'csúszik (a zárolt sávok kivételével). Egy lépésben visszavonható.',
        [
          { text: 'Mégse', style: 'cancel' },
          {
            text: 'Törlés',
            style: 'destructive',
            onPress: () => {
              if (!useEditorStore.getState().rippleDelete(list)) {
                Alert.alert('Ripple-törlés', 'Nem sikerült — próbáld ripple nélkül.');
              }
            },
          },
        ]
      );
      return;
    }
    if (ids.size === 1) {
      removeClip(selected.id);
      return;
    }
    // 🧩 kötegelt törlés — egy undo-lépésben, minden érintett sávról
    const tracks = project.tracks
      .filter((t) => t.clips.some((c) => ids.has(c.id)))
      .map((t) => ({
        trackType: t.type,
        clips: t.clips.filter((c) => !ids.has(c.id)),
      }));
    Alert.alert(
      'Kijelölt klipek törlése',
      `${ids.size} klip törlődik. Egy lépésben visszavonható.`,
      [
        { text: 'Mégse', style: 'cancel' },
        {
          text: 'Törlés',
          style: 'destructive',
          onPress: () => {
            const s2 = useEditorStore.getState();
            s2.dispatch({ type: 'REPLACE_TRACKS', tracks, label: `${ids.size} klip törölve` }, 'user');
            s2.selectClip(null);
          },
        },
      ]
    );
  };

  const togglePanel = (panel: NonNullable<typeof activePanel>) => {
    setPanel(activePanel === panel ? null : panel);
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {selected ? (
          <>
            <ToolButton icon="close-circle-outline" label="Kész" onPress={() => selectClip(null)} />
            <ToolButton
              icon={multiSelectMode ? 'checkmark-done' : 'checkmark-done-outline'}
              label={multiSelectMode ? `Több (${batchCount})` : 'Több'}
              active={multiSelectMode}
              onPress={() => {
                const on = !multiSelectMode;
                setMultiSelectMode(on);
                if (on) {
                  Alert.alert(
                    'Több kijelölése',
                    'Koppints a további klipekre — a stílus-beállítások (szűrő, fény, ' +
                      'áttűnés, szöveg-stílus, hangerő) mindre egyszerre mennek. ' +
                      'Csak azonos fajtájú klip vehető a kötegbe.'
                  );
                }
              }}
            />
            {multiSelectIds.length === 0 ? (
              <ToolButton icon="cut-outline" label="Vágás" onPress={split} />
            ) : null}
            <ToolButton
              icon={rippleMode ? 'git-commit' : 'git-commit-outline'}
              label="Ripple"
              active={rippleMode}
              onPress={() => {
                const on = !rippleMode;
                setRippleMode(on);
                if (on) {
                  Alert.alert(
                    'Ripple mód be',
                    'A törlés és a hossz-változás nem hagy lyukat: a mögötte lévő ' +
                      'klipek MINDEN sávon csúsznak, így a felirat, a zene és az SFX ' +
                      'szinkronban marad a képpel. A zárolt sávok kimaradnak.'
                  );
                }
              }}
            />
            <ToolButton
              icon="clipboard-outline"
              label="Stílus másol"
              onPress={() => {
                if (!useEditorStore.getState().copyStyle()) {
                  return;
                }
                // FONTOS: a vágólapot a copyStyle UTÁN kell kiolvasni. A zustand
                // minden `set`-nél ÚJ state-objektumot ad, így a hívás ELŐTT
                // vett pillanatképen a styleClipboard még a régi (első
                // használatkor `null`) — abból lett a „Cannot read property
                // 'style' of null" összeomlás.
                const clipboard = useEditorStore.getState().styleClipboard;
                if (!clipboard) {
                  return;
                }
                Haptics.selectionAsync().catch(() => {});
                Alert.alert(
                  'Stílus másolva',
                  `${describeStyle(clipboard.style)}\n\n` +
                    'Jelölj ki másik klipet (vagy többet a „Több” gombbal), és ' +
                    'illeszd be — a megjelenés átveszi, az időzítés marad.'
                );
              }}
            />
            {canPasteStyle ? (
              <ToolButton
                icon="color-wand-outline"
                label={multiSelectIds.length > 0 ? `Beilleszt (${batchCount})` : 'Stílus beilleszt'}
                onPress={() => {
                  const n = useEditorStore.getState().pasteStyle();
                  if (n > 0) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  } else {
                    Alert.alert('Stílus', 'Nincs mire beilleszteni.');
                  }
                }}
              />
            ) : null}
            <ToolButton
              icon="copy-outline"
              label={multiSelectIds.length > 0 ? `Duplikálás (${batchCount})` : 'Duplikálás'}
              onPress={duplicate}
            />
            <ToolButton
              icon="timer-outline"
              label="Pontos"
              active={activePanel === 'precision'}
              onPress={() => togglePanel('precision')}
            />
            {selected.kind === 'text' ? (
              <ToolButton
                icon="text-outline"
                label="Szöveg"
                active={activePanel === 'text'}
                onPress={() => togglePanel('text')}
              />
            ) : null}
            {selected.kind === 'video' || selected.kind === 'image' ? (
              <>
                <ToolButton
                  icon="color-filter-outline"
                  label="Szűrő"
                  active={activePanel === 'filter'}
                  onPress={() => togglePanel('filter')}
                />
                <ToolButton
                  icon="contrast-outline"
                  label="Áttűnés"
                  active={activePanel === 'transition'}
                  onPress={() => togglePanel('transition')}
                />
                {onPipTrack ? (
                  <ToolButton
                    icon="ellipse-outline"
                    label="Keret"
                    active={activePanel === 'pip'}
                    onPress={() => togglePanel('pip')}
                  />
                ) : null}
              </>
            ) : null}
            {selected.kind === 'video' ? (
              <>
                <ToolButton
                  icon="speedometer-outline"
                  label="Sebesség"
                  active={activePanel === 'speed'}
                  onPress={() => togglePanel('speed')}
                />
                <ToolButton
                  icon="camera-outline"
                  label="Képkocka"
                  onPress={() => {
                    const state = useEditorStore.getState();
                    if (selected.kind !== 'video') {
                      return;
                    }
                    captureFrame(selected, state.playhead)
                      .then((result) => {
                        if (!result) {
                          Alert.alert(
                            'Képkocka',
                            'A képkocka-rögzítés a natív appból érhető el.'
                          );
                          return;
                        }
                        const s = useEditorStore.getState();
                        s.addClip('video', result.clip, result.asset);
                        s.selectClip(result.clip.id);
                      })
                      .catch(() =>
                        Alert.alert('Képkocka', 'A képkocka rögzítése nem sikerült.')
                      );
                  }}
                />
              </>
            ) : null}
            {selected.kind === 'shape' ? (
              <ToolButton
                icon="shapes-outline"
                label="Forma"
                active={activePanel === 'shape'}
                onPress={() => togglePanel('shape')}
              />
            ) : null}
            {selected.kind === 'adjust' ? (
              <ToolButton
                icon="color-filter-outline"
                label="Grade"
                active={activePanel === 'adjust'}
                onPress={() => togglePanel('adjust')}
              />
            ) : null}
            {selected.kind === 'audio' ? (
              <ToolButton
                icon="options-outline"
                label="Keverés"
                active={activePanel === 'audio'}
                onPress={() => togglePanel('audio')}
              />
            ) : null}
            {selected.kind === 'interactive' ? (
              <ToolButton
                icon="link-outline"
                label="Művelet"
                active={activePanel === 'hotspot'}
                onPress={() => togglePanel('hotspot')}
              />
            ) : null}
            <ToolButton
              icon="trash-outline"
              label={multiSelectIds.length > 0 ? `Törlés (${batchCount})` : 'Törlés'}
              danger
              onPress={remove}
            />
          </>
        ) : (
          <>
            <ToolButton
              icon="sparkles-outline"
              label="AI"
              active={activePanel === 'assistant'}
              onPress={() => togglePanel('assistant')}
            />
            <ToolButton icon="radio-button-on-outline" label="Felvétel" onPress={() => setShowCamera(true)} />
            <ToolButton icon="videocam-outline" label="Videó" onPress={addVideo} />
            <ToolButton icon="albums-outline" label="PiP" onPress={addPip} />
            <ToolButton icon="color-filter-outline" label="Grade" onPress={addAdjust} />
            <ToolButton icon="image-outline" label="Kép" onPress={addImage} />
            <ToolButton icon="text-outline" label="Szöveg" onPress={addText} />
            <ToolButton
              icon="chatbox-ellipses-outline"
              label="Felirat"
              active={activePanel === 'captions'}
              onPress={() => togglePanel('captions')}
            />
            <ToolButton
              icon="reader-outline"
              label="Átirat"
              active={activePanel === 'transcript'}
              onPress={() => togglePanel('transcript')}
            />
            <ToolButton
              icon="happy-outline"
              label="Matrica"
              active={activePanel === 'sticker'}
              onPress={() => togglePanel('sticker')}
            />
            <ToolButton
              icon="musical-notes-outline"
              label="Zene"
              active={activePanel === 'audio'}
              onPress={() => togglePanel('audio')}
            />
            <ToolButton
              icon="layers-outline"
              label="Rétegek"
              active={activePanel === 'imagedoc'}
              onPress={() => togglePanel('imagedoc')}
            />
            <ToolButton
              icon="server-outline"
              label="Tár"
              active={activePanel === 'library'}
              onPress={() => togglePanel('library')}
            />
            <ToolButton icon="scan-outline" label="Hotspot" onPress={addHotspot} />
            <ToolButton
              icon="share-outline"
              label="Export"
              active={activePanel === 'export'}
              onPress={() => togglePanel('export')}
            />
          </>
        )}
      </ScrollView>
      <CameraRecorder visible={showCamera} onClose={() => setShowCamera(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: palette.surface,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingVertical: 4,
  },
});

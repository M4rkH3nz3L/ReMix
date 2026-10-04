import { Ionicons } from '@expo/vector-icons';
import { VideoTrack, isTrackReference, useTracks, type TrackReference } from '@livekit/react-native';
import { Track } from 'livekit-client';
import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';

import { palette } from '@/constants/editor';
import { compositeLayers, layerPercentBox, type SceneLayer, type ScenePayload } from '@/lib/liveComposite';

/**
 * 🎥 Élő kompozíció-renderelő (Fázis B) — a `<LiveKitRoom>`-on BELÜL fut. A
 * jelenet-állapot (`ScenePayload`) rétegeit rajzolja: kamera/képernyő = a kapott
 * `VideoTrack`, szöveg/alakzat/logó/kép = egyszerű overlay, 0–1 transzform → %.
 * Ugyanez fut a hostnál (saját track) és a nézőnél (remote track) — EGY modell,
 * két renderelő. A képernyő-forrás natív capture-jét a `ScreenShareControl`
 * indítja (F5), amikor a jelenetben látható `screen` forrás van.
 */
export function LiveComposite({
  payload,
  hostAvatar,
}: {
  payload: ScenePayload | null;
  hostAvatar: string | null;
}) {
  const refs = useTracks([Track.Source.Camera, Track.Source.ScreenShare]).filter(isTrackReference);
  const cam = refs.find((tr) => tr.source === Track.Source.Camera);
  const screen = refs.find((tr) => tr.source === Track.Source.ScreenShare);
  const layers = payload ? compositeLayers(payload) : [];

  return (
    <View style={StyleSheet.absoluteFill}>
      {layers.map((l) => (
        <Layer key={l.id} layer={l} cam={cam} screen={screen} />
      ))}
      {layers.length === 0 && (
        <View style={styles.center}>
          {hostAvatar ? (
            <Image source={{ uri: hostAvatar }} style={styles.avatar} />
          ) : (
            <Ionicons name="radio" size={48} color={palette.textDim} />
          )}
        </View>
      )}
    </View>
  );
}

function Layer({
  layer,
  cam,
  screen,
}: {
  layer: SceneLayer;
  cam?: TrackReference;
  screen?: TrackReference;
}) {
  // egyetlen, lapos ViewStyle (a VideoTrack NEM fogad stílus-tömböt / ImageStyle-t)
  const base: ViewStyle = {
    position: 'absolute',
    ...layerPercentBox(layer),
    ...(layer.t.r != null ? { transform: [{ rotate: `${layer.t.r}deg` }] } : {}),
  };

  switch (layer.kind) {
    case 'camera':
      return cam ? (
        <VideoTrack trackRef={cam} style={base} objectFit="cover" />
      ) : (
        <SourcePlaceholder style={base} icon="videocam" label="Camera" />
      );
    case 'screen':
      return screen ? (
        <VideoTrack trackRef={screen} style={base} objectFit="contain" />
      ) : (
        <SourcePlaceholder style={base} icon="desktop" label="Screen" />
      );
    case 'image':
    case 'logo':
      return layer.uri ? (
        <Image source={{ uri: layer.uri }} style={base as ImageStyle} resizeMode="contain" />
      ) : (
        <SourcePlaceholder style={base} icon={layer.kind === 'logo' ? 'ribbon' : 'image'} label={layer.kind} />
      );
    case 'text':
      return (
        <View style={[base, styles.textWrap]} pointerEvents="none">
          <Text style={styles.text} numberOfLines={3}>
            {layer.text || 'Text'}
          </Text>
        </View>
      );
    case 'shape':
      return <View style={[base, { backgroundColor: layer.color ?? palette.accent, borderRadius: 8 }]} />;
    case 'video':
      return <SourcePlaceholder style={base} icon="film" label="Video" />;
    case 'browser':
      return <SourcePlaceholder style={base} icon="globe" label="Browser" />;
    default:
      return null;
  }
}

function SourcePlaceholder({
  style,
  icon,
  label,
}: {
  style: StyleProp<ViewStyle>;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={[style, styles.placeholder]} pointerEvents="none">
      <Ionicons name={icon} size={22} color="#ffffffcc" />
      <Text style={styles.placeholderLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 110, height: 110, borderRadius: 55, backgroundColor: palette.surface },
  placeholder: {
    backgroundColor: '#ffffff12',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  placeholderLabel: { color: '#ffffffcc', fontSize: 11, fontWeight: '700' },
  textWrap: { alignItems: 'center', justifyContent: 'center' },
  text: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    textShadowColor: '#000',
    textShadowRadius: 6,
  },
});

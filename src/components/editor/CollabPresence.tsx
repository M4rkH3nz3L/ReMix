import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/editor';
import { reachableMediaUrl } from '@/lib/mediaUrl';
import { useCollabLive } from '@/store/collabLiveStore';

/**
 * 👥 Élő résztvevők a szerkesztő fejlécében — akik ÉPP a projektben vannak
 * (realtime presence). Színes gyűrű / kezdőbetű, max 3 avatar + „+N". Ha egyedül
 * vagyok (nincs másik résztvevő), nem jelenik meg semmi.
 */
export function CollabPresence() {
  const participants = useCollabLive((s) => s.participants);
  if (participants.length === 0) {
    return null;
  }
  const shown = participants.slice(0, 3);
  const extra = participants.length - shown.length;
  return (
    <View style={styles.row}>
      {shown.map((p, i) => {
        const uri = reachableMediaUrl(p.avatar);
        return (
          <View
            key={p.id}
            style={[styles.avatar, { borderColor: p.color, marginLeft: i === 0 ? 0 : -8 }]}
          >
            {uri ? (
              <Image source={{ uri }} style={styles.img} contentFit="cover" />
            ) : (
              <Text style={styles.initial}>{(p.name || '?').slice(0, 1).toUpperCase()}</Text>
            )}
          </View>
        );
      })}
      {extra > 0 ? <Text style={styles.extra}>+{extra}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    backgroundColor: palette.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  img: { width: '100%', height: '100%' },
  initial: { color: palette.text, fontSize: 11, fontWeight: '800' },
  extra: { color: palette.textDim, fontSize: 12, fontWeight: '700', marginLeft: 4 },
});

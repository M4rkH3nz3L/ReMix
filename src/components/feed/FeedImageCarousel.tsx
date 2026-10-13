import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

/**
 * 🖐️ Feed KÉP-KARUSSZEL — egy kép-projekt lapozható megosztása (TECH-TOP §2.2). A poszt
 * `images` listáját full-screen lapozza. SZÁNDÉKOSAN NEM vízszintes-scroll (a feed már
 * vízszintesen lapozza a remixeket → beágyazott scroll gesztus-ütközés lenne); helyette
 * chevron + pötty-indikátor — a feed függőleges/vízszintes pagerével nem konfliktál.
 */
export function FeedImageCarousel({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0);
  const count = images.length;

  if (count === 0) {
    return null;
  }
  // render közben szorítjuk a tartományba (ha a lista rövidült — nincs effect-setState)
  const clamped = Math.max(0, Math.min(index, count - 1));
  const go = (dir: -1 | 1) => setIndex((i) => Math.max(0, Math.min(count - 1, i + dir)));

  return (
    <View style={StyleSheet.absoluteFill}>
      <Image source={{ uri: images[clamped] }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />

      {count > 1 ? (
        <>
          {clamped > 0 ? (
            <Pressable
              onPress={() => go(-1)}
              style={[styles.nav, styles.navLeft]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Előző kép"
            >
              <Ionicons name="chevron-back" size={22} color="#fff" />
            </Pressable>
          ) : null}
          {clamped < count - 1 ? (
            <Pressable
              onPress={() => go(1)}
              style={[styles.nav, styles.navRight]}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Következő kép"
            >
              <Ionicons name="chevron-forward" size={22} color="#fff" />
            </Pressable>
          ) : null}

          <View style={styles.dots} pointerEvents="none">
            {images.map((_, i) => (
              <View key={i} style={[styles.dot, i === clamped && styles.dotActive]} />
            ))}
          </View>

          <View style={styles.counter} pointerEvents="none">
            <Ionicons name="albums-outline" size={12} color="#fff" />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    position: 'absolute',
    top: '50%',
    marginTop: -20,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  navLeft: { left: 10 },
  navRight: { right: 10 },
  dots: {
    position: 'absolute',
    bottom: 96,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#fff', width: 7, height: 7, borderRadius: 3.5 },
  counter: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
});

import { StyleSheet, Text, View } from 'react-native';

import type { AspectRatio } from '@/types/project';

/**
 * 🛡️ Safe-zone overlay az előnézeten (nem interaktív, csak szerkesztés közben).
 *
 * A rövid-videós platformok (TikTok · Reels · Shorts) a lejátszáskor a videó
 * FÖLÉ rajzolják a saját UI-jukat: jobb oldalt az akció-gombok (like/komment/
 * megosztás), alul a felhasználónév · felirat · zene. Ha a lényegi tartalom
 * (arc, szöveg, CTA) ezekbe a sávokba esik, a platformon KITAKARÓDIK.
 *
 * Ez az overlay közelítő „title-safe" keretet és — függőleges aránynál — a
 * platform-UI sávjait mutatja, hogy a felhasználó ezeket elkerülje.
 * A méretek közelítők; a cél a vizuális iránymutatás, nem a pixelpontosság.
 */
export function SafeZoneOverlay({
  width,
  height,
  aspect,
}: {
  width: number;
  height: number;
  aspect: AspectRatio;
}) {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const vertical = aspect === '9:16';

  // platform-UI sávok (a videó arányában, közelítés) — csak függőlegesnél
  const topBand = vertical ? 0.06 : 0; // felső státusz / bezárás
  const bottomBand = vertical ? 0.2 : 0; // felhasználónév · felirat · zene
  const rightBand = vertical ? 0.14 : 0; // akció-gombok

  // title-safe: általános 5% inset, de a sávokat is elkerülve
  const inset = 0.05;
  const safeLeft = inset * width;
  const safeTop = Math.max(topBand, inset) * height;
  const safeRight = Math.max(rightBand, inset) * width;
  const safeBottom = Math.max(bottomBand, inset) * height;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* title-safe keret: ide essen a lényegi tartalom */}
      <View
        style={[
          styles.safeBox,
          {
            left: safeLeft,
            top: safeTop,
            width: Math.max(0, width - safeLeft - safeRight),
            height: Math.max(0, height - safeTop - safeBottom),
          },
        ]}
      />

      {vertical ? (
        <>
          {/* jobb oldali akció-gomb sáv */}
          <View
            style={[
              styles.bandRight,
              {
                width: rightBand * width,
                top: 0.4 * height,
                height: 0.5 * height,
              },
            ]}
          >
            <Text style={styles.bandLabel}>♥</Text>
          </View>
          {/* alsó felhasználónév / felirat / zene sáv */}
          <View style={[styles.bandBottom, { height: bottomBand * height }]}>
            <Text style={styles.bandLabel}>UI</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const LINE = 'rgba(255,255,255,0.55)';
const BAND = 'rgba(124,92,255,0.16)';
const BAND_LINE = 'rgba(124,92,255,0.55)';
const LABEL = 'rgba(255,255,255,0.7)';

const styles = StyleSheet.create({
  safeBox: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: LINE,
    borderStyle: 'dashed',
    borderRadius: 3,
  },
  bandRight: {
    position: 'absolute',
    right: 0,
    backgroundColor: BAND,
    borderLeftWidth: 1,
    borderColor: BAND_LINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bandBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: BAND,
    borderTopWidth: 1,
    borderColor: BAND_LINE,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    paddingTop: 4,
    paddingLeft: 6,
  },
  bandLabel: {
    color: LABEL,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
});

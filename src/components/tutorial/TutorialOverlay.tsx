import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getLesson, localize, type Rect } from '@/lib/tutorial';
import { haptics, motion, palette, radius } from '@/design';
import { useTutorial } from '@/store/tutorialStore';

const HOLE_PAD = 8;
/** a kártya becsült magassága az elhelyezés-döntéshez (fölé/alá/középre) */
const CARD_EST_H = 210;
/**
 * A mérés UTÁN történő layout-változásokra (pl. az eszköztár a targethez GÖRGET)
 * többször is újramérünk — az utolsó látható eredmény nyer. Így nem ragad be a
 * spotlight a görgetés előtti (kilógó) pozícióra.
 */
const MEASURE_ATTEMPTS_MS = [60, 320, 560];

/** A mért elem KÖZEPE a képernyőn belül van-e? Ha kicsúszott (pl. az eszköztár
 * még nem görgetett oda, vagy a target nincs is jelen), NEM rajzolunk félrevezető
 * spotlightot — a kártya középre igazodik. */
function isOnScreen(r: Rect, w: number, h: number): boolean {
  if (r.width <= 0 || r.height <= 0) {
    return false;
  }
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  return cx >= 0 && cx <= w && cy >= 0 && cy <= h;
}

/**
 * 🎓 Felület-vezető overlay. Ha egy lecke aktív, a képernyőt elsötétíti, a
 * lépéshez tartozó UI-elemet KIEMELI (spotlight-lyuk 4 dimmelő sávval), és egy
 * coach-kártyán mutatja a **Művelet · Hol · Eredmény** hármast + a léptetést.
 *
 * A dim-sávok elnyelik az érintést (nincs véletlen szerkesztés a tour alatt) —
 * a felhasználó a kártya gombjaival halad (Vissza / Tovább / Kész), vagy kilép
 * (Kihagyás). A kártya lépésenként átúszik (FadeIn), a léptetés haptikás.
 *
 * A gyökérben (a _layout-ban) mountolva, egyetlen példány.
 */
export function TutorialOverlay() {
  const activeLessonId = useTutorial((s) => s.activeLessonId);
  const stepIndex = useTutorial((s) => s.stepIndex);
  const next = useTutorial((s) => s.next);
  const prev = useTutorial((s) => s.prev);
  const stop = useTutorial((s) => s.stop);
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<Rect | null>(null);

  const lesson = activeLessonId ? getLesson(activeLessonId) : null;
  const step = lesson?.steps[stepIndex] ?? null;
  const targetId = step?.target;
  // a lépés targetjének mérő-fn-jére FELIRATKOZUNK: ha a target KÉSŐBB regisztrál
  // (pl. a gomb csak a kijelölés megszűnte után mountol), az effekt újrafut és mér —
  // nem marad némán spotlight nélkül.
  const measureFn = useTutorial((s) => (targetId ? s.targets[targetId] : undefined));

  // a target lemérése (spotlight). A mérés késleltetve (layout kész legyen), a
  // setState async. A régi kiemelést AZONNAL töröljük, hogy lépésváltáskor ne
  // villanjon a spotlight a KORÁBBI elemre a friss mérés megérkeztéig. Több
  // időpontban mérünk (az eszköztár a targethez görgethet) — csak KÉPERNYŐN LÉVŐ
  // eredményt fogadunk el, különben marad a középre igazított kártya.
  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRect(null);
    if (!measureFn) {
      return () => {
        alive = false;
      };
    }
    const attempt = () => {
      measureFn()
        .then((r) => {
          if (alive && r && isOnScreen(r, width, height)) {
            setRect(r);
          }
        })
        .catch(() => {});
    };
    const timers = MEASURE_ATTEMPTS_MS.map((d) => setTimeout(attempt, d));
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [measureFn, stepIndex, activeLessonId, width, height]);

  if (!lesson || !step) {
    return null;
  }

  const total = lesson.steps.length;
  const isLast = stepIndex >= total - 1;

  const goNext = () => {
    haptics.impact();
    next();
  };
  const goPrev = () => {
    haptics.selection();
    prev();
  };
  const skip = () => {
    haptics.selection();
    stop();
  };

  // spotlight-téglalap (kipárnázva); ha nincs, teljes dim + középre igazított kártya
  const hole = rect
    ? {
        x: Math.max(0, rect.x - HOLE_PAD),
        y: Math.max(0, rect.y - HOLE_PAD),
        w: rect.width + HOLE_PAD * 2,
        h: rect.height + HOLE_PAD * 2,
      }
    : null;

  // kártya-elhelyezés: a lyuk alá, ha van hely; különben fölé; különben középre
  let cardTop: number;
  if (hole && hole.y + hole.h + CARD_EST_H + 24 < height) {
    cardTop = hole.y + hole.h + 14;
  } else if (hole && hole.y - CARD_EST_H - 24 > insets.top) {
    cardTop = hole.y - CARD_EST_H - 14;
  } else {
    cardTop = Math.max(insets.top + 24, (height - CARD_EST_H) / 2);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={skip} statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(motion.duration.base)} style={styles.root}>
        {/* elsötétítés: spotlight-lyuk körül 4 sáv, vagy teljes dim */}
        {hole ? (
          <>
            <View style={[styles.dim, { top: 0, left: 0, right: 0, height: hole.y }]} />
            <View style={[styles.dim, { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 }]} />
            <View style={[styles.dim, { top: hole.y, left: 0, width: hole.x, height: hole.h }]} />
            <View
              style={[styles.dim, { top: hole.y, left: hole.x + hole.w, right: 0, height: hole.h }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.holeRing,
                { top: hole.y, left: hole.x, width: hole.w, height: hole.h },
              ]}
            />
          </>
        ) : (
          <View style={[styles.dim, styles.fill]} />
        )}

        {/* coach-kártya */}
        <Animated.View
          key={`${lesson.id}-${stepIndex}`}
          entering={FadeIn.duration(motion.duration.fast)}
          style={[
            styles.card,
            { top: cardTop, width: Math.min(width - 32, 440), left: (width - Math.min(width - 32, 440)) / 2 },
          ]}
        >
          <View style={styles.cardHead}>
            <Text style={styles.lessonTitle} numberOfLines={1}>
              {localize(lesson.title, lang)}
            </Text>
            <Pressable onPress={skip} hitSlop={10} accessibilityLabel={t('tutorial.skip')}>
              <Ionicons name="close" size={20} color={palette.textDim} />
            </Pressable>
          </View>

          <Text style={styles.counter}>
            {t('tutorial.stepCounter', { current: stepIndex + 1, total })}
          </Text>

          {/* Művelet (mit tegyél) */}
          <Text style={styles.action}>{localize(step.action, lang)}</Text>

          {/* Hol (a kiemelt elem) */}
          <View style={styles.whereRow}>
            <Ionicons name="locate-outline" size={14} color={palette.accent} />
            <Text style={styles.where}>{localize(step.where, lang)}</Text>
          </View>

          {/* Eredmény (mit látsz) */}
          <Text style={styles.result}>{localize(step.result, lang)}</Text>

          <View style={styles.actions}>
            {stepIndex > 0 ? (
              <Pressable onPress={goPrev} hitSlop={8} style={styles.secondaryBtn}>
                <Ionicons name="chevron-back" size={16} color={palette.text} />
                <Text style={styles.secondaryText}>{t('tutorial.back')}</Text>
              </Pressable>
            ) : (
              <Pressable onPress={skip} hitSlop={8} style={styles.secondaryBtn}>
                <Text style={styles.secondaryText}>{t('tutorial.skip')}</Text>
              </Pressable>
            )}
            <Pressable onPress={goNext} hitSlop={8} style={styles.primaryBtn}>
              <Text style={styles.primaryText}>{isLast ? t('tutorial.done') : t('tutorial.next')}</Text>
              {!isLast ? <Ionicons name="chevron-forward" size={16} color={palette.text} /> : null}
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dim: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.72)' },
  holeRing: {
    position: 'absolute',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: palette.accent,
  },
  card: {
    position: 'absolute',
    backgroundColor: palette.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lessonTitle: { flex: 1, color: palette.text, fontSize: 15, fontWeight: '800' },
  counter: { color: palette.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  action: { color: palette.text, fontSize: 15, fontWeight: '600', lineHeight: 21 },
  whereRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  where: { flex: 1, color: palette.accent, fontSize: 12, fontWeight: '700' },
  result: { color: palette.textDim, fontSize: 13, lineHeight: 18 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 8, paddingHorizontal: 6 },
  secondaryText: { color: palette.text, fontSize: 13, fontWeight: '600' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  primaryText: { color: palette.text, fontSize: 14, fontWeight: '800' },
});

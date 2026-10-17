/**
 * 👆 Gesztus-config — az INTERAKCIÓS küszöbök egyetlen, auditálható helyen.
 *
 * MIÉRT: a long-press-késleltetés (220/350 ms), a sheet-elhúzás (110 px / 820 px/s)
 * és az előnézet pinch-skála-clamp (0.5–4×) eddig komponensekbe volt ÉGETVE, így
 * nem lehetett egy helyen hangolni. Itt EGY `gestures` token-objektum gyűjti őket.
 *
 * NEM ide tartoznak a DOMAIN/tartalom-függő limitek (idővonal-zoom:
 * `constants/editor` MIN_ZOOM/MAX_ZOOM; kép-canvas-zoom: `lib/canvasZoom`
 * ZOOM_MIN/MAX) — azok a helyükön maradnak. A snap-küszöböknek és a min.
 * érintőfelületnek MÁR van egy-egy forrása (SNAP_PX / SNAP_THRESHOLD / TOUCH_MIN)
 * — ezekre HIVATKOZUNK (nem duplikálunk), hogy a `gestures` egységes belépő
 * legyen, de EGYETLEN igazság maradjon (a drift ellen a gestures.test.ts véd).
 *
 * ── Gesztus-tulajdonjog (ki nyeri a gesztust egy adott felületen) ─────────────
 *  Előnézet (PreviewSurface):  pan=canvas/objektum · pinch=skála(focal) · tap=select
 *    kompozíció: Race(Simultaneous(pinch,pan), Exclusive(doubleTap,tap)) — commit elengedéskor
 *  Video-idővonal (TimelineClip): pan=klip-move / trim-fogantyú · tap=select/seek · long-press=drag-aktiválás
 *    kompozíció: Race(movePan, tap) + külön trim-pan a fogantyúkon
 *  Kép-canvas (ImageCanvas):   pan=RNGH(1-ujj) · pinch=RNGH(2-ujj,center) · tap=select/wand  (Touch/03 KÉSZ)
 *  Audio-idővonal (AudioTimelineClip): pan=klip-move/lane + külön trim-fogó · pinch=idővonal-zoom(focal)
 *    · tap=select/seek · long-press=drag-aktiválás  (Touch/04 KÉSZ)
 *  Előnézet-forgatás: Gesture.Rotation a Simultaneous-ban (two-finger rotate + 15°-snap)  (Touch/02.1 KÉSZ)
 */
import { SNAP_PX } from '@/constants/editor';
import { TOUCH_MIN } from '@/constants/layout';
import { SNAP_THRESHOLD } from '@/lib/snapping';

export const gestures = {
  /** Long-press aktiválási küszöbök (ms). */
  longPress: {
    /** klip-mozgatás húzás-aktiválása (TimelineClip) */
    drag: 220,
    /** kontextus-művelet / pont-törlés (pl. maszk-csúcs) — mindig > drag */
    context: 350,
  },
  /**
   * Aktiválási távolság (pt) — a gesztus-modulok (Touch/03–04) ebből olvassanak,
   * hogy a tap sose váltson véletlenül húzásba (`tap` < `pan`).
   */
  slop: {
    /** tap/koppintás még megengedett elmozdulása */
    tap: 6,
    /** pan/húzás aktiválási küszöbe (mindig > tap) */
    pan: 10,
  },
  /** Bottom-sheet elhúzás-bezárás. */
  sheet: {
    /** ennyi px lehúzás fölött bezár */
    dismissDistance: 110,
    /** VAGY ekkora sebesség (px/s) fölött bezár */
    dismissVelocity: 820,
  },
  /** Előnézet pinch-skála clamp (a kijelölt objektum nagyítása; `min` < `max`). */
  pinch: {
    previewScaleMin: 0.5,
    previewScaleMax: 4,
  },
  /** Illesztés-küszöbök — a MEGLÉVŐ egyetlen forrásokra hivatkozva (nem duplikálva). */
  snap: {
    /** idővonal pixel-snap (= `constants/editor` SNAP_PX) */
    timelinePx: SNAP_PX,
    /** vászon normalizált snap 0–1 térben (= `lib/snapping` SNAP_THRESHOLD) */
    canvasNorm: SNAP_THRESHOLD,
  },
  /** Min. kényelmes érintőfelület (pt) — a layout TOUCH_MIN tükre, egy belépőn. */
  touchMin: TOUCH_MIN,
} as const;

export type Gestures = typeof gestures;

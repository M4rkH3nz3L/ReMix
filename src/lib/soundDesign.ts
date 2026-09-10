import { t as tr } from 'i18next';

/**
 * 🔊 Sound Design AI v1 — pure réteg: hova kerüljön SFX az idővonalon.
 * A worker meglévő SFX-könyvtárára (whoosh/riser/bassdrop/…) épít, és a
 * vágópontokat + a beat-rácsot használja döntési jelként:
 *
 * · vágásra whoosh (a váltás mozgása)
 * · a legerősebb vágás elé riser, ami PONTOSAN a vágásig tart
 * · downbeatre eső vágásra bassdrop (súlyos landolás)
 * · a felirat/matrica megjelenésére pop — csak ha nem ütközik mással
 *
 * React-native import NÉLKÜL, hogy tesztelhető legyen.
 */

/** a könyvtár-azonosítók, amiket a tervező használ (mind generált SFX) */
export type SfxId =
  | 'sfx-whoosh'
  | 'sfx-riser'
  | 'sfx-bassdrop'
  | 'sfx-pop'
  | 'sfx-click'
  | 'sfx-ding';

export interface SfxPlacement {
  sfxId: SfxId;
  /** idővonal-kezdet (mp) */
  start: number;
  /** kívánt hossz (mp) — a riser a vágásig nyúlik, a többi a natív hossza */
  duration: number;
  volume: number;
  /** miért került ide — a felhasználónak mutatjuk */
  reason: string;
}

export interface SoundDesignInput {
  /** vágópontok idővonal-időben (az első klip eleje NEM vágás) */
  cuts: number[];
  /** beat-rács idővonal-időben (üres, ha nincs zene / beat-analízis) */
  beats: number[];
  /** hangsúlyos ütemek (ütem-elsők) */
  downbeats: number[];
  /** felirat/overlay megjelenések ideje */
  accents: number[];
  /** a projekt teljes hossza */
  duration: number;
}

export interface SoundDesignOptions {
  /** összesen legfeljebb ennyi SFX (a hangkép ne legyen szemetes) */
  maxPlacements?: number;
  /** két SFX közti minimális távolság */
  minGap?: number;
  /** a riser hossza (a vágás elé nyúlik vissza) */
  riserLength?: number;
  intensity?: 'subtle' | 'normal' | 'punchy';
}

const NATIVE_DURATION: Record<SfxId, number> = {
  'sfx-whoosh': 0.6,
  'sfx-riser': 1.5,
  'sfx-bassdrop': 1.6,
  'sfx-pop': 0.3,
  'sfx-click': 0.05,
  'sfx-ding': 1,
};

const GAIN: Record<NonNullable<SoundDesignOptions['intensity']>, number> = {
  subtle: 0.4,
  normal: 0.62,
  punchy: 0.85,
};

/** a t-hez legközelebbi rácspont távolsága (Infinity, ha nincs rács) */
function distanceToGrid(t: number, grid: number[]): number {
  let best = Infinity;
  for (const g of grid) {
    const d = Math.abs(g - t);
    if (d < best) {
      best = d;
    }
  }
  return best;
}

/**
 * A terv. A vágások fontossági sorrendben kapnak hangot: elöl azok, amik
 * downbeatre esnek (ott a legerősebb a hatás), utána a beatre esők, végül a
 * többi. Így a `maxPlacements` korlát a LEGJOBB helyeket tartja meg, nem az
 * első néhányat.
 */
export function planSoundDesign(
  input: SoundDesignInput,
  opts: SoundDesignOptions = {}
): SfxPlacement[] {
  const maxPlacements = opts.maxPlacements ?? 14;
  const minGap = opts.minGap ?? 0.35;
  const riserLength = opts.riserLength ?? 1.4;
  const gain = GAIN[opts.intensity ?? 'normal'];

  const cuts = [...new Set(input.cuts)]
    .filter((t) => t > 0.15 && t < input.duration - 0.1)
    .sort((a, b) => a - b);

  // rangsor: downbeat-közeli vágás > beat-közeli vágás > sima vágás
  const ranked = cuts
    .map((t) => {
      const dbDist = distanceToGrid(t, input.downbeats);
      const bDist = distanceToGrid(t, input.beats);
      const rank = dbDist < 0.12 ? 0 : bDist < 0.12 ? 1 : 2;
      return { t, rank, onDownbeat: dbDist < 0.12 };
    })
    .sort((a, b) => a.rank - b.rank || a.t - b.t);

  const placements: SfxPlacement[] = [];
  const taken: { start: number; end: number }[] = [];

  const free = (start: number, duration: number) =>
    !taken.some((s) => start < s.end + minGap && start + duration > s.start - minGap);

  const place = (p: SfxPlacement) => {
    if (p.start < 0 || p.start + p.duration > input.duration + 0.01) {
      return false;
    }
    if (!free(p.start, p.duration)) {
      return false;
    }
    placements.push(p);
    taken.push({ start: p.start, end: p.start + p.duration });
    return true;
  };

  // 1) a legerősebb vágás elé riser (csak egy — a felvezetés akkor hat, ha ritka)
  const hero = ranked[0];
  if (hero && hero.t - riserLength > 0.2) {
    place({
      sfxId: 'sfx-riser',
      start: hero.t - riserLength,
      duration: riserLength,
      volume: gain * 0.8,
      reason: tr('lib.soundDesign.leadIn'),
    });
  }

  // 2) vágás-hangok, rangsor szerint
  for (const cut of ranked) {
    if (placements.length >= maxPlacements) {
      break;
    }
    if (cut.onDownbeat) {
      const ok = place({
        sfxId: 'sfx-bassdrop',
        start: cut.t,
        duration: NATIVE_DURATION['sfx-bassdrop'],
        volume: gain,
        reason: tr('lib.soundDesign.beatCut'),
      });
      if (ok) {
        continue;
      }
    }
    // a whoosh a vágás ELŐTT indul, hogy a csúcsa a vágásra essen
    const lead = 0.18;
    place({
      sfxId: 'sfx-whoosh',
      start: Math.max(0, cut.t - lead),
      duration: NATIVE_DURATION['sfx-whoosh'],
      volume: gain * 0.75,
      reason: tr('lib.soundDesign.cut'),
    });
  }

  // 3) felirat/overlay-megjelenésekre pop — csak a szabad helyekre
  for (const accent of [...new Set(input.accents)].sort((a, b) => a - b)) {
    if (placements.length >= maxPlacements) {
      break;
    }
    place({
      sfxId: 'sfx-pop',
      start: accent,
      duration: NATIVE_DURATION['sfx-pop'],
      volume: gain * 0.55,
      reason: tr('lib.soundDesign.elementAppear'),
    });
  }

  return placements.sort((a, b) => a.start - b.start);
}

/** a tervben szereplő SFX-ek (letöltéshez — minden fájl csak egyszer kell) */
export function usedSfxIds(placements: SfxPlacement[]): SfxId[] {
  return [...new Set(placements.map((p) => p.sfxId))];
}

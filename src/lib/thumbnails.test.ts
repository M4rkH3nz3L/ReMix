import { FILMSTRIP_MAX_TILES, filmstripTiles, snapThumbTime } from '@/lib/thumbnails';

describe('snapThumbTime — cache-barát 0,5 mp-rács', () => {
  it('fél másodpercre pattint, nem megy 0 alá', () => {
    expect(snapThumbTime(1.24)).toBe(1);
    expect(snapThumbTime(1.26)).toBe(1.5);
    expect(snapThumbTime(-3)).toBe(0);
  });
});

describe('filmstripTiles — a filmstrip VÉGIG fedi a klipet (nincs üres rész)', () => {
  it('rövid klip: ~négyzetes csempék, a teljes szélességet kitöltik', () => {
    // 400px / 40px tile → 10 csempe (cap alatt), tileW = 40 (négyzet)
    const { count, tileW, times } = filmstripTiles(400, 40, 10, 0, 1);
    expect(count).toBe(10);
    expect(tileW).toBe(40);
    expect(count * tileW).toBeCloseTo(400); // TELJES szélesség-fedés
    expect(times.length).toBe(10);
  });

  it('HOSSZÚ klip (a bug): a csempék a teljes szélességet fedik, az időpontok a VÉGÉIG érnek', () => {
    // 2 perces klip ~44 px/s zoomon ≈ 5280px, 40px sáv. Korábban: 24 csempe × 40px = 960px
    // (≈22 mp), a többi ÜRES. Most: a cap-nyi csempe a TELJES szélességet kitölti.
    const durationSec = 120;
    const widthPx = 5280;
    const { count, tileW, times } = filmstripTiles(widthPx, 40, durationSec, 0, 1);

    expect(count).toBe(FILMSTRIP_MAX_TILES); // 132 kéne, de a perf-cap 48
    // 🔑 a csempék a TELJES klip-szélességet kitöltik (nem csak az első 960px-t)
    expect(count * tileW).toBeCloseTo(widthPx);
    // 🔑 az UTOLSÓ csempe a klip VÉGÉHEZ közeli kockát mutatja (NEM a 22. mp-nél elakadva)
    expect(times[times.length - 1]).toBeGreaterThan(durationSec * 0.95); // ~119 mp > 114
    expect(times[times.length - 1]).toBeLessThanOrEqual(durationSec);
    // az első csempe a klip elejéhez közeli
    expect(times[0]).toBeLessThan(durationSec * 0.05);
    // monoton növekvő időpontok a klip hosszán
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it('trim + sebesség helyes: a forrás-időpontok a [trimIn, trimIn+duration·speed] ablakban', () => {
    // trimIn=5, duration=10 (timeline), speed=2 → forrás-ablak [5, 25]
    const { times } = filmstripTiles(400, 40, 10, 5, 2);
    expect(times[0]).toBeGreaterThanOrEqual(5);
    expect(times[times.length - 1]).toBeLessThanOrEqual(25);
    expect(times[times.length - 1]).toBeGreaterThan(20); // a végéhez közeli
  });

  it('nulla/érvénytelen szélesség → 1 csempe, nem omlik össze', () => {
    const { count, tileW, times } = filmstripTiles(0, 40, 10, 0, 1);
    expect(count).toBe(1);
    expect(tileW).toBeGreaterThan(0);
    expect(times.length).toBe(1);
  });
});

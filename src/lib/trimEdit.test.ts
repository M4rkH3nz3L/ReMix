import { buildRollEdit, buildSlideEdit, buildSlipEdit } from '@/lib/trimEdit';
import type { Clip, Track, VideoClip } from '@/types/project';

/** videóklip a teszthez — bőséges forrás-hosszal, hogy a korlát ne zavarjon */
const vid = (o: {
  id: string;
  start: number;
  duration: number;
  trimIn?: number;
  sourceDuration?: number;
  speed?: number;
}): VideoClip =>
  ({
    kind: 'video',
    uri: 'file:///x.mp4',
    volume: 1,
    speed: o.speed ?? 1,
    trimIn: o.trimIn ?? 0,
    sourceDuration: o.sourceDuration ?? 60,
    ...o,
  }) as unknown as VideoClip;

const track = (clips: Clip[]): Track =>
  ({ id: 't', type: 'video', name: 'v', clips }) as unknown as Track;

const byId = (clips: Clip[] | null, id: string) => clips?.find((c) => c.id === id) as VideoClip;

describe('trimEdit — profi vágó-műveletek', () => {
  describe('ROLL — a közös vágáspont mozog, az EGYÜTTES hossz állandó', () => {
    const t = track([
      vid({ id: 'a', start: 0, duration: 5 }),
      vid({ id: 'b', start: 5, duration: 5, trimIn: 2 }),
    ]);

    it('jobb élre: A nő, B ugyanannyit rövidül, a vége helyben marad', () => {
      const out = buildRollEdit(t, 'a', 'right', 1);
      expect(byId(out, 'a').duration).toBeCloseTo(6, 6);
      expect(byId(out, 'b').start).toBeCloseTo(6, 6);
      expect(byId(out, 'b').duration).toBeCloseTo(4, 6);
      // a blokk teljes hossza változatlan
      const end = byId(out, 'b').start + byId(out, 'b').duration;
      expect(end).toBeCloseTo(10, 6);
    });

    it('a B forrás-ablaka is követi a vágáspontot (trimIn nő)', () => {
      const out = buildRollEdit(t, 'a', 'right', 1);
      expect(byId(out, 'b').trimIn).toBeCloseTo(3, 6);
    });

    it('bal élre: a megelőző klip nő, a kijelölt rövidül', () => {
      const out = buildRollEdit(t, 'b', 'left', 1);
      expect(byId(out, 'a').duration).toBeCloseTo(6, 6);
      expect(byId(out, 'b').start).toBeCloseTo(6, 6);
      expect(byId(out, 'b').duration).toBeCloseTo(4, 6);
    });

    it('NEM megy át a forrás elején: B trimIn=0-nál balra nincs mozgástér', () => {
      const t2 = track([
        vid({ id: 'a', start: 0, duration: 5 }),
        vid({ id: 'b', start: 5, duration: 5, trimIn: 0 }),
      ]);
      // negatív delta = A rövidül, B VISSZAFELÉ nőne → trimIn < 0 kellene
      expect(buildRollEdit(t2, 'a', 'right', -3)).toBeNull();
    });

    it('jobbra viszont mehet: ott a B trimIn-je NŐ (nincs forrás-korlát)', () => {
      const t2 = track([
        vid({ id: 'a', start: 0, duration: 5 }),
        vid({ id: 'b', start: 5, duration: 5, trimIn: 0 }),
      ]);
      const out = buildRollEdit(t2, 'a', 'right', 3);
      expect(byId(out, 'b').trimIn).toBeCloseTo(3, 6);
      expect(byId(out, 'b').duration).toBeCloseTo(2, 6);
    });

    it('nem rövidít MIN_CLIP_DURATION alá', () => {
      const out = buildRollEdit(t, 'a', 'right', 99);
      const b = byId(out, 'b');
      expect(b.duration).toBeGreaterThan(0);
      expect(b.duration).toBeLessThan(5);
    });

    it('csak ÉRINTKEZŐ szomszéddal működik (hézagnál null)', () => {
      const gapped = track([
        vid({ id: 'a', start: 0, duration: 5 }),
        vid({ id: 'b', start: 8, duration: 5 }), // 3 mp hézag
      ]);
      expect(buildRollEdit(gapped, 'a', 'right', 1)).toBeNull();
    });

    it('szomszéd nélkül null', () => {
      expect(buildRollEdit(track([vid({ id: 'a', start: 0, duration: 5 })]), 'a', 'right', 1)).toBeNull();
    });

    it('elhanyagolható elmozdulás → null (nincs fölösleges undo-lépés)', () => {
      expect(buildRollEdit(t, 'a', 'right', 0.0001)).toBeNull();
    });
  });

  describe('SLIP — a hely és a hossz állandó, a forrás-ablak csúszik', () => {
    it('jobbra húzás → KORÁBBI forrás-tartalom (trimIn csökken)', () => {
      const c = vid({ id: 'a', start: 0, duration: 5, trimIn: 3, sourceDuration: 60 });
      expect(buildSlipEdit(c, 1)).toBeCloseTo(2, 6);
    });

    it('sebességgel skálázódik (2× → kétszer annyi forrás-idő)', () => {
      const c = vid({ id: 'a', start: 0, duration: 5, trimIn: 10, speed: 2, sourceDuration: 60 });
      expect(buildSlipEdit(c, 1)).toBeCloseTo(8, 6);
    });

    it('nem megy a forrás eleje elé', () => {
      const c = vid({ id: 'a', start: 0, duration: 5, trimIn: 0.5 });
      expect(buildSlipEdit(c, 5)).toBe(0);
    });

    it('nem megy a forrás vége mögé', () => {
      const c = vid({ id: 'a', start: 0, duration: 5, trimIn: 0, sourceDuration: 8 });
      // a látható ablak 5 mp → a trimIn legfeljebb 3 lehet
      expect(buildSlipEdit(c, -99)).toBeCloseTo(3, 6);
    });

    it('elhanyagolható elmozdulás → null', () => {
      const c = vid({ id: 'a', start: 0, duration: 5, trimIn: 3 });
      expect(buildSlipEdit(c, 0.0001)).toBeNull();
    });
  });

  describe('SLIDE — a klip egészben mozog, a szomszédok nyúlnak', () => {
    const t = track([
      vid({ id: 'a', start: 0, duration: 5 }),
      vid({ id: 'b', start: 5, duration: 5, trimIn: 2 }),
      vid({ id: 'c', start: 10, duration: 5, trimIn: 2 }),
    ]);

    it('a középső klip hossza NEM változik', () => {
      const out = buildSlideEdit(t, 'b', 1);
      expect(byId(out, 'b').duration).toBeCloseTo(5, 6);
      expect(byId(out, 'b').start).toBeCloseTo(6, 6);
    });

    it('az előző nő, a következő rövidül ugyanannyit', () => {
      const out = buildSlideEdit(t, 'b', 1);
      expect(byId(out, 'a').duration).toBeCloseTo(6, 6);
      expect(byId(out, 'c').start).toBeCloseTo(11, 6);
      expect(byId(out, 'c').duration).toBeCloseTo(4, 6);
    });

    it('a klip saját forrás-ablaka változatlan (ez a slide lényege)', () => {
      const out = buildSlideEdit(t, 'b', 1);
      expect(byId(out, 'b').trimIn).toBeCloseTo(2, 6);
    });

    it('szomszéd nélkül csak az idővonal eleje korlátoz', () => {
      const solo = track([vid({ id: 'a', start: 2, duration: 5 })]);
      const out = buildSlideEdit(solo, 'a', -99);
      expect(byId(out, 'a').start).toBe(0);
    });

    it('elhanyagolható elmozdulás → null', () => {
      expect(buildSlideEdit(t, 'b', 0.0001)).toBeNull();
    });
  });

  it('ismeretlen klip-id → null (mindhárom)', () => {
    const t = track([vid({ id: 'a', start: 0, duration: 5 })]);
    expect(buildRollEdit(t, 'nincs', 'right', 1)).toBeNull();
    expect(buildSlideEdit(t, 'nincs', 1)).toBeNull();
  });
});

import {
  TUTORIAL_LESSONS,
  getLesson,
  lessonsByLevel,
  localize,
  nextStepIndex,
  prevStepIndex,
} from '@/lib/tutorial';

describe('tutorial adat-integritás', () => {
  it('egyedi lecke-id + van lépés + minden lépés-mező háromnyelvű (nem üres)', () => {
    const ids = TUTORIAL_LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of TUTORIAL_LESSONS) {
      expect(l.steps.length).toBeGreaterThan(0);
      for (const f of [l.title]) {
        expect(f.hu && f.en && f.de).toBeTruthy();
      }
      for (const s of l.steps) {
        for (const f of [s.action, s.where, s.result]) {
          expect(f.hu.length).toBeGreaterThan(0);
          expect(f.en.length).toBeGreaterThan(0);
          expect(f.de.length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('getLesson megtalál / hiányra undefined', () => {
    expect(getLesson('basics')?.id).toBe('basics');
    expect(getLesson('nincs-ilyen')).toBeUndefined();
  });
  it('lessonsByLevel MINDEN leckét lefed (nincs kimaradó szint)', () => {
    const total = lessonsByLevel().reduce((n, g) => n + g.lessons.length, 0);
    expect(total).toBe(TUTORIAL_LESSONS.length);
  });
});

describe('localize', () => {
  it('a nyelv szerint választ, ismeretlennél a magyar a fallback', () => {
    const loc = { hu: 'H', en: 'E', de: 'D' };
    expect(localize(loc, 'en')).toBe('E');
    expect(localize(loc, 'de')).toBe('D');
    expect(localize(loc, 'en-US')).toBe('E');
    expect(localize(loc, 'fr')).toBe('H');
    expect(localize(loc, undefined)).toBe('H');
  });
});

describe('léptetés', () => {
  it('nextStepIndex a végén -1 (kész)', () => {
    expect(nextStepIndex(0, 3)).toBe(1);
    expect(nextStepIndex(1, 3)).toBe(2);
    expect(nextStepIndex(2, 3)).toBe(-1);
  });
  it('prevStepIndex 0 alá nem megy', () => {
    expect(prevStepIndex(2)).toBe(1);
    expect(prevStepIndex(0)).toBe(0);
  });
});

import { finiteNum, finiteTime, mapValid, rangeList, timeList, unitNum } from '@/lib/parseGuards';

describe('parseGuards — a worker válasza és a projekt közötti ellenőrzőpont', () => {
  describe('finiteNum', () => {
    it('csak valódi, véges számot enged át', () => {
      expect(finiteNum(3.5)).toBe(3.5);
      expect(finiteNum(0)).toBe(0);
      expect(finiteNum(-2)).toBe(-2);
    });

    it('NaN / Infinity → null (ezek terjednek tovább a számításokban)', () => {
      expect(finiteNum(NaN)).toBeNull();
      expect(finiteNum(Infinity)).toBeNull();
      expect(finiteNum(-Infinity)).toBeNull();
    });

    it('a szám-SZERŰ értékek sem mennek át (JSON-ban gyakori a string-szám)', () => {
      expect(finiteNum('12')).toBeNull();
      expect(finiteNum(null)).toBeNull();
      expect(finiteNum(undefined)).toBeNull();
      expect(finiteNum(true)).toBeNull();
      expect(finiteNum({})).toBeNull();
    });
  });

  describe('finiteTime / unitNum', () => {
    it('az idő nem lehet negatív', () => {
      expect(finiteTime(0)).toBe(0);
      expect(finiteTime(-0.001)).toBeNull();
    });

    it('a normalizált pozíció 0–1 közé SZORUL (nem esik ki)', () => {
      expect(unitNum(1.4)).toBe(1);
      expect(unitNum(-3)).toBe(0);
      expect(unitNum(0.5)).toBe(0.5);
      expect(unitNum(NaN)).toBeNull();
    });
  });

  describe('timeList — vágáspontok', () => {
    it('a romlott elemek kiesnek, a jók megmaradnak (részleges eredmény > semmi)', () => {
      expect(timeList([1, NaN, 2, null, 'x', -5, 3])).toEqual([1, 2, 3]);
    });

    it('NÖVEKVŐ sorrend és duplikátum-mentesség (a vágás ezt feltételezi)', () => {
      expect(timeList([3, 1, 2, 1, 3])).toEqual([1, 2, 3]);
    });

    it('a felső korlátot tiszteletben tartja (klip végén túli vágás nincs)', () => {
      expect(timeList([1, 5, 12], { max: 10 })).toEqual([1, 5]);
    });

    it('nem tömb bemenet → üres lista (nem dob)', () => {
      expect(timeList(null)).toEqual([]);
      expect(timeList('nem tömb')).toEqual([]);
      expect(timeList(undefined)).toEqual([]);
    });
  });

  describe('rangeList — csend-tartományok', () => {
    it('a jó párokat átengedi, start szerint rendezve', () => {
      expect(rangeList([{ start: 3, end: 4 }, { start: 1, end: 2 }])).toEqual([
        { start: 1, end: 2 },
        { start: 3, end: 4 },
      ]);
    });

    it('a FORDÍTOTT tartomány kiesik (negatív klip-hosszt szülne)', () => {
      expect(rangeList([{ start: 5, end: 2 }])).toEqual([]);
    });

    it('a nulla hosszú tartomány is kiesik', () => {
      expect(rangeList([{ start: 2, end: 2 }])).toEqual([]);
    });

    it('a hiányzó / nem véges mezőjű elem kiesik', () => {
      expect(rangeList([{ start: 1 }, { end: 2 }, { start: NaN, end: 3 }, {}, null, 7])).toEqual([]);
    });

    it('a max a VÉGET vágja le, az elemet nem dobja el', () => {
      expect(rangeList([{ start: 8, end: 20 }], { max: 10 })).toEqual([{ start: 8, end: 10 }]);
    });

    it('a max utáni tartomány viszont teljesen kiesik', () => {
      expect(rangeList([{ start: 20, end: 30 }], { max: 10 })).toEqual([]);
    });
  });

  describe('mapValid', () => {
    it('a null-t adó elemek kiesnek, a többi megmarad', () => {
      const out = mapValid<number>([{ v: 1 }, { v: 'rossz' }, { v: 3 }], (o) => finiteNum(o.v));
      expect(out).toEqual([1, 3]);
    });

    it('a nem objektum elemeket meg sem kérdezi', () => {
      const parse = jest.fn(() => 1);
      mapValid([null, 5, 'x', undefined, { ok: true }], parse);
      expect(parse).toHaveBeenCalledTimes(1);
    });

    it('nem tömb bemenet → üres lista', () => {
      expect(mapValid(null, () => 1)).toEqual([]);
    });
  });
});

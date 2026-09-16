import { hexToAssColor, serializeAss } from '@/lib/ass';
import { replaceProfanity } from '@/lib/profanity';
import { serializeVtt } from '@/lib/vtt';

describe('felirat-formátumok', () => {
  describe('WebVTT', () => {
    const vtt = serializeVtt([
      { start: 0, end: 1.5, text: 'Helló' },
      { start: 1.5, end: 3.2, text: 'világ', y: 0.78 },
    ]);

    it('kötelező WEBVTT fejléccel kezdődik', () => {
      expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    });
    it('az időbélyeg PONTOT használ (nem vesszőt, mint az SRT)', () => {
      expect(vtt).toContain('00:00:00.000 --> 00:00:01.500');
    });
    it('a sor-pozíciót cue-beállításként írja ki', () => {
      expect(vtt).toContain('line:78%,center align:center');
    });
    it('pozíció nélkül nem tesz be cue-beállítást', () => {
      expect(vtt).toMatch(/00:00:00\.000 --> 00:00:01\.500\nHelló/);
    });
  });

  describe('ASS', () => {
    it('hexToAssColor BGR-sorrendbe fordít', () => {
      expect(hexToAssColor('#ffffff')).toBe('&H00FFFFFF');
      expect(hexToAssColor('#ff8800')).toBe('&H000088FF'); // r=ff g=88 b=00
    });
    it('érvénytelen színre fehérrel tér vissza', () => {
      expect(hexToAssColor('nem-szín')).toBe('&H00FFFFFF');
    });

    const ass = serializeAss(
      [
        {
          start: 0,
          end: 2,
          text: 'Sárga\nkét sor',
          color: '#ffd166',
          bold: true,
          position: { x: 0.5, y: 0.8 },
          fontSizePct: 6,
        },
      ],
      { width: 1080, height: 1920 }
    );

    it('a PlayRes a megadott vászon', () => {
      expect(ass).toContain('PlayResX: 1080');
      expect(ass).toContain('PlayResY: 1920');
    });
    it('centiszekundumos időt ír (ASS-konvenció)', () => {
      expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,');
    });
    it('a pontos pozíciót közép-anchorral adja meg', () => {
      expect(ass).toContain('\\an5\\pos(540,1536)');
    });
    it('a félkövért és a betűméretet felülíró tagként viszi', () => {
      expect(ass).toContain('\\b1');
      expect(ass).toContain('\\fs115'); // a magasság 6%-a
    });
    it('a sortörés ASS-escape (\\N)', () => {
      expect(ass).toContain('Sárga\\Nkét sor');
    });
  });

  describe('profanity-szűrés', () => {
    it('maszkolja a szót, de az első betűt megtartja', () => {
      const r = replaceProfanity('Ez egy fucking jó nap, szar időben', 'mask');
      expect(r.count).toBe(2);
      expect(r.text).toMatch(/f\*+/);
      expect(r.text).toMatch(/s\*+/);
    });
    it('kis/nagybetűre érzéketlen', () => {
      const r = replaceProfanity('What the FUCK', 'stars');
      expect(r.count).toBe(1);
      expect(r.text).toContain('****');
    });
    it('törlésnél összevonja a dupla szóközt', () => {
      const r = replaceProfanity('a kurva életbe', 'remove');
      expect(r.count).toBe(1);
      expect(r.text).not.toMatch(/\s{2,}/);
    });
    it('NEM ad fals találatot részszóra', () => {
      // az "ass"/"bass" nem szerepel tőként, a "bastard" külön szó
      expect(replaceProfanity('assistant classic bass', 'mask').count).toBe(0);
    });
    it('a hosszabb alakot illeszti előbb (fucking, nem fuck+ing)', () => {
      const r = replaceProfanity('fucking', 'mask');
      expect(r.count).toBe(1);
      expect(r.text).toBe('f******');
    });
  });
});

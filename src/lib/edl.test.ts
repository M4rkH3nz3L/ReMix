import { buildEdl, clipsToEdlEvents } from '@/lib/edl';

describe('edl — clipsToEdlEvents', () => {
  it('idővonal-klipek → egymás utáni EDL-események', () => {
    const ev = clipsToEdlEvents([
      { start: 0, duration: 5, trimIn: 2, name: 'A' },
      { start: 5, duration: 3 },
    ]);
    expect(ev[0]).toMatchObject({ srcInSec: 2, srcOutSec: 7, recInSec: 0, recOutSec: 5, name: 'A' });
    expect(ev[1]).toMatchObject({ srcInSec: 0, srcOutSec: 3, recInSec: 5, recOutSec: 8 });
  });
});

describe('edl — buildEdl', () => {
  it('CMX3600 fejléc + esemény-sorok timecode-dal (30 fps)', () => {
    const edl = buildEdl('Teszt', clipsToEdlEvents([{ start: 0, duration: 5, trimIn: 0, name: 'Intro' }]), 30);
    expect(edl).toContain('TITLE: Teszt');
    expect(edl).toContain('FCM: NON-DROP FRAME');
    expect(edl).toMatch(/001 {2}AX {7}V {5}C {8}00:00:00:00 00:00:05:00 00:00:00:00 00:00:05:00/);
    expect(edl).toContain('* FROM CLIP NAME: Intro');
  });

  it('több esemény sorszámozva', () => {
    const edl = buildEdl('X', clipsToEdlEvents([{ start: 0, duration: 2 }, { start: 2, duration: 2 }]), 25);
    expect(edl).toContain('001');
    expect(edl).toContain('002');
  });

  it('üres cím → alap', () => {
    expect(buildEdl('  ', [], 30)).toContain('TITLE: ReMix Export');
  });
});

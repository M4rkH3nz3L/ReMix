const { StampedJobs, sweepFinishedJobs } = require('./jobSweep');

describe('sweepFinishedJobs', () => {
  it('a lejárt lezárt jobot a mappájával törli, a futót és a frisset nem', () => {
    const jobs = new StampedJobs();
    jobs.set('old', { state: 'done', dir: '/tmp/a' });
    jobs.set('err', { state: 'error', dir: '/tmp/b' });
    jobs.set('run', { state: 'processing', dir: '/tmp/c' });
    const removed = [];
    const now = Date.now();
    expect(sweepFinishedJobs(jobs, now + 1000, 60_000, (d) => removed.push(d))).toBe(0);
    expect(sweepFinishedJobs(jobs, now + 61_000, 60_000, (d) => removed.push(d))).toBe(2);
    expect(removed).toEqual(['/tmp/a', '/tmp/b']);
    expect([...jobs.keys()]).toEqual(['run']);
  });

  it('minden írás frissíti az időbélyeget', () => {
    const jobs = new StampedJobs();
    jobs.set('a', { state: 'processing' });
    expect(typeof jobs.get('a').updatedAt).toBe('number');
  });

  it('a mappa törlésének hibája nem állítja meg a söprést', () => {
    const jobs = new StampedJobs();
    jobs.set('a', { state: 'done', dir: '/x' });
    jobs.set('b', { state: 'done', dir: '/y' });
    const n = sweepFinishedJobs(jobs, Date.now() + 10, 0, () => {
      throw new Error('EBUSY');
    });
    expect(n).toBe(2);
  });
});

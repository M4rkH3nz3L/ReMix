import type { RenderJob } from '@/lib/schedules';
import { cap, countJobs, progressBarWidth, workerShortId } from '@/lib/schedulesScreenOps';

const job = (state: RenderJob['state']) => ({ state }) as RenderJob;

describe('schedulesScreenOps — a render-sor képernyő tiszta magja', () => {
  it('cap: az első betű nagybetűs, a többi változatlan; üres szöveg üres marad', () => {
    expect(cap('active')).toBe('Active');
    expect(cap('waiting')).toBe('Waiting');
    expect(cap('aBC')).toBe('ABC');
    expect(cap('')).toBe('');
  });

  it('a haladás-sáv szélessége 3 és 100 % közé szorítva', () => {
    expect(progressBarWidth(0)).toBe('3%');
    expect(progressBarWidth(-20)).toBe('3%');
    expect(progressBarWidth(3)).toBe('3%');
    expect(progressBarWidth(55.5)).toBe('55.5%');
    expect(progressBarWidth(100)).toBe('100%');
    expect(progressBarWidth(140)).toBe('100%');
  });

  it('a worker rövid azonosítója: a shortId, különben (null/üres) az id első 6 jele', () => {
    expect(workerShortId({ id: 'abcdefghij', shortId: '4242' })).toBe('4242');
    expect(workerShortId({ id: 'abcdefghij', shortId: null })).toBe('abcdef');
    expect(workerShortId({ id: 'abcdefghij', shortId: '' })).toBe('abcdef');
    expect(workerShortId({ id: 'ab', shortId: null })).toBe('ab');
  });

  it('az adott állapotú jobok száma', () => {
    const jobs = [job('active'), job('waiting'), job('active'), job('failed'), job('completed')];
    expect(countJobs(jobs, 'active')).toBe(2);
    expect(countJobs(jobs, 'waiting')).toBe(1);
    expect(countJobs([], 'active')).toBe(0);
  });
});

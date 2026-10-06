import {
  isAutoResolvable,
  needsAttention,
  resolutionActions,
  syncState,
  type FileVersion,
} from '@/lib/fileConflict';

const v = (hash: string | null, exists?: boolean): FileVersion => ({ hash, ...(exists === undefined ? {} : { exists }) });

describe('syncState — 3-utas összevetés', () => {
  it('egyik helyen sincs → absent', () => {
    expect(syncState(null, null)).toBe('absent');
    expect(syncState({ exists: false }, { exists: false })).toBe('absent');
  });

  it('csak lokális / csak távoli → local-only / remote-only', () => {
    expect(syncState(v('a'), null)).toBe('local-only');
    expect(syncState(null, v('a'))).toBe('remote-only');
  });

  it('azonos hash → in-sync', () => {
    expect(syncState(v('abc'), v('abc'))).toBe('in-sync');
    expect(syncState(v('abc'), v('abc'), v('base'))).toBe('in-sync');
  });

  it('base nélkül eltérő hash → conflict (nem találgat irányt)', () => {
    expect(syncState(v('local'), v('remote'))).toBe('conflict');
  });

  it('base-szel: csak lokális változott → local-ahead', () => {
    expect(syncState(v('new'), v('base'), v('base'))).toBe('local-ahead');
  });

  it('base-szel: csak távoli változott → remote-ahead', () => {
    expect(syncState(v('base'), v('new'), v('base'))).toBe('remote-ahead');
  });

  it('base-szel: mindkettő változott (divergált) → conflict', () => {
    expect(syncState(v('localNew'), v('remoteNew'), v('base'))).toBe('conflict');
  });

  it('a létezést az exists flag felülírja a hash felett', () => {
    // van hash, de exists:false → nincs jelen
    expect(syncState({ hash: 'a', exists: false }, v('b'))).toBe('remote-only');
  });
});

describe('resolutionActions — a §8.6 flow gombjai', () => {
  it('conflict + remote-ahead: Use new / Keep current / Compare', () => {
    expect(resolutionActions('conflict')).toEqual(['use-remote', 'keep-local', 'compare']);
    expect(resolutionActions('remote-ahead')).toEqual(['use-remote', 'keep-local', 'compare']);
  });
  it('egyértelmű irányok', () => {
    expect(resolutionActions('local-only')).toEqual(['upload']);
    expect(resolutionActions('remote-only')).toEqual(['download']);
    expect(resolutionActions('local-ahead')).toEqual(['upload', 'keep-local']);
    expect(resolutionActions('in-sync')).toEqual(['none']);
  });
});

describe('needsAttention / isAutoResolvable', () => {
  it('figyelmet igényel: conflict + remote-ahead', () => {
    expect(needsAttention('conflict')).toBe(true);
    expect(needsAttention('remote-ahead')).toBe(true);
    expect(needsAttention('local-ahead')).toBe(false);
    expect(needsAttention('in-sync')).toBe(false);
  });
  it('automatikusan feloldható: local/remote-only, local-ahead, in-sync', () => {
    expect(isAutoResolvable('local-only')).toBe(true);
    expect(isAutoResolvable('remote-ahead')).toBe(false); // ez user-döntés
    expect(isAutoResolvable('conflict')).toBe(false);
  });
});

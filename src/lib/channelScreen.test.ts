import {
  channelNames,
  compact,
  promoteBudget,
  promoteCostPerView,
  promoteTargetViews,
} from '@/lib/channelScreen';
import type { ChannelData } from '@/lib/feedCore/channel';

function data(creator: ChannelData['creator']): ChannelData {
  return {
    userId: 'u1',
    creator,
    posts: [],
    followers: 0,
    following: 0,
    postCount: 0,
    isFollowing: false,
    isMe: false,
  };
}

describe('compact — tömör számok (kirögzítve)', () => {
  it('1000 alatt változatlan', () => {
    expect(compact(0)).toBe('0');
    expect(compact(999)).toBe('999');
  });

  it('ezres és milliós alak egy tizedessel (kerekítve)', () => {
    expect(compact(1000)).toBe('1.0k');
    expect(compact(1500)).toBe('1.5k');
    expect(compact(999_999)).toBe('1000.0k');
    expect(compact(1_000_000)).toBe('1.0M');
    expect(compact(2_550_000)).toBe('2.5M');
  });
});

describe('kiemelés mezői (kirögzítve)', () => {
  it('a keret nem szám → 0, a tizedes levágódik', () => {
    expect(promoteBudget('abc')).toBe(0);
    expect(promoteBudget('')).toBe(0);
    expect(promoteBudget('50')).toBe(50);
    expect(promoteBudget('12.9')).toBe(12);
    expect(promoteBudget('-5')).toBe(-5);
  });

  it('a megtekintésenkénti ár legalább 1', () => {
    expect(promoteCostPerView('0')).toBe(1);
    expect(promoteCostPerView('x')).toBe(1);
    expect(promoteCostPerView('-3')).toBe(1);
    expect(promoteCostPerView('7')).toBe(7);
  });

  it('a várható megtekintés lefelé kerekített hányados', () => {
    expect(promoteTargetViews('50', '1')).toBe(50);
    expect(promoteTargetViews('100', '7')).toBe(14);
    expect(promoteTargetViews('100', '0')).toBe(100);
    expect(promoteTargetViews('abc', '1')).toBe(0);
    expect(promoteTargetViews('-5', '2')).toBe(-3);
  });
});

describe('channelNames — handle és megjelenített név (kirögzítve)', () => {
  it('creator-ral a felhasználónév és a megjelenített név', () => {
    expect(channelNames(data({ id: 'u1', username: 'anna', displayName: 'Kiss Anna' } as ChannelData['creator']), 'u1')).toEqual({
      username: 'anna',
      displayName: 'Kiss Anna',
    });
  });

  it('üres megjelenített névnél a handle a név (nem a „Csatorna" nav-címke)', () => {
    expect(channelNames(data({ id: 'u1', username: 'anna', displayName: '' } as ChannelData['creator']), 'u1').displayName).toBe('anna');
  });

  it('creator nélkül (vagy betöltés előtt) az azonosító első 8 karaktere', () => {
    expect(channelNames(data(null), 'abcdefghijkl')).toEqual({ username: 'abcdefgh', displayName: 'abcdefgh' });
    expect(channelNames(null, 'abcdefghijkl')).toEqual({ username: 'abcdefgh', displayName: 'abcdefgh' });
  });

  it('azonosító nélkül üres', () => {
    expect(channelNames(null, undefined)).toEqual({ username: '', displayName: '' });
  });
});

const { isDuckTrigger } = require('./render');

// A17: a duck kulcsa a SÁV, ahogy a Keverő mutatja — nem a klip forrás-címkéje
describe('isDuckTrigger', () => {
  it('a voiceover sávra húzott importált beszéd duckol', () => {
    expect(isDuckTrigger({ source: 'imported' }, 'voiceover')).toBe(true);
  });
  it('a zene-sávra húzott felvétel nem kulcs', () => {
    expect(isDuckTrigger({ source: 'voiceover' }, 'music')).toBe(false);
  });
  it('a duckTrigger sáv felülírja az alapot', () => {
    expect(isDuckTrigger({ source: 'voiceover' }, 'voiceover', 'sfx')).toBe(false);
    expect(isDuckTrigger({ source: 'imported' }, 'sfx', 'sfx')).toBe(true);
  });
  it('a régi közös audio sávon a forrás dönt', () => {
    expect(isDuckTrigger({ source: 'voiceover' }, 'audio')).toBe(true);
    expect(isDuckTrigger({ source: 'imported' }, 'audio')).toBe(false);
  });
});

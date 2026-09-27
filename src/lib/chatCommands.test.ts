import { parseChatCommand } from '@/lib/chatCommands';

describe('chatCommands — a MASTER §20 példái (magyar)', () => {
  it('„küldd el Annának a tegnapi projektet" → send, recipient anna, when yesterday', () => {
    const c = parseChatCommand('küldd el Annának a tegnapi projektet');
    expect(c.type).toBe('send');
    expect(c.recipient).toBe('anna');
    expect(c.when).toBe('yesterday');
  });

  it('„nyisd meg a projektet" → open', () => {
    expect(parseChatCommand('nyisd meg a projektet').type).toBe('open');
  });

  it('„készíts belőle egy 30 mp-es verziót" → version, 30 mp', () => {
    const c = parseChatCommand('készíts belőle egy 30 mp-es verziót');
    expect(c.type).toBe('version');
    expect(c.seconds).toBe(30);
  });

  it('„exportáld" → export', () => {
    expect(parseChatCommand('exportáld').type).toBe('export');
  });

  it('„oszd meg a producerrel" → share, recipient producer', () => {
    const c = parseChatCommand('oszd meg a producerrel');
    expect(c.type).toBe('share');
    expect(c.recipient).toBe('producer');
  });

  it('„ütemezd YouTube-ra holnap" → schedule, platform youtube, when tomorrow', () => {
    const c = parseChatCommand('ütemezd youtube-ra holnap');
    expect(c.type).toBe('schedule');
    expect(c.platform).toBe('youtube');
    expect(c.when).toBe('tomorrow');
  });
});

describe('chatCommands — angol + keresés + ismeretlen', () => {
  it('„send it to Anna" → send, recipient anna', () => {
    const c = parseChatCommand('send it to Anna');
    expect(c.type).toBe('send');
    expect(c.recipient).toBe('anna');
  });

  it('„make a 15 second version" → version 15', () => {
    const c = parseChatCommand('make a 15 second version');
    expect(c.type).toBe('version');
    expect(c.seconds).toBe(15);
  });

  it('„keresd a neon logót" → search, query „a neon logót"', () => {
    const c = parseChatCommand('keresd a neon logót');
    expect(c.type).toBe('search');
    expect(c.query).toBe('a neon logót');
  });

  it('ismeretlen üzenet → unknown', () => {
    expect(parseChatCommand('szia, mizu?').type).toBe('unknown');
  });

  it('a raw mindig megmarad', () => {
    expect(parseChatCommand('  exportáld  ').raw).toBe('exportáld');
  });
});

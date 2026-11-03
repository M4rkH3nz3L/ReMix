const { shouldNotifyOwner } = require('./renderNotify');

describe('shouldNotifyOwner', () => {
  it('a felhasználó exportjáról értesít', () => {
    expect(shouldNotifyOwner({ userId: 'u1', settings: { audioFormat: 'mp3' } })).toBe(true);
  });
  it('a belső renderről nem', () => {
    expect(shouldNotifyOwner({ userId: 'u1', settings: { audioFormat: 'wav', notify: false } })).toBe(false);
  });
  it('gazda nélkül nincs kinek', () => {
    expect(shouldNotifyOwner({ settings: {} })).toBe(false);
  });
});

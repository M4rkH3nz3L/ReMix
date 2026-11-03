const { createSlotLimiter } = require('./slotLimiter');

describe('createSlotLimiter', () => {
  it('legfeljebb max menet fut egyszerre, felszabadítás után újra lehet', () => {
    const lim = createSlotLimiter(2);
    const a = lim.tryAcquire('u1');
    const b = lim.tryAcquire('u2');
    expect(lim.tryAcquire('u3')).toBeNull();
    a();
    expect(lim.tryAcquire('u3')).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('egy felhasználó egyszerre egy menetet indíthat', () => {
    const lim = createSlotLimiter(5);
    const a = lim.tryAcquire('u1');
    expect(lim.tryAcquire('u1')).toBeNull();
    a();
    expect(lim.tryAcquire('u1')).not.toBeNull();
  });

  it('a kétszeri felszabadítás nem ad plusz helyet', () => {
    const lim = createSlotLimiter(1);
    const a = lim.tryAcquire('u1');
    a();
    a();
    expect(lim.inUse).toBe(0);
    lim.tryAcquire('u2');
    expect(lim.tryAcquire('u3')).toBeNull();
  });
});

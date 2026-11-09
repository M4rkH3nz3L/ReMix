/** ✅ a közös szerkesztés üzenete visszaigazolásig újra megy (elveszett szerkesztés ellen) */
jest.mock('@/lib/supabase', () => ({ supabase: null }));
import { sendWithRetry } from '@/lib/collabLive';

const noWait = () => Promise.resolve();

describe('sendWithRetry', () => {
  it('két visszaigazolatlan („timed out”) küldés után a harmadik kimegy', async () => {
    const results = ['timed out', 'error', 'ok'];
    const send = jest.fn(async () => results.shift() ?? 'ok');
    expect(await sendWithRetry(send, 5, noWait)).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });
  it('ha egyszer sem igazolja vissza: hamis, pontosan `attempts` próbálkozás', async () => {
    const send = jest.fn(async () => 'timed out');
    expect(await sendWithRetry(send, 4, noWait)).toBe(false);
    expect(send).toHaveBeenCalledTimes(4);
  });
  it('a dobott hiba sem állítja meg (újrapróbálja)', async () => {
    let n = 0;
    const send = jest.fn(async () => {
      if (n++ === 0) throw new Error('hálózat');
      return 'ok';
    });
    expect(await sendWithRetry(send, 3, noWait)).toBe(true);
  });
});

/**
 * 🛡️ Regresszió: gyors stop → újranyitás ugyanarra a topicra.
 *
 * A valódi realtime-kliens `channel(topic)` a MÁR LÉTEZŐ csatornát adja vissza, a
 * `removeChannel` aszinkron, és feliratkozás után az `.on('presence')` kivételt dob.
 * A kamu kliens pontosan ezt utánozza (realtime-js 2.116 viselkedése).
 */

interface FakeChannel {
  topic: string;
  subscribed: boolean;
  on: jest.Mock;
  subscribe: jest.Mock;
  track: jest.Mock;
  send: jest.Mock;
  presenceState: () => Record<string, unknown>;
}

const channels: FakeChannel[] = [];
let resolveRemove: (() => void) | null = null;

function makeChannel(topic: string): FakeChannel {
  const ch: FakeChannel = {
    topic,
    subscribed: false,
    on: jest.fn(() => {
      if (ch.subscribed) {
        throw new Error(`cannot add presence callbacks for ${topic} after subscribe()`);
      }
      return ch;
    }),
    subscribe: jest.fn(() => {
      ch.subscribed = true;
      return ch;
    }),
    track: jest.fn(() => Promise.resolve('ok')),
    send: jest.fn(() => Promise.resolve('ok')),
    presenceState: () => ({}),
  };
  return ch;
}

const fakeClient = {
  getChannels: () => channels,
  channel: (topic: string) => {
    const t = `realtime:${topic}`;
    const exists = channels.find((c) => c.topic === t);
    if (exists) {
      return exists;
    }
    const ch = makeChannel(t);
    channels.push(ch);
    return ch;
  },
  removeChannel: (ch: FakeChannel) =>
    new Promise<string>((resolve) => {
      resolveRemove = () => {
        const i = channels.indexOf(ch);
        if (i >= 0) {
          channels.splice(i, 1);
        }
        resolve('ok');
      };
    }),
};

jest.mock('@/lib/supabase', () => ({ supabase: fakeClient }));

// eslint-disable-next-line import/first
import { openLiveChannel } from '@/lib/collabLive';

const self = { id: 'u1', name: 'Anna', avatar: null };
const handlers = { onPresence: jest.fn(), onCommands: jest.fn() };
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  channels.length = 0;
  resolveRemove = null;
});

describe('openLiveChannel — gyors újranyitás ugyanarra a topicra', () => {
  it('a még lebontás alatt álló csatorna mellett sem dob, és a lebontás után újat nyit', async () => {
    const first = openLiveChannel('collab-live:p1', self, handlers);
    expect(channels).toHaveLength(1);
    const old = channels[0];

    first.stop(); // removeChannel függőben (aszinkron)
    expect(() => openLiveChannel('collab-live:p1', self, handlers)).not.toThrow();

    resolveRemove?.();
    await flush();
    await flush();
    expect(channels).toHaveLength(1);
    expect(channels[0]).not.toBe(old);
    expect(channels[0].subscribed).toBe(true);
  });

  it('ha közben leállítják, a lebontás után NEM nyit újat (nincs szivárgó csatorna)', async () => {
    openLiveChannel('collab-live:p2', self, handlers).stop();
    const second = openLiveChannel('collab-live:p2', self, handlers);
    second.stop();
    resolveRemove?.();
    await flush();
    await flush();
    expect(channels).toHaveLength(0);
  });
});

// A `render` kliens-oldali belső moduljai (REFACTOR): a barrelen át nem elérhető segédek
// (render-cache, időkorlátos fetch, poll-ütem) jelenlegi viselkedése rögzítve.
import { File } from 'expo-file-system';

import { cachedRenderFile, storeRenderCache } from './cache';
import { MAX_POLLS, POLL_MS } from './cloudJob';
import { fetchWithTimeout } from './transport';

const mockFs = { exists: new Set<string>(), failCopy: false, log: [] as string[], list: [] as string[] };
jest.mock('expo-file-system', () => {
  const uriOf = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts);
    }
    get exists() {
      return mockFs.exists.has(this.uri);
    }
    delete() {
      mockFs.log.push(`delete ${this.uri}`);
      mockFs.exists.delete(this.uri);
    }
    copy(dest: File) {
      mockFs.log.push(`copy ${this.uri} → ${dest.uri}`);
      if (mockFs.failCopy) throw new Error('copy failed');
      mockFs.exists.add(dest.uri);
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = uriOf(parts);
    }
    get exists() {
      return mockFs.exists.has(this.uri);
    }
    create() {
      mockFs.log.push(`mkdir ${this.uri}`);
      mockFs.exists.add(this.uri);
    }
    list() {
      return mockFs.list.map((n) => new File(this, n));
    }
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///cache' } } };
});
const mockCaught: string[] = [];
jest.mock('@/lib/logCaught', () => ({ logCaught: (where: string) => mockCaught.push(where) }));

beforeEach(() => {
  mockFs.exists.clear();
  mockFs.failCopy = false;
  mockFs.log.length = 0;
  mockFs.list = [];
  mockCaught.length = 0;
});

describe('renderPipelineClient/cache', () => {
  it('cachedRenderFile: a kulcs fájlja a rendercache alatt, ha létezik; különben null', () => {
    expect(cachedRenderFile('k1')).toBeNull();
    mockFs.exists.add('file:///cache/rendercache/k1.mp4');
    expect(cachedRenderFile('k1')?.uri).toBe('file:///cache/rendercache/k1.mp4');
  });

  it('storeRenderCache: új mappa → létrehozza, a kész fájlt bemásolja és a másolatot adja', () => {
    const out = storeRenderCache('k2', new File('file:///cache/out.mp4'));
    expect(out.uri).toBe('file:///cache/rendercache/k2.mp4');
    expect(mockFs.log).toEqual(['mkdir file:///cache/rendercache', 'copy file:///cache/out.mp4 → file:///cache/rendercache/k2.mp4']);
  });

  it('storeRenderCache: meglévő mappában csak a legutóbbit tartja (a régieket törli)', () => {
    mockFs.exists.add('file:///cache/rendercache');
    mockFs.list = ['old.mp4'];
    storeRenderCache('k3', new File('file:///cache/out.mp4'));
    expect(mockFs.log[0]).toBe('delete file:///cache/rendercache/old.mp4');
  });

  it('storeRenderCache: másolási hibánál az eredeti fájl jön vissza, az eredeti napló-címkével', () => {
    mockFs.failCopy = true;
    const src = new File('file:///cache/out.mp4');
    expect(storeRenderCache('k4', src)).toBe(src);
    expect(mockCaught).toEqual(['lib/render.ts:storeRenderCache']);
  });
});

describe('renderPipelineClient/cloudJob + transport', () => {
  it('a poll 2 mp-enként fut, legfeljebb 300-szor (~10 perc)', () => {
    expect(POLL_MS).toBe(2000);
    expect(MAX_POLLS).toBe(300);
  });

  it('fetchWithTimeout: a saját jelét adja a fetch-nek, a kért init megmarad, az időzítőt törli', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true } as Response;
    }) as unknown as typeof fetch;
    jest.useFakeTimers();
    try {
      const res = await fetchWithTimeout('http://w/health', 3000, { headers: { a: 'b' } });
      expect(res.ok).toBe(true);
      expect(calls[0].url).toBe('http://w/health');
      expect(calls[0].init.headers).toEqual({ a: 'b' });
      expect(calls[0].init.signal?.aborted).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      globalThis.fetch = realFetch;
    }
  });
});

import { DEGRADED_KEYS, degradedMessage, knownDegraded } from '@/lib/renderNotices';

/* eslint-disable @typescript-eslint/no-require-imports -- a kliens-tsconfig-ban nincs Node-típus: a Node-beépített modulok require-rel töltődnek */
const fs = require('fs');
const path = require('path');
declare const __dirname: string;

describe('🛑 a szerveres render visszaesései a felhasználónak (MO-B2)', () => {
  it('csak az ismert kulcsok, sorrendben; rossz bemenet = üres', () => {
    expect(knownDegraded(['mask', 'ismeretlen', 'textMotion'])).toEqual(['mask', 'textMotion']);
    expect(knownDegraded(undefined)).toEqual([]);
    expect(knownDegraded('textMotion')).toEqual([]);
  });

  it('üres listára nincs üzenet; különben cím + felsorolás', () => {
    expect(degradedMessage([])).toBeNull();
    const msg = degradedMessage(['textMotion', 'particles']);
    expect(msg?.title).toBeTruthy();
    expect(msg?.body.split('\n').filter((l) => l.startsWith('• '))).toHaveLength(2);
  });

  it('a kliens kulcsai = a szerver noteDegraded-kulcsai (nincs drift)', () => {
    // a render a server/render.js vezénylőből + a server/render/ moduljaiból áll
    const renderDir = path.join(__dirname, '../../server/render');
    const files = [
      path.join(__dirname, '../../server/render.js'),
      ...(fs.readdirSync(renderDir) as string[]).filter((f) => f.endsWith('.js')).map((f) => path.join(renderDir, f)),
    ];
    const src = files.map((f) => fs.readFileSync(f, 'utf8') as string).join('\n');
    const server = [...new Set([...src.matchAll(/noteDegraded\(report, '(\w+)'\)/g)].map((m) => m[1]))].sort();
    expect(server).toEqual([...DEGRADED_KEYS].sort());
  });

  it('minden kulcsnak van szövege mindhárom nyelven', () => {
    for (const lang of ['hu', 'en', 'de']) {
      const d = JSON.parse(fs.readFileSync(path.join(__dirname, `../i18n/locales/${lang}.json`), 'utf8'));
      for (const k of [...DEGRADED_KEYS, 'title', 'body', 'retry']) {
        expect([lang, k, typeof d.lib.render.degraded[k]]).toEqual([lang, k, 'string']);
      }
    }
  });
});

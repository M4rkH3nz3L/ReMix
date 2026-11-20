import { OFFLINE_SAMPLE_RATE, type OfflineMixPlan } from '@/lib/offlineMix';

import { frameRange, OFFLINE_MAX_SEC } from './prepare';
import { bytesPerSample, ensureRoom, wavData, wavHeader, withTargetFile } from './wavOutput';

// Az `offlineMixClient` belső moduljai (REFACTOR): a barrelen át nem elérhető segédek
// (tartomány, WAV-választó, lemez-ellenőrzés, célfájl-írás) jelenlegi viselkedése rögzítve.

const mockFree = { bytes: 10 ** 10 };
jest.mock('@/lib/diskSpaceClient', () => ({ freeDiskBytes: () => mockFree.bytes }));
const mockCaught: string[] = [];
jest.mock('@/lib/logCaught', () => ({ logCaught: (where: string) => mockCaught.push(where) }));

const plan = (duration: number): OfflineMixPlan => ({ duration, clips: [], unsupported: [] });

describe('mixClient/prepare — tartomány', () => {
  it('a felső határ 3 óra', () => {
    expect(OFFLINE_MAX_SEC).toBe(10800);
  });

  it('frameRange: tartomány nélkül a teljes projekt, különben a hosszra szorítva', () => {
    expect(frameRange(plan(2))).toEqual([0, 88200]);
    expect(frameRange(plan(2), { from: 0.5, to: 1 })).toEqual([22050, 44100]);
    expect(frameRange(plan(2), { from: -1, to: 99 })).toEqual([0, 88200]);
    // fordított tartomány: üres (a vége az elejére szorul)
    expect(frameRange(plan(2), { from: 1.5, to: 1 })).toEqual([66150, 66150]);
  });
});

describe('mixClient/wavOutput — WAV-választó', () => {
  it('a mélység szerinti fejléc és mintaméret', () => {
    expect(bytesPerSample(16)).toBe(2);
    expect(bytesPerSample(24)).toBe(3);
    expect(bytesPerSample(32)).toBe(4);
    const fmt = (bits: 16 | 24 | 32) => new DataView(wavHeader(bits, 10).buffer);
    expect(fmt(32).getUint16(20, true)).toBe(3);
    expect(fmt(24).getUint16(34, true)).toBe(24);
    expect(fmt(16).getUint16(22, true)).toBe(2);
    expect(fmt(16).getUint32(24, true)).toBe(OFFLINE_SAMPLE_RATE);
    expect(new DataView(wavHeader(16, 10, 1, 48000).buffer).getUint32(24, true)).toBe(48000);
  });

  it('a minták: 32 bit lebegőpontos, 24 bit 3 bájt, 16 bit 2 bájt (ditherrel)', () => {
    const ch = [Float32Array.from([0.5, -0.5])];
    expect(wavData(32, ch)).toHaveLength(8);
    expect(wavData(24, ch)).toHaveLength(6);
    expect(wavData(16, ch)).toHaveLength(4);
  });
});

describe('mixClient/wavOutput — lemez és célfájl', () => {
  beforeEach(() => {
    mockFree.bytes = 10 ** 10;
    mockCaught.length = 0;
  });

  it('ensureRoom: kevés hely → érthető hiba, elég hely → csendes', () => {
    expect(() => ensureRoom(1000)).not.toThrow();
    mockFree.bytes = 1000;
    expect(() => ensureRoom(1000)).toThrow(/noSpace/);
  });

  const target = (opts: { exists?: boolean; deleteThrows?: boolean } = {}) => {
    const calls: string[] = [];
    const file = {
      exists: !!opts.exists,
      delete: () => {
        calls.push('delete');
        if (opts.deleteThrows) throw new Error('nope');
      },
      create: () => calls.push('create'),
      open: () => ({ writeBytes: (b: Uint8Array) => calls.push(`write:${b.length}`), close: () => calls.push('close') }),
    };
    return { file: file as never, calls };
  };

  it('withTargetFile: a régi fájl törlődik, az írás után a fájl zárul', async () => {
    const t = target({ exists: true });
    await withTargetFile(t.file, 10, async (write) => write(new Uint8Array(3)));
    expect(t.calls).toEqual(['delete', 'create', 'write:3', 'close']);
  });

  it('withTargetFile: hibánál zárás + törlés, a betelt lemez érthető üzenet', async () => {
    const t = target();
    await expect(
      withTargetFile(t.file, 10, async () => {
        throw new Error('ENOSPC');
      })
    ).rejects.toThrow(/noSpace/);
    expect(t.calls).toEqual(['create', 'close', 'delete']);
    const other = target();
    await expect(
      withTargetFile(other.file, 10, async () => {
        throw new Error('io');
      })
    ).rejects.toThrow('io');
  });

  it('withTargetFile: a sikertelen takarítás naplózódik (régi ujjlenyomattal), az eredeti hiba megy tovább', async () => {
    const t = target({ deleteThrows: true });
    await expect(
      withTargetFile(t.file, 10, async () => {
        throw new Error('io');
      })
    ).rejects.toThrow('io');
    expect(mockCaught).toEqual(['lib/offlineMixClient.ts:cleanup']);
  });
});

import { simplifyCell } from '@/lib/model3dLook';
import {
  BACKGROUNDS,
  DARK_LIGHT,
  captureMetaOf,
  capturePrimaryKey,
  captureStuckHintKey,
  importReadErrorKey,
  measureLineCoords,
  meshFinishDisabled,
  nextInCycle,
  posterFileUri,
  processMeshOptionsJson,
  refreshedPosterUri,
  roomCounts,
} from '@/lib/model3dStudioOps';
import type { Model3DMeasurement, RoomSummary } from '@/types/model3d';

const bounds = { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } };
const q = { x: 0.1, y: 0.2, z: 0.3, w: 0.9 };

describe('model3dStudioOps — néző-ciklusok és küszöbök', () => {
  it('a háttér-ciklus sötét → világos → átlátszó → sötét; ismeretlen színből az elsőre lép', () => {
    expect(BACKGROUNDS).toEqual(['#111420', '#f2f2f5', null]);
    expect(nextInCycle(BACKGROUNDS, '#111420')).toBe('#f2f2f5');
    expect(nextInCycle(BACKGROUNDS, '#f2f2f5')).toBeNull();
    expect(nextInCycle(BACKGROUNDS, null)).toBe('#111420');
    expect(nextInCycle(BACKGROUNDS, '#123456')).toBe('#111420');
  });

  it('a „kevés a fény” küszöb 300 (alatta sötét)', () => {
    expect(DARK_LIGHT).toBe(300);
  });

  it('a hálós szken „Kész”-e: hálónál háromszög, pontfelhőnél pont kell', () => {
    expect(meshFinishDisabled('mesh', { triangles: 0 })).toBe(true);
    expect(meshFinishDisabled('mesh', { triangles: 1, points: 0 })).toBe(false);
    expect(meshFinishDisabled('points', { triangles: 50 })).toBe(true);
    expect(meshFinishDisabled('points', { triangles: 50, points: 0 })).toBe(true);
    expect(meshFinishDisabled('points', { triangles: 0, points: 3 })).toBe(false);
  });
});

describe('model3dStudioOps — rögzítési útmutatás', () => {
  it('inicializálásnál 5 mp után lassú indulás, 20 mp után elakadt; más állapotban nincs', () => {
    expect(captureStuckHintKey('initializing', 4999)).toBeNull();
    expect(captureStuckHintKey('initializing', 5000)).toBe('model3d.capture.hint_slowStart');
    expect(captureStuckHintKey('initializing', 19999)).toBe('model3d.capture.hint_slowStart');
    expect(captureStuckHintKey('initializing', 20000)).toBe('model3d.capture.hint_stuck');
    expect(captureStuckHintKey('ready', 60000)).toBeNull();
  });

  it('a fő gomb: kijelölés → indítás → befejezés; egyébként nincs (pörgő jelző)', () => {
    expect(capturePrimaryKey('ready')).toBe('model3d.capture.select');
    expect(capturePrimaryKey('detecting')).toBe('model3d.capture.start');
    expect(capturePrimaryKey('capturing')).toBe('model3d.capture.finish');
    for (const s of ['initializing', 'finishing', 'completed', 'failed', 'unknown']) {
      expect(capturePrimaryKey(s)).toBeNull();
    }
  });

  it('a rögzítés metaadata közepes minőséggel, kész állapotban, a mezők sorrendjében', () => {
    const m = captureMetaOf('room', 'iPad Pro', '2026-01-02T03:04:05.000Z');
    expect(m).toEqual({ mode: 'room', quality: 'medium', status: 'ready', device: 'iPad Pro', startedAt: '2026-01-02T03:04:05.000Z' });
    expect(Object.keys(m)).toEqual(['mode', 'quality', 'status', 'device', 'startedAt']);
  });
});

describe('model3dStudioOps — fájlnevek', () => {
  it('a poszter a mappa alatt, pontosan egy perjellel', () => {
    expect(posterFileUri('file:///doc/P', 'ast_1')).toBe('file:///doc/P/m3d_ast_1_poster.png');
    expect(posterFileUri('file:///doc/P/', 'ast_1')).toBe('file:///doc/P/m3d_ast_1_poster.png');
    expect(posterFileUri('', 'a')).toBe('/m3d_a_poster.png');
  });

  it('a pótolt poszter új (időbélyeges) fájlnevet kap', () => {
    expect(refreshedPosterUri('file:///doc/P', 'ast_1', 'abc')).toBe('file:///doc/P/m3d_ast_1_poster_abc.png');
    expect(refreshedPosterUri('file:///doc/P/', 'ast_1', (1700000000000).toString(36))).toBe('file:///doc/P/m3d_ast_1_poster_loyw3v28.png');
  });
});

describe('model3dStudioOps — mérés és szoba', () => {
  it('csak a legalább kétpontos távolság-mérés ad szakaszt (6 szám, az első két pontból)', () => {
    const ms = [
      { id: 'a', kind: 'distance', points: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }, { x: 9, y: 9, z: 9 }] },
      { id: 'b', kind: 'distance', points: [{ x: 1, y: 1, z: 1 }] },
      { id: 'c', kind: 'area', points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }] },
      { id: 'd', kind: 'distance', points: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }] },
    ] as unknown as Model3DMeasurement[];
    expect(measureLineCoords(ms)).toEqual([1, 2, 3, 4, 5, 6, -1, 0, 0, 0, 0, -1]);
    expect(measureLineCoords([])).toEqual([]);
  });

  it('a szoba-kártya ajtót, ablakot (a sima nyílás nélkül) és tárgyat számol', () => {
    const room = {
      floorArea: 1,
      walls: [],
      openings: [
        { id: '1', kind: 'door', width: 1, height: 2 },
        { id: '2', kind: 'window', width: 1, height: 1 },
        { id: '3', kind: 'window', width: 1, height: 1 },
        { id: '4', kind: 'opening', width: 1, height: 1 },
      ],
      objects: [{ id: 'o', category: 'bed', dimensions: { x: 1, y: 1, z: 1 } }],
      floorPolygon: [],
    } as RoomSummary;
    expect(roomCounts(room)).toEqual({ doors: 1, windows: 2, objects: 1 });
    expect(Object.keys(roomCounts(room))).toEqual(['doors', 'windows', 'objects']);
  });
});

describe('model3dStudioOps — import és feldolgozás', () => {
  it('az olvasási hiba kulcsa: fbxAscii → zipNoModel → glTF-külső → olvashatatlan', () => {
    expect(importReadErrorKey('failed: fbxAscii', 'fbx')).toBe('model3d.import.fbxAscii');
    expect(importReadErrorKey('zipNoModel fbxAscii', 'zip')).toBe('model3d.import.fbxAscii');
    expect(importReadErrorKey('zipNoModel', 'gltf')).toBe('model3d.import.zipNoModel');
    expect(importReadErrorKey('other', 'gltf')).toBe('model3d.import.gltfExternal');
    expect(importReadErrorKey('other', 'glb')).toBe('model3d.import.unreadable');
    expect(importReadErrorKey('', 'obj')).toBe('model3d.import.unreadable');
  });

  it('a processMesh opciói: mindig forgatás, a vágás 0-nál is, az egyszerűsítés cellával', () => {
    expect(processMeshOptionsJson(q, {}, bounds)).toBe('{"rotation":[0.1,0.2,0.3,0.9]}');
    expect(processMeshOptionsJson(q, { cutY: 0 }, bounds)).toBe('{"rotation":[0.1,0.2,0.3,0.9],"cutY":0}');
    expect(JSON.parse(processMeshOptionsJson(q, { cutY: 0.25, simplify: 'strong' }, bounds))).toEqual({
      rotation: [0.1, 0.2, 0.3, 0.9],
      cutY: 0.25,
      cell: simplifyCell(bounds, 'strong'),
    });
    expect(Object.keys(JSON.parse(processMeshOptionsJson(q, { simplify: 'light', cutY: 1 }, bounds)))).toEqual(['rotation', 'cutY', 'cell']);
  });
});

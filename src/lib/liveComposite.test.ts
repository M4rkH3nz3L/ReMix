import { addSource, createLiveDoc, toggleSourceVisible, type GenId } from '@/lib/liveDoc';
import {
  compositeLayers,
  parseScenePayload,
  encodeScenePayload,
  layerPercentBox,
  sceneHasVisible,
} from '@/lib/liveComposite';

function idGen(): GenId {
  let n = 0;
  return () => `id_${++n}`;
}

describe('liveComposite — encodeScenePayload', () => {
  it('az aktív jelenet forrásait kódolja (kompakt wire-formátum)', () => {
    const g = idGen();
    let doc = createLiveDoc('Adás', g); // Main + kamera
    doc = addSource(doc, doc.scenes[0].id, 'logo', g, { label: 'Logó' });
    const p = encodeScenePayload(doc);
    expect(p.sceneId).toBe(doc.scenes[0].id);
    expect(p.title).toBe('Adás');
    expect(p.layers).toHaveLength(2);
    const cam = p.layers.find((l) => l.kind === 'camera')!;
    expect(cam.v).toBe(true);
    expect(cam.t).toMatchObject({ x: 0, y: 0, w: 1, h: 1, z: 0 });
    const logo = p.layers.find((l) => l.kind === 'logo')!;
    expect(logo.t.z).toBe(1);
  });

  it('üres doc → üres payload', () => {
    const p = encodeScenePayload({ title: 'x', visibility: 'public', scenes: [], activeSceneId: '', destinations: [] });
    expect(p.sceneId).toBe('');
    expect(p.layers).toHaveLength(0);
  });
});

describe('liveComposite — compositeLayers', () => {
  it('csak a láthatókat adja, z-rend szerint (hátulról előre)', () => {
    const g = idGen();
    let doc = createLiveDoc('x', g); // kamera z=0
    doc = addSource(doc, doc.scenes[0].id, 'logo', g); // z=1
    doc = addSource(doc, doc.scenes[0].id, 'text', g); // z=2
    // a logót elrejtjük
    const logoId = doc.scenes[0].sources[1].id;
    doc = toggleSourceVisible(doc, doc.scenes[0].id, logoId);
    const layers = compositeLayers(encodeScenePayload(doc));
    expect(layers.map((l) => l.kind)).toEqual(['camera', 'text']); // logó kiesett, z-rendben
  });
});

describe('liveComposite — sceneHasVisible', () => {
  it('igaz, ha van látható adott fajtájú forrás', () => {
    const g = idGen();
    const doc = createLiveDoc('x', g);
    const p = encodeScenePayload(doc);
    expect(sceneHasVisible(p, 'camera')).toBe(true);
    expect(sceneHasVisible(p, 'screen')).toBe(false);
  });
});

describe('liveComposite — layerPercentBox', () => {
  it('0–1 transzformból %-dobozt ad', () => {
    const box = layerPercentBox({
      id: 'x',
      kind: 'logo',
      v: true,
      t: { x: 0.72, y: 0.04, w: 0.24, h: 0.12, z: 1 },
    });
    expect(box).toEqual({ left: '72%', top: '4%', width: '24%', height: '12%' });
  });
});

describe('parseScenePayload (PRO-LIVE L2)', () => {
  it('rossz bemenet → null; hibás rétegek kiszűrve, értékek határok közé szorítva', () => {
    expect(parseScenePayload(null)).toBeNull();
    expect(parseScenePayload({ layers: 'x' })).toBeNull();
    const p = parseScenePayload({
      sceneId: 's',
      layers: [
        { id: 'a', kind: 'camera', v: true, t: { x: 0, y: 0, w: 1, h: 1, z: 0 } },
        { id: 'b', kind: 'evil', v: true, t: {} },
        { id: 'c', kind: 'image', v: true, t: { x: 'NaN', y: 1e9, w: -5, h: 0.5, z: 0 }, uri: 'http://169.254.169.254/x' },
        { id: 'd', kind: 'logo', v: true, t: { x: 0, y: 0, w: 0.2, h: 0.2, z: 1 }, uri: 'https://cdn.example.com/l.png' },
        null,
      ],
    })!;
    expect(p.layers.map((l) => l.id)).toEqual(['a', 'c', 'd']);
    expect(p.layers[1].t).toEqual({ x: 0, y: 2, w: 0, h: 0.5, z: 0 });
    expect(p.layers[1].uri).toBeUndefined(); // belső / nem https cím eldobva
    expect(p.layers[2].uri).toBe('https://cdn.example.com/l.png');
  });

  it('legfeljebb 32 réteg (néző-DoS ellen)', () => {
    const layers = Array.from({ length: 100 }, (_, i) => ({ id: `l${i}`, kind: 'text', v: true, t: {} }));
    expect(parseScenePayload({ layers })!.layers).toHaveLength(32);
  });
});

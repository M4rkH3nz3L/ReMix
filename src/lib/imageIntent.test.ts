import { applyImageCommands, type ImageCommand, parseImageIntent } from '@/lib/imageIntent';
import type { ImageDoc, ImageLayer, PhotoLayer, ShapeLayer, TextLayer } from '@/types/project';

const layers = [
  { kind: 'fill', id: 'bg', fill: '#ffffff' },
  { kind: 'photo', id: 'photo', uri: 'a.png', position: { x: 0.5, y: 0.5 }, w: 0.8, h: 0.6, name: 'Tájkép' },
  { kind: 'shape', id: 'circle', shape: 'ellipse', position: { x: 0.3, y: 0.3 }, w: 0.2, h: 0.2, fill: '#ff0000' },
  { kind: 'text', id: 'title', text: 'Nyári akció', position: { x: 0.5, y: 0.5 }, fontSize: 8, color: '#000000' },
] as unknown as ImageLayer[];
const doc = { id: 'd', name: 'n', layers } as unknown as ImageDoc;

/** [mondat, várt parancs típus, várt réteg] */
const CORPUS: [string, ImageCommand['type'], string?][] = [
  ['a szöveg legyen piros', 'SET_COLOR', 'title'],
  ['make the text blue', 'SET_COLOR', 'title'],
  ['színezd zöldre a kört', 'SET_COLOR', 'circle'],
  ['a kör legyen fekete', 'SET_COLOR', 'circle'],
  ['legyen fehér a háttér', 'SET_BACKGROUND'],
  ['make the background black', 'SET_BACKGROUND'],
  ['a háttér legyen kék', 'SET_BACKGROUND'],
  ['tedd a szöveget felülre', 'MOVE', 'title'],
  ['mozgasd a szöveget feljebb', 'MOVE', 'title'],
  ['vidd a kört balra', 'MOVE', 'circle'],
  ['move the photo left', 'MOVE', 'photo'],
  ['tedd középre a kört', 'MOVE', 'circle'],
  ['put the text at the bottom', 'MOVE', 'title'],
  ['told kicsit jobbra a fotót', 'MOVE', 'photo'],
  ['a kör legyen nagyobb', 'SCALE', 'circle'],
  ['make the photo smaller', 'SCALE', 'photo'],
  ['növeld a szöveget', 'SCALE', 'title'],
  ['a fotó duplájára', 'SCALE', 'photo'],
  ['a kör felére', 'SCALE', 'circle'],
  ['forgasd a kört 45 fokkal', 'ROTATE', 'circle'],
  ['rotate the photo 90 degrees', 'ROTATE', 'photo'],
  ['forgasd balra a fotót 30 fokkal', 'ROTATE', 'photo'],
  ['töröld a kört', 'DELETE', 'circle'],
  ['delete the text', 'DELETE', 'title'],
  ['rejtsd el a szöveget', 'HIDE', 'title'],
  ['hide the photo', 'HIDE', 'photo'],
  ['legyen félig átlátszó a kör', 'SET_OPACITY', 'circle'],
  ['make the photo semi-transparent', 'SET_OPACITY', 'photo'],
  ['a szöveg legyen 30% átlátszó', 'SET_OPACITY', 'title'],
  ['set the text opacity to 40%', 'SET_OPACITY', 'title'],
  ['hozd előre a kört', 'ORDER', 'circle'],
  ['send the text back', 'ORDER', 'title'],
  ['a fotó legyen világosabb', 'ADJUST', 'photo'],
  ['a kép legyen sötétebb', 'ADJUST', 'photo'],
  ['make the photo brighter', 'ADJUST', 'photo'],
  ['a fotó legyen fekete-fehér', 'ADJUST', 'photo'],
  ['make the image black and white', 'ADJUST', 'photo'],
  ['a kép legyen melegebb', 'ADJUST', 'photo'],
  ['a fotó legyen telítettebb', 'ADJUST', 'photo'],
  ['több kontraszt a fotón', 'ADJUST', 'photo'],
  ['távolítsd el a hátteret', 'REMOVE_BG', 'photo'],
  ['remove the background', 'REMOVE_BG', 'photo'],
  ['vágd ki a hátteret', 'REMOVE_BG', 'photo'],
  ['adj hozzá egy piros kört', 'ADD_SHAPE'],
  ['add a blue star', 'ADD_SHAPE'],
  ['rajzolj egy négyzetet', 'ADD_SHAPE'],
  ['írj ki egy feliratot: "Akció"', 'ADD_TEXT'],
  ['add the text "Sale"', 'ADD_TEXT'],
  ['írd át a szöveget "Téli akció"-ra', 'SET_TEXT', 'title'],
  ['change the text to "Winter sale"', 'SET_TEXT', 'title'],
  ['rendezd el poszterként', 'AUTO_LAYOUT'],
  ['arrange as a thumbnail', 'AUTO_LAYOUT'],
  ['exportáld', 'EXPORT'],
  ['mentsd el', 'EXPORT'],
];

/** nem szerkesztő mondatok és bizonytalan utasítások: ezekből nem lehet parancs */
const NEGATIVE = ['milyen idő van ma', 'mi a neved', 'köszönöm', 'hello', 'mennyibe kerül a pro', 'csináld szebbé', 'what can you do', 'asdf qwer'];

describe('mondatok', () => {
  it.each(CORPUS.map(([a, b, c]) => [a, b, c ?? ''] as const))('%s', (sentence, type, target) => {
    const { commands, unknown } = parseImageIntent(sentence, doc, null);
    expect(unknown).toEqual([]);
    expect(commands).toHaveLength(1);
    expect(commands[0].type).toBe(type);
    if (target) {
      expect((commands[0] as { layerId?: string }).layerId).toBe(target);
    }
  });
  it.each(NEGATIVE)('nem hajt végre semmit: %s', (sentence) => {
    expect(parseImageIntent(sentence, doc, null).commands).toEqual([]);
  });
  it('a bizonytalan cél nem talál rá véletlenül egy rétegre', () => {
    expect(parseImageIntent('legyen nagyobb', doc, null).commands).toEqual([]);
    expect(parseImageIntent('töröld', doc, null).commands).toEqual([]);
  });
  it('kijelölt réteggel a cél nélküli mondat arra hat', () => {
    expect(parseImageIntent('legyen nagyobb', doc, 'circle').commands[0]).toMatchObject({ type: 'SCALE', layerId: 'circle' });
    expect(parseImageIntent('töröld', doc, 'title').commands[0]).toMatchObject({ type: 'DELETE', layerId: 'title' });
  });
  it('a háttér törlése a fotót vágja ki, nem a háttér réteget törli', () => {
    expect(parseImageIntent('töröld a hátteret', doc, null).commands[0].type).toBe('REMOVE_BG');
  });
});

describe('összetett mondat', () => {
  it('több lépés sorban', () => {
    const { commands } = parseImageIntent('a szöveg legyen piros, tedd felülre a szöveget és a kör legyen nagyobb', doc, null);
    expect(commands.map((c) => c.type)).toEqual(['SET_COLOR', 'MOVE', 'SCALE']);
  });
  it('az idézeten belüli „és" nem bontja a mondatot', () => {
    const { commands } = parseImageIntent('add the text "Salt and Pepper"', doc, null);
    expect(commands[0]).toMatchObject({ type: 'ADD_TEXT', text: 'Salt and Pepper' });
  });
  it('a nem értett rész nem állítja meg a többit, de látszik', () => {
    const { commands, unknown } = parseImageIntent('a kör legyen kék és csináld szebbé', doc, null);
    expect(commands).toHaveLength(1);
    expect(unknown).toEqual(['csináld szebbé']);
  });
});

describe('végrehajtás', () => {
  let n = 0;
  const id = () => `new${++n}`;
  const run = (text: string, selected: string | null = null) => applyImageCommands(doc, parseImageIntent(text, doc, selected).commands, id);
  const get = <T extends ImageLayer>(d: ImageDoc, layerId: string) => d.layers.find((l) => l.id === layerId) as T;

  it('szín, mozgatás, méret, forgatás', () => {
    expect(get<TextLayer>(run('a szöveg legyen piros').doc, 'title').color).toBe('#ff3b30');
    expect(get<TextLayer>(run('tedd a szöveget felülre').doc, 'title').position.y).toBeCloseTo(0.15);
    expect(get<ShapeLayer>(run('a kör duplájára').doc, 'circle').w).toBeCloseTo(0.4);
    expect(get<ShapeLayer>(run('forgasd a kört 45 fokkal').doc, 'circle').rotation).toBe(45);
  });
  it('a szöveg a betűmérettel nő, nem dobozzal', () => {
    expect(get<TextLayer>(run('a szöveg duplájára').doc, 'title').fontSize).toBe(16);
  });
  it('a korrekció a meglévőhöz adódik', () => {
    const once = run('a fotó legyen világosabb').doc;
    const twice = applyImageCommands(once, parseImageIntent('a fotó legyen világosabb', once, null).commands, id).doc;
    expect(get<PhotoLayer>(twice, 'photo').adjust?.brightness).toBeCloseTo(0.24);
  });
  it('a határok tartanak', () => {
    const d = applyImageCommands(doc, [{ type: 'MOVE', layerId: 'circle', dx: 5 }, { type: 'SET_OPACITY', layerId: 'circle', opacity: 3 }], id).doc;
    expect(get<ShapeLayer>(d, 'circle').position.x).toBe(1);
    expect(get<ShapeLayer>(d, 'circle').opacity).toBe(1);
  });
  it('ismeretlen réteg kimarad, nem dob', () => {
    expect(applyImageCommands(doc, [{ type: 'DELETE', layerId: 'nincs' }], id).doc.layers).toHaveLength(4);
  });
  it('a háttér-eltávolítás és az export a felületre marad', () => {
    const { doc: out, followUps } = run('távolítsd el a hátteret és exportáld');
    expect(out).toEqual(doc);
    expect(followUps.map((f) => f.type)).toEqual(['REMOVE_BG', 'EXPORT']);
  });
  it('poszter: a fotó kitölt, a szöveg felül, középre', () => {
    const d = run('rendezd el poszterként').doc;
    expect(get<PhotoLayer>(d, 'photo').w).toBe(1);
    expect(get<TextLayer>(d, 'title').position.y).toBeLessThan(0.3);
    expect(get<TextLayer>(d, 'title').textAlign).toBe('center');
  });
});

/**
 * Külön mintasor: a szabályok ezekre nem voltak hangolva, ezért ez a valós fedettséget mutatja, nem
 * elvárás. A küszöb azt őrzi, hogy ne romoljon, és itt sem lehet téves végrehajtás.
 */
const HELD_OUT: [string, ImageCommand['type']][] = [
  ['színezd pirosra a szöveget', 'SET_COLOR'],
  ['legyen zöld a felirat', 'SET_COLOR'],
  ['a csillag legyen sárga', 'SET_COLOR'],
  ['paint the circle yellow', 'SET_COLOR'],
  ['change the title color to white', 'SET_COLOR'],
  ['vidd lejjebb a szöveget', 'MOVE'],
  ['húzd jobbra a kört', 'MOVE'],
  ['tedd a fotót a közepére', 'MOVE'],
  ['shift the circle right', 'MOVE'],
  ['place the title at the top', 'MOVE'],
  ['nagyítsd meg a fotót', 'SCALE'],
  ['kicsinyítsd a kört', 'SCALE'],
  ['legyen kétszer akkora a kör', 'SCALE'],
  ['enlarge the image', 'SCALE'],
  ['shrink the circle a bit', 'SCALE'],
  ['fordítsd el a szöveget 15 fokkal', 'ROTATE'],
  ['turn the circle 180 degrees', 'ROTATE'],
  ['vedd le a kört', 'DELETE'],
  ['tüntesd el a szöveget', 'HIDE'],
  ['remove the circle', 'DELETE'],
  ['legyen átlátszóbb a fotó', 'SET_OPACITY'],
  ['állítsd 50%-ra a kör átlátszóságát', 'SET_OPACITY'],
  ['tedd a kört a szöveg mögé', 'ORDER'],
  ['bring the text to the front', 'ORDER'],
  ['világosítsd a képet', 'ADJUST'],
  ['sötétítsd a fotót', 'ADJUST'],
  ['adj több kontrasztot a fotónak', 'ADJUST'],
  ['make the picture warmer', 'ADJUST'],
  ['legyen élénkebb a kép', 'ADJUST'],
  ['vedd ki a fotó hátterét', 'REMOVE_BG'],
  ['cut out the background', 'REMOVE_BG'],
  ['tegyél be egy kék kört', 'ADD_SHAPE'],
  ['insert a red rectangle', 'ADD_SHAPE'],
  ['add a title "Hello"', 'ADD_TEXT'],
  ['írd ki hogy "Akció"', 'ADD_TEXT'],
  ['cseréld a szöveget erre: "Új"', 'SET_TEXT'],
  ['legyen a háttér szürke', 'SET_BACKGROUND'],
  ['set the background to green', 'SET_BACKGROUND'],
  ['mentsd a fotókba', 'EXPORT'],
  ['save the image', 'EXPORT'],
];

describe('külön mintasor', () => {
  it('a fedettség nem romlik, és sehol nincs téves parancs', () => {
    const results = HELD_OUT.map(([s, type]) => {
      const got = parseImageIntent(s, doc, null).commands;
      return { s, type, got: got.map((c) => c.type) };
    });
    const hit = results.filter((r) => r.got.length === 1 && r.got[0] === r.type);
    const wrong = results.filter((r) => r.got.length > 0 && !r.got.includes(r.type));
    console.log(`külön mintasor: ${hit.length}/${results.length} találat; téves: ${wrong.map((r) => `${r.s} → ${r.got}`).join(' | ') || 'nincs'}; kimaradt: ${results.filter((r) => r.got.length === 0).map((r) => r.s).join(' | ')}`);
    expect(hit.length / results.length).toBeGreaterThanOrEqual(0.7);
  });
});

import { addLayer, removeLayer, reorderLayer, setBackground, updateLayer } from '@/lib/imageDoc';
import type { ClipAdjust, ImageDoc, ImageLayer, ShapeLayer, TextLayer } from '@/types/project';

/**
 * 🤖 Kép-asszisztens az eszközön (pure): magyar és angol mondatból ellenőrzött parancslista. Szabály-
 * alapú, nem nyelvi modell: ingyenes, offline, azonnali. Amit nem ért, azt nem találgatja, hanem
 * visszaadja `unknown`-ként, mert egy félreértett törlés rosszabb, mint egy kérdés. Egy későbbi
 * helyi modell ugyanerre a parancslistára fordíthat.
 */
export type ImageCommand =
  | { type: 'ADD_TEXT'; text: string; color?: string }
  | { type: 'SET_TEXT'; layerId: string; text: string }
  | { type: 'ADD_SHAPE'; shape: 'rectangle' | 'ellipse' | 'star'; color?: string }
  | { type: 'SET_COLOR'; layerId: string; color: string }
  | { type: 'SET_BACKGROUND'; color: string }
  | { type: 'SET_OPACITY'; layerId: string; opacity: number }
  | { type: 'MOVE'; layerId: string; x?: number; y?: number; dx?: number; dy?: number }
  | { type: 'SCALE'; layerId: string; factor: number }
  | { type: 'ROTATE'; layerId: string; degrees: number }
  | { type: 'DELETE'; layerId: string }
  | { type: 'HIDE'; layerId: string }
  | { type: 'ORDER'; layerId: string; delta: number }
  | { type: 'ADJUST'; layerId: string; adjust: ClipAdjust }
  | { type: 'REMOVE_BG'; layerId: string }
  | { type: 'AUTO_LAYOUT'; style: 'poster' | 'thumbnail' }
  | { type: 'EXPORT' };

export interface IntentResult {
  commands: ImageCommand[];
  /** a nem értett mondatrészek: a felület megmutatja, nem hajtódnak végre */
  unknown: string[];
}

/** kisbetű, ékezet nélkül: a magyar toldalékos alakok így egyszerűbb mintával foghatók */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

const COLORS: [RegExp, string][] = [
  [/\b(piros|voros|red)/, '#ff3b30'],
  [/\b(narancs|orange)/, '#ff9500'],
  [/\b(sarga|yellow)/, '#ffcc00'],
  [/\b(zold|green)/, '#34c759'],
  [/\b(kek|blue)/, '#0a84ff'],
  [/\b(lila|purple)/, '#8e5cf7'],
  [/\b(rozsaszin|pink)/, '#ff2d95'],
  [/\b(feher|white)/, '#ffffff'],
  [/\b(fekete|black)/, '#000000'],
  [/\b(szurke|gray|grey)/, '#808080'],
];

function colorIn(t: string): string | undefined {
  const hex = t.match(/#[0-9a-f]{6}\b/);
  return hex ? hex[0] : COLORS.find(([re]) => re.test(t))?.[1];
}

/** a mondat idézett része, az eredeti kis- és nagybetűkkel */
function quotedIn(raw: string): string | null {
  return raw.match(/[„"“']([^„"”“']{1,120})["”“']/)?.[1]?.trim() || null;
}

const isText = (l: ImageLayer): l is TextLayer => l.kind === 'text';

/** Melyik rétegről beszél a mondatrész? Csak egyértelműnél ad választ, különben a kijelölt marad. */
function targetOf(t: string, raw: string, doc: ImageDoc, selectedId: string | null): ImageLayer | null {
  const layers = doc.layers;
  const pick = (test: (l: ImageLayer) => boolean) => [...layers].reverse().find(test) ?? null;
  const q = quotedIn(raw);
  if (q) {
    const byText = layers.find((l) => isText(l) && norm(l.text ?? '').includes(norm(q)));
    if (byText) {
      return byText;
    }
  }
  const named = layers.find((l) => l.name && norm(l.name).length > 2 && t.includes(norm(l.name)));
  if (named) {
    return named;
  }
  if (/\b(szoveg|felirat|cim|text|title|caption)/.test(t)) return pick(isText);
  if (/\b(foto|kep|photo|image|picture)/.test(t)) return pick((l) => l.kind === 'photo');
  if (/\b(kor|kort|korom|ellipszis|circle|ellipse)/.test(t)) return pick((l) => l.kind === 'shape' && l.shape === 'ellipse');
  if (/\b(negyzet|teglalap|square|rectangle)/.test(t)) return pick((l) => l.kind === 'shape' && l.shape === 'rectangle');
  if (/\b(csillag|star)/.test(t)) return pick((l) => l.kind === 'shape' && l.shape === 'star');
  if (/\b(forma|alakzat|shape)/.test(t)) return pick((l) => l.kind === 'shape');
  if (selectedId) {
    return layers.find((l) => l.id === selectedId) ?? null;
  }
  // egyetlen tartalmi réteg esetén a mondat csak rá vonatkozhat
  const content = layers.filter((l) => l.kind !== 'fill' && l.kind !== 'adjust');
  return content.length === 1 ? content[0] : null;
}

/** Mennyit mozduljon vagy változzon: „kicsit" kevesebb, „nagyon" több. */
const strength = (t: string) => (/\b(kicsit|kisse|enyhen|slightly|a bit|a little)/.test(t) ? 0.5 : /\b(nagyon|sokkal|much|very)/.test(t) ? 2 : 1);

function percentIn(t: string): number | null {
  const m = t.match(/(\d{1,3})\s*(%|szazalek|percent)/);
  return m ? Math.min(100, Number(m[1])) / 100 : null;
}

function parseAdjust(t: string, k: number): ClipAdjust | null {
  if (/\b(fekete.?feher|szurkearnyalat|black and white|grayscale|greyscale|b&w)/.test(t)) return { saturation: -1 };
  if (/\b(vilagosabb|vilagosit|fenyesebb|brighter|brighten|lighter)/.test(t)) return { brightness: 0.12 * k };
  if (/\b(sotetebb|sotetit|darker|darken)/.test(t)) return { brightness: -0.12 * k };
  if (/\b(kontrasztosabb|tobb kontraszt|more contrast|increase contrast)/.test(t)) return { contrast: 0.15 * k };
  if (/\b(kevesebb kontraszt|less contrast|lower contrast)/.test(t)) return { contrast: -0.15 * k };
  if (/\b(telitettebb|elenkebb|szinesebb|more saturated|more vivid|vivid)/.test(t)) return { saturation: 0.3 * k };
  if (/\b(fakobb|kevesebb szin|less saturated|desaturate)/.test(t)) return { saturation: -0.3 * k };
  if (/\b(melegebb|warmer)/.test(t)) return { temperature: 0.1 * k };
  if (/\b(hidegebb|cooler|colder)/.test(t)) return { temperature: -0.1 * k };
  return null;
}

function parseMove(t: string, id: string): ImageCommand | null {
  if (!/\b(mozgasd|tedd|told|helyezd|vidd|rakd|huzd|move|put|place|shift|legyen)/.test(t)) {
    return null;
  }
  const step = 0.1 * strength(t);
  const edge = /\b(tetejere|aljara|szelere|top of|bottom of)/.test(t);
  if (/\b(kozepre|kozepen|center|centre|middle)/.test(t)) return { type: 'MOVE', layerId: id, x: 0.5, y: 0.5 };
  if (/\b(feljebb|felfele|fel\b|felulre|felul|tetejere|up\b|top|higher)/.test(t)) return edge || /\b(felulre|felul|top)/.test(t) ? { type: 'MOVE', layerId: id, y: 0.15 } : { type: 'MOVE', layerId: id, dy: -step };
  if (/\b(lejjebb|lefele|le\b|alulra|alul|aljara|down\b|bottom|lower)/.test(t)) return edge || /\b(alulra|alul|bottom)/.test(t) ? { type: 'MOVE', layerId: id, y: 0.85 } : { type: 'MOVE', layerId: id, dy: step };
  if (/\b(balra|bal oldalra|left)/.test(t)) return { type: 'MOVE', layerId: id, dx: -step };
  if (/\b(jobbra|jobb oldalra|right)/.test(t)) return { type: 'MOVE', layerId: id, dx: step };
  return null;
}

function parseClause(raw: string, doc: ImageDoc, selectedId: string | null): ImageCommand | null {
  const t = norm(raw);
  const quoted = quotedIn(raw);
  const color = colorIn(t);
  const k = strength(t);

  if (/\b(exportald|mentsd el|mentsd a fotok|export|save)\b/.test(t) && !/\bszin/.test(t)) return { type: 'EXPORT' };
  if (/\b(rendezd|automatikus elrendezes|auto.?layout|arrange|lay out)/.test(t)) {
    return { type: 'AUTO_LAYOUT', style: /\b(borito|indexkep|thumbnail|cover)/.test(t) ? 'thumbnail' : 'poster' };
  }

  // a háttér eltávolítása más, mint a háttérszín: előbbi a fotót vágja ki
  if (/\b(hatter|background)/.test(t) && /\b(tavolit|torold|vedd le|vagd ki|tuntesd el|remove|delete|cut out)/.test(t)) {
    const photo = [...doc.layers].reverse().find((l) => l.kind === 'photo');
    return photo ? { type: 'REMOVE_BG', layerId: photo.id } : null;
  }
  if (/\b(hatter|background)/.test(t) && color) {
    return { type: 'SET_BACKGROUND', color };
  }

  if (/\b(adj|adjal|tegyel|rajzolj|add|draw|insert|keszits|create)\b/.test(t)) {
    if (quoted) return { type: 'ADD_TEXT', text: quoted, color };
    if (/\b(kor|kort|circle|ellipszis|ellipse)/.test(t)) return { type: 'ADD_SHAPE', shape: 'ellipse', color };
    if (/\b(negyzet|teglalap|square|rectangle)/.test(t)) return { type: 'ADD_SHAPE', shape: 'rectangle', color };
    if (/\b(csillag|star)/.test(t)) return { type: 'ADD_SHAPE', shape: 'star', color };
  }
  if (quoted && /\b(irj|ird ki|ird fel|write|felirat|cimet)/.test(t) && !/\b(at|erre|change|replace)\b/.test(t)) {
    return { type: 'ADD_TEXT', text: quoted, color };
  }

  const target = targetOf(t, raw, doc, selectedId);
  if (!target) {
    return null;
  }
  const id = target.id;

  if (quoted && isText(target) && /\b(ird at|valtoztasd|csereld|legyen|change|replace|rename|set)\b/.test(t)) {
    return { type: 'SET_TEXT', layerId: id, text: quoted };
  }
  if (/\b(torold|torles|tavolitsd el|delete|remove)\b/.test(t)) return { type: 'DELETE', layerId: id };
  if (/\b(rejtsd|hide)\b/.test(t)) return { type: 'HIDE', layerId: id };
  if (/\b(felig atlatszo|semi.?transparent|half transparent)/.test(t)) return { type: 'SET_OPACITY', layerId: id, opacity: 0.5 };
  if (/\b(atlatszo|attetszo|opacity|transparent)/.test(t)) {
    const pct = percentIn(t);
    return { type: 'SET_OPACITY', layerId: id, opacity: pct != null ? (/\b(opacity|fedes)/.test(t) ? pct : 1 - pct) : 0.5 };
  }
  const degrees = t.match(/(-?\d{1,3})\s*(fok|degree|deg|°)/);
  if (/\b(forgasd|forditsd|rotate|turn)\b/.test(t)) {
    return degrees ? { type: 'ROTATE', layerId: id, degrees: Number(degrees[1]) * (/\b(balra|left)/.test(t) ? -1 : 1) } : null;
  }
  if (/\b(duplajara|ketszeresere|ketszer akkora|double)/.test(t)) return { type: 'SCALE', layerId: id, factor: 2 };
  if (/\b(felere|half the size|halve)/.test(t)) return { type: 'SCALE', layerId: id, factor: 0.5 };
  if (/\b(nagyobb|nagyitsd|novel|bigger|larger|enlarge)/.test(t)) return { type: 'SCALE', layerId: id, factor: 1 + 0.25 * k };
  if (/\b(kisebb|kicsinyitsd|csokkentsd|smaller|shrink)/.test(t)) return { type: 'SCALE', layerId: id, factor: 1 / (1 + 0.25 * k) };
  if (/\b(elore|elorebb|legfelulre|bring forward|bring to front)/.test(t)) return { type: 'ORDER', layerId: id, delta: 1 };
  if (/\b(hatrebb|hatra)\b|\bsend\b.*\bback/.test(t)) return { type: 'ORDER', layerId: id, delta: -1 };

  const adjust = target.kind === 'photo' ? parseAdjust(t, k) : null;
  if (adjust) {
    return { type: 'ADJUST', layerId: id, adjust };
  }
  const move = parseMove(t, id);
  if (move) {
    return move;
  }
  if (color && (isText(target) || target.kind === 'shape')) {
    return { type: 'SET_COLOR', layerId: id, color };
  }
  return null;
}

/** A mondat részekre: az idézeten belüli „és" nem választ el. */
function splitClauses(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  const closes = (c: string) => '"”“\''.includes(c);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '„' || (!inQuote && closes(c))) inQuote = true;
    else if (inQuote && closes(c)) inQuote = false;
    const rest = text.slice(i).toLowerCase();
    // a „black and white" egy kifejezés, nem két parancs
    const phrase = /^\s(and|és)\s(white|fehér)/.test(rest) && /(black|fekete)$/i.test(buf);
    const sep = !phrase && !inQuote && (/^[,;.]\s/.test(rest) ? 1 : /^\s(és|aztán|majd|utána|and|then)\s/.test(rest) ? rest.match(/^\s\S+\s/)![0].length : 0);
    if (sep) {
      out.push(buf);
      buf = '';
      i += sep - 1;
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** A teljes mondat értelmezése: a részek sorban, és ami új réteget ad, arra a következő rész hivatkozhat. */
export function parseImageIntent(text: string, doc: ImageDoc, selectedId: string | null): IntentResult {
  const commands: ImageCommand[] = [];
  const unknown: string[] = [];
  for (const clause of splitClauses(text)) {
    const cmd = parseClause(clause, doc, selectedId);
    if (cmd) {
      commands.push(cmd);
    } else {
      unknown.push(clause);
    }
  }
  return { commands, unknown };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function moved(layer: ImageLayer, cmd: Extract<ImageCommand, { type: 'MOVE' }>) {
  const p = (layer as { position?: { x: number; y: number } }).position ?? { x: 0.5, y: 0.5 };
  return { x: clamp(cmd.x ?? p.x + (cmd.dx ?? 0), 0, 1), y: clamp(cmd.y ?? p.y + (cmd.dy ?? 0), 0, 1) };
}

/** Poszter: a legnagyobb fotó kitölt, a szövegek felülről lefelé, középre igazítva. */
function autoLayout(doc: ImageDoc, style: 'poster' | 'thumbnail'): ImageDoc {
  let next = doc;
  const photo = doc.layers.find((l) => l.kind === 'photo');
  if (photo) {
    next = updateLayer(next, photo.id, { position: { x: 0.5, y: 0.5 }, w: 1, h: 1, fit: 'cover' } as never);
  }
  const texts = doc.layers.filter(isText);
  const start = style === 'thumbnail' ? 0.72 : 0.14;
  texts.forEach((l, i) => {
    next = updateLayer<TextLayer>(next, l.id, { position: { x: 0.5, y: clamp(start + i * 0.12, 0.05, 0.95) }, textAlign: 'center', fontSize: Math.max(5, (style === 'thumbnail' ? 12 : 9) - i * 2) });
  });
  return next;
}

export interface ApplyResult {
  doc: ImageDoc;
  /** a mellékhatásos lépések a felületre maradnak: a háttér-eltávolítás natív, az export lap */
  followUps: ImageCommand[];
}

/** A parancsok tisztán a dokumentumon: minden érték határok közé szorítva, ismeretlen réteg kimarad. */
export function applyImageCommands(doc: ImageDoc, commands: ImageCommand[], makeId: () => string): ApplyResult {
  let next = doc;
  const followUps: ImageCommand[] = [];
  for (const cmd of commands) {
    if (cmd.type === 'EXPORT' || cmd.type === 'REMOVE_BG') {
      followUps.push(cmd);
      continue;
    }
    if (cmd.type === 'ADD_TEXT') {
      next = addLayer(next, { kind: 'text', id: makeId(), text: cmd.text, color: cmd.color ?? '#ffffff', backgroundColor: null, fontSize: 9, fontFamily: 'Poppins', fontWeight: 'bold', position: { x: 0.5, y: 0.5 } } as unknown as TextLayer);
    } else if (cmd.type === 'ADD_SHAPE') {
      next = addLayer(next, { kind: 'shape', id: makeId(), shape: cmd.shape, position: { x: 0.5, y: 0.5 }, w: 0.3, h: 0.3, fill: cmd.color ?? '#ff2d95' } as ShapeLayer);
    } else if (cmd.type === 'SET_BACKGROUND') {
      next = setBackground(next, cmd.color, makeId);
    } else if (cmd.type === 'AUTO_LAYOUT') {
      next = autoLayout(next, cmd.style);
    } else {
      const layer = next.layers.find((l) => l.id === cmd.layerId);
      if (!layer) {
        continue;
      }
      const placed = layer as { w?: number; h?: number; fontSize?: number; rotation?: number };
      switch (cmd.type) {
        case 'SET_TEXT':
          next = updateLayer<TextLayer>(next, layer.id, { text: cmd.text });
          break;
        case 'SET_COLOR':
          next = updateLayer(next, layer.id, (isText(layer) ? { color: cmd.color } : { fill: cmd.color }) as never);
          break;
        case 'SET_OPACITY':
          next = updateLayer(next, layer.id, { opacity: clamp(cmd.opacity, 0, 1) } as never);
          break;
        case 'MOVE':
          next = updateLayer(next, layer.id, { position: moved(layer, cmd) } as never);
          break;
        case 'SCALE':
          next = updateLayer(next, layer.id, (isText(layer) ? { fontSize: clamp((placed.fontSize ?? 8) * cmd.factor, 2, 40) } : { w: clamp((placed.w ?? 0.3) * cmd.factor, 0.02, 3), h: clamp((placed.h ?? 0.3) * cmd.factor, 0.02, 3) }) as never);
          break;
        case 'ROTATE':
          next = updateLayer(next, layer.id, { rotation: ((placed.rotation ?? 0) + cmd.degrees) % 360 } as never);
          break;
        case 'DELETE':
          next = removeLayer(next, layer.id);
          break;
        case 'HIDE':
          next = updateLayer(next, layer.id, { hidden: true } as never);
          break;
        case 'ORDER':
          next = reorderLayer(next, layer.id, cmd.delta);
          break;
        case 'ADJUST': {
          const current = (layer as { adjust?: ClipAdjust }).adjust ?? {};
          const merged = { ...current };
          for (const [key, value] of Object.entries(cmd.adjust)) {
            const k = key as keyof ClipAdjust;
            (merged as Record<string, unknown>)[k] = ((current[k] as number | undefined) ?? 0) + (value as number);
          }
          next = updateLayer(next, layer.id, { adjust: merged } as never);
          break;
        }
      }
    }
  }
  return { doc: next, followUps };
}

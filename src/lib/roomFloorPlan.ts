/**
 * 🏠→🖼️ Alaprajz a szoba-szkenből (3D-Studio.md §2.2 „alaprajz → Kép Stúdió") — pure.
 *
 * A `RoomSummary` felülnézeti padló-poligonjából egy SZERKESZTHETŐ kép-dokumentum készül:
 * fehér lap, a padló zárt útvonalként (kitöltés + fal-kontúr), a falak mentén a hosszuk,
 * felül a cím és az alapterület. A Kép Stúdióban minden réteg tovább szerkeszthető.
 */
import { createImageDoc } from '@/lib/imageDoc';
import { formatLength } from '@/lib/model3d';
import type { RoomSummary } from '@/types/model3d';
import type { ImageDoc, ShapeLayer, TextLayer } from '@/types/project';

const MARGIN = 0.14;

export function floorPlanImageDoc(
  summary: RoomSummary,
  title: string,
  subtitle: string,
  makeId: () => string
): ImageDoc | null {
  const poly = summary.floorPolygon;
  if (poly.length < 3) {
    return null;
  }
  const minX = Math.min(...poly.map((p) => p.x));
  const maxX = Math.max(...poly.map((p) => p.x));
  const minZ = Math.min(...poly.map((p) => p.z));
  const maxZ = Math.max(...poly.map((p) => p.z));
  const spanX = Math.max(maxX - minX, 0.01);
  const spanZ = Math.max(maxZ - minZ, 0.01);
  // a hosszabb oldal tölti ki a (margóval csökkentett) négyzetes lapot — torzítás nélkül
  const avail = 1 - 2 * MARGIN;
  const k = avail / Math.max(spanX, spanZ);
  const w = spanX * k;
  const h = spanZ * k;
  const left = 0.5 - w / 2;
  const top = 0.5 - h / 2 + 0.04;
  /** méter (x, z) → lap-koordináta 0–1 */
  const toPage = (p: { x: number; z: number }) => ({ x: left + (p.x - minX) * k, y: top + (p.z - minZ) * k });

  let doc = createImageDoc(title, '1:1', makeId, { width: 2048, height: 2048, background: '#ffffff' });

  const floor: ShapeLayer = {
    kind: 'shape',
    id: makeId(),
    name: title,
    shape: 'path',
    position: { x: left + w / 2, y: top + h / 2 },
    w,
    h,
    // a path pontjai a forma SAJÁT dobozában (0–1)
    points: poly.map((p) => ({ x: (p.x - minX) / spanX, y: (p.z - minZ) / spanZ })),
    closed: true,
    fill: '#eef2ff',
    borderColor: '#1f2937',
    borderWidth: 0.7,
    strokeWidth: 0.7,
    strokeJoin: 'miter',
  };
  doc = { ...doc, layers: [...doc.layers, floor] };

  const label = (text: string, at: { x: number; y: number }, fontSize: number, bold = false): TextLayer => ({
    kind: 'text',
    id: makeId(),
    text,
    color: '#111827',
    backgroundColor: null,
    fontSize,
    fontWeight: bold ? 'bold' : 'normal',
    position: at,
  });

  // falhosszak: a poligon minden éle mentén, kicsit kifelé tolva a középponttól
  const cx = poly.reduce((a, p) => a + p.x, 0) / poly.length;
  const cz = poly.reduce((a, p) => a + p.z, 0) / poly.length;
  const center = toPage({ x: cx, z: cz });
  const texts: TextLayer[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.3) continue;
    const mid = toPage({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    const dx = mid.x - center.x;
    const dy = mid.y - center.y;
    const n = Math.hypot(dx, dy) || 1;
    texts.push(label(formatLength(len, 'm'), { x: mid.x + (dx / n) * 0.045, y: mid.y + (dy / n) * 0.045 }, 2.4));
  }
  texts.push(label(title, { x: 0.5, y: 0.06 }, 3.6, true));
  texts.push(label(subtitle, { x: 0.5, y: 0.11 }, 2.4));
  return { ...doc, layers: [...doc.layers, ...texts] };
}

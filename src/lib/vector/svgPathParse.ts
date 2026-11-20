import { rp, type Subpath, type Vec } from './geometry';
import { arcToCubics } from './arc';

// ─────────────────────────────────────────────────────────────────────────────
// SVG path `d` — parse ↔ emit (import/export a `points`/`subpaths`-hoz)
// ─────────────────────────────────────────────────────────────────────────────

interface Token {
  cmd?: string;
  num?: number;
}

function tokenizeSvg(d: string): Token[] {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?)/g;
  const out: Token[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push({ cmd: m[1] });
    else out.push({ num: parseFloat(m[2]) });
  }
  return out;
}
/**
 * SVG path `d` → al-path-ok. Támogatott: M/L/H/V/C/S/Q/T/A/Z (abszolút és
 * relatív), implicit parancs-ismétlés, Q/T→köbös konverzió, S/T reflexió, ív→
 * Bézier. Minden `M` új al-path. A koordináták a `d` SAJÁT egységrendszerében
 * jönnek — a dobozba illesztéshez lásd `normalizeSubpaths`.
 */
export function parseSvgPath(d: string): Subpath[] {
  const toks = tokenizeSvg(d);
  const subs: Subpath[] = [];
  let sp: Subpath | null = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCubicC2: Vec | null = null; // az utolsó C/S második vezérlője (S-reflexió)
  let lastQuad: Vec | null = null; // az utolsó Q/T vezérlője (T-reflexió)
  let prev = '';
  let ci = 0;
  let cmd = '';

  const rd = () => toks[ci++].num as number;
  const peekNum = () => ci < toks.length && toks[ci].num !== undefined;
  const readPt = (rel: boolean): Vec => {
    const ax = rd();
    const ay = rd();
    return rel ? { x: cx + ax, y: cy + ay } : { x: ax, y: ay };
  };
  const flush = () => {
    if (sp && sp.points.length) subs.push(sp);
  };
  const startSub = (x: number, y: number) => {
    flush();
    sp = { points: [{ x, y }], closed: false };
    sx = x;
    sy = y;
    cx = x;
    cy = y;
  };
  const lineTo = (x: number, y: number) => {
    sp!.points.push({ x, y });
    cx = x;
    cy = y;
  };
  const curveTo = (c1: Vec, c2: Vec, x: number, y: number) => {
    const last = sp!.points[sp!.points.length - 1];
    last.h2 = { x: c1.x, y: c1.y };
    sp!.points.push({ x, y, h1: { x: c2.x, y: c2.y } });
    cx = x;
    cy = y;
    lastCubicC2 = { x: c2.x, y: c2.y };
    lastQuad = null;
  };
  const quadTo = (qx: number, qy: number, x: number, y: number) => {
    const c1 = { x: cx + (2 / 3) * (qx - cx), y: cy + (2 / 3) * (qy - cy) };
    const c2 = { x: x + (2 / 3) * (qx - x), y: y + (2 / 3) * (qy - y) };
    curveTo(c1, c2, x, y);
    lastQuad = { x: qx, y: qy };
  };
  const reflect = (ctrl: Vec | null): Vec =>
    ctrl ? { x: 2 * cx - ctrl.x, y: 2 * cy - ctrl.y } : { x: cx, y: cy };

  while (ci < toks.length) {
    if (toks[ci].cmd !== undefined) {
      cmd = toks[ci].cmd as string;
      ci++;
      if (cmd === 'Z' || cmd === 'z') {
        if (sp) {
          sp.closed = true;
          flush();
          sp = null;
          cx = sx;
          cy = sy;
        }
        prev = 'Z';
        continue;
      }
    }
    if (cmd === '') {
      ci++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    // Z után parancs `M` nélkül → új al-path az aktuális pontból
    if (sp === null && C !== 'M') {
      sp = { points: [{ x: cx, y: cy }], closed: false };
      sx = cx;
      sy = cy;
    }
    switch (C) {
      case 'M': {
        const p = readPt(rel);
        startSub(p.x, p.y);
        while (peekNum()) {
          const l = readPt(rel);
          lineTo(l.x, l.y);
        }
        break;
      }
      case 'L': {
        do {
          const l = readPt(rel);
          lineTo(l.x, l.y);
        } while (peekNum());
        break;
      }
      case 'H': {
        do {
          const x = rd() + (rel ? cx : 0);
          lineTo(x, cy);
        } while (peekNum());
        break;
      }
      case 'V': {
        do {
          const y = rd() + (rel ? cy : 0);
          lineTo(cx, y);
        } while (peekNum());
        break;
      }
      case 'C': {
        do {
          const c1 = readPt(rel);
          const c2 = readPt(rel);
          const e = readPt(rel);
          curveTo(c1, c2, e.x, e.y);
        } while (peekNum());
        break;
      }
      case 'S': {
        do {
          const c1 = prev === 'C' || prev === 'S' ? reflect(lastCubicC2) : { x: cx, y: cy };
          const c2 = readPt(rel);
          const e = readPt(rel);
          curveTo(c1, c2, e.x, e.y);
          prev = 'S';
        } while (peekNum());
        break;
      }
      case 'Q': {
        do {
          const q = readPt(rel);
          const e = readPt(rel);
          quadTo(q.x, q.y, e.x, e.y);
        } while (peekNum());
        break;
      }
      case 'T': {
        do {
          const q = prev === 'Q' || prev === 'T' ? reflect(lastQuad) : { x: cx, y: cy };
          const e = readPt(rel);
          quadTo(q.x, q.y, e.x, e.y);
          prev = 'T';
        } while (peekNum());
        break;
      }
      case 'A': {
        do {
          const rx = rd();
          const ry = rd();
          const phi = rd();
          const laf = rd();
          const sf = rd();
          const e = readPt(rel);
          const cubics = arcToCubics(cx, cy, rx, ry, phi, laf, sf, e.x, e.y);
          for (const seg of cubics) curveTo(seg.c1, seg.c2, seg.end.x, seg.end.y);
        } while (peekNum());
        break;
      }
      default:
        ci++;
        break;
    }
    prev = C;
  }
  flush();
  return subs
    .filter((s) => s.points.length >= 1)
    .map((s) => ({ points: s.points.map(rp), closed: s.closed }));
}

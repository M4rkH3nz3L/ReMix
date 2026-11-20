/**
 * ✒️ Vektor-toll mag (Creative Canvas) — pure Bézier-node szerkesztés a
 * `ShapeClip.points` / `subpaths` (`PathPoint[]`) fölött. A `maskEdit.ts` csak
 * fogó nélküli poligon-maszkokat kezel; ez a köbös Bézier-toll matematikája:
 * horgony/fog­ó hozzáadás-mozgatás-törlés, node-típus váltás (corner/smooth/
 * mirrored/broken), szegmens-osztás (de Casteljau) és SVG path `d` oda-vissza.
 *
 * Koordináta-rend: minden `x`/`y` 0…1 a klip SAJÁT dobozában. A `h1` a BEJÖVŐ,
 * a `h2` a KIMENŐ fogó ABSZOLÚT (nem relatív) pozíciója — pontosan úgy, ahogy a
 * `draw.ts:pathData` és a `boolean.ts:flattenShape` várja. A fogók SZÁNDÉKOSAN
 * nincsenek 0–1-re vágva: egy Bézier-vezérlőpont rendszeresen kilóg a dobozból,
 * a levágás eltorzítaná a görbét.
 *
 * Minden művelet ÚJ tömböt ad vissza (a hívó a command-buson teszi be → undo).
 */

// A mag a `vector/` mappában, felelősség szerint bontva; ez a modul a publikus felület.
export type { HandleId, NodeType, Subpath } from './vector/geometry';
export { anchorIndexAt, evalSegment, handleAt, nearestOnPath, nodeType } from './vector/query';
export {
  addAnchor,
  deleteAnchor,
  dragHandle,
  insertAnchor,
  joinPaths,
  moveAnchor,
  reversePath,
  setNodeType,
  splitSegment,
} from './vector/nodeEdit';
export { parseSvgPath } from './vector/svgPathParse';
export { pointsToSvgPath, subpathsToSvgPath } from './vector/svgPathEmit';
export { normalizeSubpaths, subpathsBounds } from './vector/bounds';
export { pathEditPatch, pathEditView } from './vector/ringEdit';

/**
 * 📊 V13: eszközmátrix — a teljesítmény-mérés egy sora (expo-mentes, tiszta mag).
 * A `perfmatrix` füstteszt méri, ez formázza a tervdokumentum táblázatába (eszközönként egy sor,
 * az újramérés felülírja ugyanannak az eszköznek a sorát).
 */

export type PerfResult = {
  date: string;
  device: string;
  os: string;
  /** előnézeti motor lejátszás közben: szeletek, késett szeletek, átlagos és max keverési idő */
  engine: { chunks: number; late: number; avgMixMs: number; maxMixMs: number };
  /** telefonos export: sávok × másodperc és a valós idő többszöröse */
  exportRun: { tracks: number; sec: number; ms: number };
  /** hosszú forrás: egy hideg ablak betöltése a fájl végéről */
  longSourceMs: number;
  /** zajszűrés: 60 s sztereó → 10 percre vetítve */
  denoise60Ms: number;
  /** formáns-korrekció: 10 s mono */
  formant10Ms: number;
  /** a legmagasabb hőszint a mérés alatt (0–3, −1 = ismeretlen) */
  maxThermal: number;
};

export const MATRIX_HEADER = [
  '| Dátum | Eszköz | OS | Motor: szelet átlag / max (késett) | Export | Hosszú forrás (hideg ablak) | Zajszűrés 10 perc | Formáns 10 s | Hő max |',
  '|---|---|---|---|---|---|---|---|---|',
].join('\n');

function fix(x: number, d = 1): string {
  return x.toFixed(d).replace('.', ',');
}

export function matrixRow(r: PerfResult): string {
  const e = r.engine;
  const avg = e.chunks > 0 ? e.avgMixMs : 0;
  const rtf = r.exportRun.ms > 0 ? r.exportRun.sec / (r.exportRun.ms / 1000) : 0;
  const cells = [
    r.date,
    r.device,
    r.os,
    `${fix(avg)} / ${fix(e.maxMixMs, 0)} ms (${e.late}/${e.chunks})`,
    `${r.exportRun.tracks} sáv × ${r.exportRun.sec} s: ${fix(rtf)}× valós idő`,
    `${Math.round(r.longSourceMs)} ms`,
    `${fix((r.denoise60Ms * 10) / 1000)} s`,
    `${Math.round(r.formant10Ms)} ms`,
    r.maxThermal < 0 ? '?' : String(r.maxThermal),
  ];
  return `| ${cells.join(' | ')} |`;
}

/**
 * A `markdown` táblázatába (a fejléc után) beteszi a sort; ha ugyanaz az eszköz már szerepel,
 * a régi sorát cseréli. Ha nincs táblázat, a fejléccel együtt a szöveg végére kerül.
 */
export function upsertMatrixRow(markdown: string, row: string): string {
  const device = row.split('|')[2]?.trim();
  const lines = markdown.split('\n');
  const head = lines.indexOf(MATRIX_HEADER.split('\n')[1]);
  if (head < 0) {
    return `${markdown.replace(/\n*$/, '')}\n\n${MATRIX_HEADER}\n${row}\n`;
  }
  let end = head + 1;
  while (end < lines.length && lines[end].startsWith('|')) {
    end++;
  }
  const at = lines.slice(head + 1, end).findIndex((l) => l.split('|')[2]?.trim() === device);
  if (at >= 0) {
    lines[head + 1 + at] = row;
  } else {
    lines.splice(end, 0, row);
  }
  return lines.join('\n');
}

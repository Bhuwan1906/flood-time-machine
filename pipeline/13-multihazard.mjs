// 13 — Multi-hazard: add landslide susceptibility to the grid, define the combined index.
//
// Day-2 problem statement 1.1 asks for MULTIPLE hazards and an MCDM-style combined risk index.
// The flood score already is a weighted-overlay MCDM index; this script adds the second hazard
// layer the PS names (landslide) and the metadata that lets the app show a combined
// flood + landslide + exposure index for any year without another payload.
//
// Landslide susceptibility comes from DEM slope (Zevenbergen & Thorne on the baked ELEV field):
//   below 3° → 0 · linear ramp · above 15° → 100.
// Chennai is flat — almost every cell scores 0 — and we say so honestly: the value of the field is
// that the SAME pipeline re-targets to a hilly city (regions.json) and the term wakes up.
//
// Combined multi-hazard index (0–10, weights sum to 1):
//   MH = 10 × ( 0.45·flood hazard  +  0.40·landslide susceptibility  +  0.15·built exposure )
// The app computes it per cell in the browser from packed fields, for every year on the slider.
//
// Writes: LH field into every score tile (fieldCount 25 → 26), index.json mhMeta, data/multihazard.json.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA, log, readJson, writeJson, loadRegion } from './lib.mjs';

const region = loadRegion(process.argv[2]);
const index = readJson('data/score/index.json');
const F = index.fields;
const Z = index.gridZoom;
const CPT = index.cellsPerTile;
const cellM = index.cellMetres;

if (index.fieldCount > 25) {
  log(`score tiles already carry ${index.fieldCount} fields (LH at ${F.LH}) — recomputing LH in place`);
}

const NF = 26;
const LH_AT = 25;
const SLOPE_LOW = 3;   // degrees: below this, flat as Chennai — no susceptibility
const SLOPE_HIGH = 15; // degrees: above this, fully susceptible
const WEIGHTS = { floodHazard: 0.45, landslide: 0.4, exposure: 0.15 };
const CLASSES = [
  { max: 2.5, label: 'low' },
  { max: 5, label: 'moderate' },
  { max: 7.5, label: 'high' },
  { max: Infinity, label: 'very high' },
];

// ---------------------------------------------------------------- load all tiles
const base = path.join(DATA, 'score', String(Z));
const tiles = new Map(); // "tx:ty" -> parsed tile
for (const xDir of fs.readdirSync(base)) {
  const xDirFull = path.join(base, xDir);
  if (!fs.statSync(xDirFull).isDirectory()) continue;
  for (const yFile of fs.readdirSync(xDirFull)) {
    if (!yFile.endsWith('.json')) continue;
    const tile = JSON.parse(fs.readFileSync(path.join(xDirFull, yFile), 'utf8'));
    tiles.set(`${xDir}:${yFile.replace('.json', '')}`, tile);
  }
}
log(`loaded ${tiles.size} score tiles (n=${[...tiles.values()][0]?.n})`);

const world = 2 ** (Z + Math.log2(CPT));
const cellElev = (gx, gy) => {
  if (gx < 0 || gy < 0 || gx >= world || gy >= world) return null;
  const tile = tiles.get(`${Math.floor(gx / CPT)}:${Math.floor(gy / CPT)}`);
  if (!tile) return null;
  const v = tile.c[((gy % CPT) * CPT + (gx % CPT)) * tile.n + F.ELEV];
  return v === undefined ? null : v;
};

// slope in degrees via central differences on the cell grid (Zevenbergen–Thorne magnitude)
function slopeDeg(gx, gy) {
  const w = cellElev(gx - 1, gy);
  const e = cellElev(gx + 1, gy);
  const n = cellElev(gx, gy - 1);
  const s = cellElev(gx, gy + 1);
  const dzdx = w !== null && e !== null ? (e - w) / (2 * cellM) : null;
  const dzdy = n !== null && s !== null ? (s - n) / (2 * cellM) : null;
  if (dzdx === null && dzdy === null) return 0;
  const gx2 = dzdx ?? 0;
  const gy2 = dzdy ?? 0;
  return (Math.atan(Math.hypot(gx2, gy2)) * 180) / Math.PI;
}

// ---------------------------------------------------------------- rewrite tiles with LH
let maxSlope = 0;
let cellsWithSlope = 0;
let cellsTotal = 0;
const countsByYear = index.years.map((y) => ({ key: y.key, label: y.label, counts: { low: 0, moderate: 0, high: 0, 'very high': 0 } }));
const yearByKey = Object.fromEntries(countsByYear.map((y) => [y.key, y]));

let written = 0;
for (const [key, tile] of tiles) {
  const nOld = tile.n;
  const cOld = tile.c;
  const cells = CPT * CPT;
  const out = nOld === NF ? cOld.slice() : new Array(cells * NF).fill(0);
  if (nOld !== NF) {
    for (let ci = 0; ci < cells; ci++) {
      for (let f = 0; f < nOld; f++) out[ci * NF + f] = cOld[ci * nOld + f];
    }
  }
  const [tx, ty] = key.split(':').map(Number);
  for (let cy = 0; cy < CPT; cy++) {
    for (let cx = 0; cx < CPT; cx++) {
      const ci = cy * CPT + cx;
      const o = ci * NF;
      const gx = tx * CPT + cx;
      const gy = ty * CPT + cy;
      if (out[o + F.MASK] > 0) {
        out[o + LH_AT] = 0;
        continue;
      }
      cellsTotal++;
      const slope = slopeDeg(gx, gy);
      if (slope > maxSlope) maxSlope = slope;
      const lh = Math.max(0, Math.min(1, (slope - SLOPE_LOW) / (SLOPE_HIGH - SLOPE_LOW))) * 100;
      if (lh > 0) cellsWithSlope++;
      out[o + LH_AT] = Math.round(lh * 100) / 100;
      // per-year multi-hazard class counts — same formula the app uses in the browser
      for (let k = 0; k < index.years.length; k++) {
        const mhK = 10 * (WEIGHTS.floodHazard * ((out[o + F.HAZ + k] ?? 0) / 100) + WEIGHTS.landslide * lh / 100 + WEIGHTS.exposure * ((out[o + F.EXPO] ?? 0) / 100));
        yearByKey[index.years[k].key].counts[CLASSES.find((c) => mhK < c.max).label] += 1;
      }
    }
  }
  tile.n = NF;
  tile.c = out;
  fs.writeFileSync(path.join(base, String(tx), `${ty}.json`), JSON.stringify(tile));
  written++;
}

// ---------------------------------------------------------------- index + sidecar
if (F.LH === undefined) {
  F.LH = LH_AT;
  index.fieldCount = NF;
  index.notes.push('LH[cell] = landslide susceptibility 0-100 from DEM slope (Zevenbergen-Thorne): 0 below 3°, 100 above 15° — PS 1.1 second hazard layer');
}
index.mhMeta = {
  basis: 'MCDM weighted overlay of the flood hazard term (packed HAZ+year), landslide susceptibility from DEM slope (LH), and built exposure (EXPO)',
  weights: WEIGHTS,
  formula: 'MH = 10 * (0.45*hazard + 0.40*landslide + 0.15*exposure), computed per cell in the browser for every year',
  susceptibility: { lowBelowDeg: SLOPE_LOW, highAboveDeg: SLOPE_HIGH, method: 'Zevenbergen-Thorne slope on the baked elevation grid' },
  classes: CLASSES.map((c) => ({ label: c.label, below: c.max === Infinity ? null : c.max })),
  countsByYear: countsByYear.map((y) => ({ key: y.key, label: y.label, ...y.counts })),
  honesty: 'Chennai is coastal plain: landslide susceptibility is ~0 nearly everywhere. The layer proves the multi-hazard framework and re-targets to hilly cities unchanged.',
};
fs.writeFileSync(path.join(DATA, 'score', 'index.json'), JSON.stringify(index));

writeJson('data/multihazard.json', {
  built: new Date().toISOString(),
  region: region.id,
  weights: WEIGHTS,
  formula: index.mhMeta.formula,
  susceptibility: index.mhMeta.susceptibility,
  classes: index.mhMeta.classes,
  honesty: index.mhMeta.honesty,
  byYear: countsByYear,
}, true);

log(`tiles rewritten with LH field: ${written} · fieldCount ${NF}`);
log(`slope: max ${maxSlope.toFixed(2)}° · ${cellsWithSlope.toLocaleString('en-IN')} of ${cellsTotal.toLocaleString('en-IN')} cells above 0 susceptibility (${((cellsWithSlope / Math.max(1, cellsTotal)) * 100).toFixed(2)}%) — expected near-flat for Chennai`);
for (const y of countsByYear) {
  const total = Object.values(y.counts).reduce((a, b) => a + b, 0);
  log(`  ${y.key}: ${y.counts.low.toLocaleString('en-IN')} low / ${y.counts.moderate.toLocaleString('en-IN')} moderate / ${y.counts.high.toLocaleString('en-IN')} high / ${y.counts['very high'].toLocaleString('en-IN')} very high (of ${total.toLocaleString('en-IN')})`);
}
log('done');

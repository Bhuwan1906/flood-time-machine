// 11 — Exposure statistics (challenge 4.4 expected output: "affected infrastructure statistics").
//
// Reads the extended score tiles (pop / building count / road metres per cell) and the modelled
// per-year depths, and bakes data/exposure.json: for each slider year, how many residents,
// buildings and metres of road sit in water ≥ 15 cm citywide, plus a severe tier (≥ 60 cm).
//
// 15 cm is the conventional "water on the road" threshold (ankle-deep, traffic slows); 60 cm is
// waist-deep and where vehicles start floating. Both tiers are labelled with their threshold.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA, log, writeJson, readJson, loadRegion } from './lib.mjs';

const region = loadRegion(process.argv[2]);
const Z = region.score.gridZoom;
const CPT = region.score.cellsPerTile;
const index = readJson('data/score/index.json');
const F = index.fields;
const NF = index.fieldCount;
const AFFECTED_M = 0.15;
const SEVERE_M = 0.6;

const scoreDir = path.join(DATA, 'score', String(Z));
const perYear = new Map();
for (const year of index.years) {
  perYear.set(year.key, {
    key: year.key,
    label: year.label.split('—')[0].trim(),
    people: 0, peopleSevere: 0,
    buildings: 0, buildingsSevere: 0,
    roadM: 0, roadMSevere: 0,
    cells: 0,
  });
}
const totals = { people: 0, buildings: 0, roadM: 0, cellsScored: 0 };

const xDirs = fs.existsSync(scoreDir) ? fs.readdirSync(scoreDir) : [];
let tilesRead = 0;
for (const x of xDirs) {
  const xPath = path.join(scoreDir, x);
  if (!fs.statSync(xPath).isDirectory()) continue;
  for (const yFile of fs.readdirSync(xPath)) {
    if (!yFile.endsWith('.json')) continue;
    let tile;
    try {
      tile = readJson(path.relative(ROOT, path.join(xPath, yFile)));
    } catch {
      continue;
    }
    if (tile.n !== NF) continue;
    tilesRead++;
    for (let i = 0; i < CPT * CPT; i++) {
      const o = i * NF;
      if (tile.c[o + F.MASK] > 0) continue;
      const pop = tile.c[o + F.POP] || 0;
      const bldc = tile.c[o + F.BLDC] || 0;
      const roadd = tile.c[o + F.ROADD] || 0;
      if (pop <= 0 && bldc <= 0 && roadd <= 0) continue;
      totals.people += pop;
      totals.buildings += bldc;
      totals.roadM += roadd;
      totals.cellsScored++;
      for (let k = 0; k < 5; k++) {
        const depth = (tile.c[o + F.DEPTH + k] ?? 0) / 100;
        if (depth < AFFECTED_M) continue;
        const severe = depth >= SEVERE_M;
        const y = perYear.get(index.years[k].key);
        y.people += pop;
        y.buildings += bldc;
        y.roadM += roadd;
        y.cells++;
        if (severe) {
          y.peopleSevere += pop;
          y.buildingsSevere += bldc;
          y.roadMSevere += roadd;
        }
      }
    }
  }
}

const years = [...perYear.values()].map((y) => ({
  key: y.key,
  label: y.label,
  people: Math.round(y.people),
  peopleSevere: Math.round(y.peopleSevere),
  buildings: Math.round(y.buildings),
  buildingsSevere: Math.round(y.buildingsSevere),
  roadKm: Math.round(y.roadM / 100) / 10,
  roadKmSevere: Math.round(y.roadMSevere / 100) / 10,
  cells: y.cells,
}));

const out = {
  region: region.id,
  method: {
    affectedThresholdM: AFFECTED_M,
    severeThresholdM: SEVERE_M,
    definition: `A cell counts as affected when the modelled water depth for that year is at least ${AFFECTED_M} m. Severe means at least ${SEVERE_M} m (waist-deep). Population is the Census-anchored building-footprint estimate baked into the score grid.`,
    bakedFrom: 'data/score tiles (POP/BLDC/ROADD fields), one JSON per map tile',
  },
  cityTotals: {
    people: Math.round(totals.people),
    buildings: Math.round(totals.buildings),
    roadKm: Math.round(totals.roadM / 100) / 10,
    cellsScored: totals.cellsScored,
  },
  years,
};
const size = writeJson('data/exposure.json', out, true);
log(`tiles read: ${tilesRead}`);
for (const y of years) {
  log(`  ${y.label.padEnd(6)} people ${y.people.toLocaleString('en-IN').padStart(10)} · buildings ${String(y.buildings).padStart(6)} · road ${y.roadKm} km`);
}
log(`city totals: ${out.cityTotals.people.toLocaleString('en-IN')} people · ${out.cityTotals.buildings.toLocaleString('en-IN')} buildings · ${out.cityTotals.roadKm} km road`);
log(`wrote data/exposure.json (${(size / 1024).toFixed(1)} KB)`);

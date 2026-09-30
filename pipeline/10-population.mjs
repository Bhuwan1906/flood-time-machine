// 10 — Population + buildings + roads per 100 m cell (challenge 4.4: exposure statistics).
//
// The PS asks for "affected settlements/roads/agricultural land" and "affected infrastructure
// statistics". The score grid already knows the hazard; this script adds the *what is exposed*
// fields so the app can state how many people, buildings and metres of road sit in each year's
// water — per street and citywide.
//
// India publishes no street-resolution population raster, so population is estimated from measured
// OpenStreetMap building footprints at a Census-anchored occupancy: one household per ~85 m² of
// footprint, 3.51 persons per household (Census 2011 Tamil Nadu household size). The estimate, its
// basis and its limits are stated in the app and the README — nothing is invented silently.
//
// Writes four new fields into the existing score tiles (fieldCount → 25):
//   POP   estimated residents in the cell
//   BLDC  building footprint count in the cell
//   ROADD metres of mapped road inside the cell
//   CRIT  critical facilities in the cell: hospitals, clinics, doctors, schools, colleges,
//         universities, kindergartens, police, fire stations, relief shelters, community centres
import fs from 'node:fs';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import PbfMod from 'pbf';
import { ROOT, DATA, log, readJson, loadRegion, tilesInBbox, y2lat } from './lib.mjs';

const Pbf = PbfMod.default ?? PbfMod;
const region = loadRegion(process.argv[2]);
const [S, W, N, E] = region.bbox;
const Z = region.score.gridZoom;
const CPT = region.score.cellsPerTile;
const BASEMAP_Z = region.basemap.tileZoomMax;
const ROAD_KINDS = new Set(['highway', 'major_road', 'minor_road']);
const CRIT_KINDS = new Set([
  'hospital', 'clinic', 'doctors', 'school', 'college', 'university', 'kindergarten',
  'police', 'fire_station', 'shelter', 'community_centre',
]);
const M2_PER_HOUSEHOLD = 85;   // Census-anchored average dwelling footprint
const PERSONS_PER_HOUSEHOLD = 3.51; // Census 2011, Tamil Nadu

const F = readJson('data/score/index.json').fields;
const NEW_FIELDS = { POP: 21, BLDC: 22, ROADD: 23, CRIT: 24 };
const NF = 25;

const perParent = 2 ** (BASEMAP_Z - Z);        // z15 tiles per z14 parent (2)
const cellsPerSide = CPT / perParent;          // 12 cells per z15 tile edge
const accum = new Map();                       // "tx:ty" -> { pop: F32, bldc: F32, roadd: F32, foot: F32 }
function acc(tx, ty) {
  const key = `${tx}:${ty}`;
  let a = accum.get(key);
  if (!a) {
    a = { pop: new Float32Array(CPT * CPT), bldc: new Float32Array(CPT * CPT), roadd: new Float32Array(CPT * CPT), crit: new Float32Array(CPT * CPT), foot: new Float32Array(CPT * CPT) };
    accum.set(key, a);
  }
  return a;
}

const metresPerPixel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

function shoelace(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += cross;
    cx += (ring[j].x + ring[i].x) * cross;
    cy += (ring[j].y + ring[i].y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return null;
  return { area: Math.abs(a), cx: cx / (6 * a), cy: cy / (6 * a) };
}

function addRingToCells(ring, mPerUnit2, addArea, addCount, a, offX, offY) {
  const s = shoelace(ring);
  if (!s) return;
  const cx = Math.floor((s.cx / 4096) * cellsPerSide);
  const cy = Math.floor((s.cy / 4096) * cellsPerSide);
  if (cx < 0 || cy < 0 || cx >= cellsPerSide || cy >= cellsPerSide) return;
  const idx = (offY + cy) * CPT + (offX + cx);
  a.foot[idx] += s.area * mPerUnit2;
  if (addCount) a.bldc[idx] += 1;
}

function addLineToCells(geom, metresPerUnit, a, offX, offY) {
  for (const line of geom) {
    for (let i = 1; i < line.length; i++) {
      const x0 = line[i - 1].x, y0 = line[i - 1].y, x1 = line[i].x, y1 = line[i].y;
      const lenUnits = Math.hypot(x1 - x0, y1 - y0);
      if (!lenUnits) continue;
      const steps = Math.max(1, Math.ceil(lenUnits / (4096 / cellsPerSide) * 2));
      for (let sIdx = 0; sIdx < steps; sIdx++) {
        const t = (sIdx + 0.5) / steps;
        const px = x0 + (x1 - x0) * t;
        const py = y0 + (y1 - y0) * t;
        const cx = Math.floor((px / 4096) * cellsPerSide);
        const cy = Math.floor((py / 4096) * cellsPerSide);
        if (cx < 0 || cy < 0 || cx >= cellsPerSide || cy >= cellsPerSide) continue;
        a.roadd[(offY + cy) * CPT + (offX + cx)] += (lenUnits / steps) * metresPerUnit;
      }
    }
  }
}

// ---------------------------------------------------------------- pass over z15 basemap tiles
const tiles = tilesInBbox([S, W, N, E], BASEMAP_Z);
let tilesRead = 0;
let buildingsSeen = 0;
let roadsSeen = 0;
let critSeen = 0;
for (const [z, x, y] of tiles) {
  const file = path.join(DATA, 'tiles', String(z), String(x), `${y}.mvt`);
  if (!fs.existsSync(file)) continue;
  let vt;
  try {
    vt = new VectorTile(new Pbf(fs.readFileSync(file)));
  } catch {
    continue;
  }
  const parentTx = Math.floor(x / perParent);
  const parentTy = Math.floor(y / perParent);
  const a = acc(parentTx, parentTy);
  const offX = (x - parentTx * perParent) * cellsPerSide;
  const offY = (y - parentTy * perParent) * cellsPerSide;
  const tileWidthM = 256 * metresPerPixel(y2lat(y + 0.5, z), z);
  tilesRead++;

  const buildings = vt.layers.buildings;
  if (buildings) {
    const m2 = (tileWidthM / buildings.extent) ** 2;
    for (let i = 0; i < buildings.length; i++) {
      const geom = buildings.feature(i).loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      buildingsSeen++;
      addRingToCells(geom[0], m2, true, true, a, offX, offY);
      for (let r = 1; r < geom.length; r++) addRingToCells(geom[r], m2, true, false, a, offX, offY);
    }
  }
  const roads = vt.layers.roads;
  if (roads) {
    for (let i = 0; i < roads.length; i++) {
      const f = roads.feature(i);
      if (!ROAD_KINDS.has(f.properties.kind)) continue;
      const geom = f.loadGeometry();
      if (!geom.length) continue;
      roadsSeen++;
      addLineToCells(geom, tileWidthM / roads.extent, a, offX, offY);
    }
  }
  const pois = vt.layers.pois;
  if (pois) {
    for (let i = 0; i < pois.length; i++) {
      const f = pois.feature(i);
      if (!CRIT_KINDS.has(f.properties.kind)) continue;
      const geom = f.loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      const pt = geom[0][0];
      const cx = Math.floor((pt.x / 4096) * cellsPerSide);
      const cy = Math.floor((pt.y / 4096) * cellsPerSide);
      if (cx < 0 || cy < 0 || cx >= cellsPerSide || cy >= cellsPerSide) continue;
      a.crit[(offY + cy) * CPT + (offX + cx)] += 1;
      critSeen++;
    }
  }
}

// population from footprint
for (const a of accum.values()) {
  for (let i = 0; i < a.foot.length; i++) a.pop[i] = (a.foot[i] / M2_PER_HOUSEHOLD) * PERSONS_PER_HOUSEHOLD;
}

// ---------------------------------------------------------------- write fields into score tiles
const scoreDir = path.join(DATA, 'score', String(Z));
let written = 0;
let skipped = 0;
let totalPop = 0;
let totalBld = 0;
let totalRoadM = 0;
let totalCrit = 0;
for (const [key, a] of accum) {
  const [tx, ty] = key.split(':').map(Number);
  const file = path.join(scoreDir, String(tx), `${ty}.json`);
  if (!fs.existsSync(file)) continue;
  const tile = readJson(path.relative(ROOT, file));
  if (tile.n === NF) skipped++; // already extended — fields are rewritten from accum below
  else if (tile.n !== 21 && tile.n !== 24) { log(`  unexpected field count ${tile.n} in ${tx}/${ty} — skipped`); continue; }
  const old = tile.c;
  const out = new Array(CPT * CPT * NF).fill(0);
  for (let ci = 0; ci < CPT * CPT; ci++) {
    for (let f = 0; f < tile.n; f++) out[ci * NF + f] = old[ci * tile.n + f];
    out[ci * NF + NEW_FIELDS.POP] = Math.round(a.pop[ci]);
    out[ci * NF + NEW_FIELDS.BLDC] = Math.round(a.bldc[ci]);
    out[ci * NF + NEW_FIELDS.ROADD] = Math.round(a.roadd[ci]);
    out[ci * NF + NEW_FIELDS.CRIT] = Math.round(a.crit[ci]);
    totalPop += a.pop[ci];
    totalBld += a.bldc[ci];
    totalRoadM += a.roadd[ci];
    totalCrit += a.crit[ci];
  }
  tile.n = NF;
  tile.c = out.map((v) => (v === 0 ? 0 : Math.round(v * 100) / 100));
  fs.writeFileSync(file, JSON.stringify(tile));
  written++;
}
log(`tiles extended: ${written} written, ${skipped} already done`);
log(`citywide: ~${Math.round(totalPop).toLocaleString('en-IN')} people · ${Math.round(totalBld).toLocaleString('en-IN')} buildings · ${(totalRoadM / 1000).toFixed(0)} km of road · ${Math.round(totalCrit).toLocaleString('en-IN')} critical facilities`);

// ---------------------------------------------------------------- index update
const indexPath = path.join(DATA, 'score', 'index.json');
const index = readJson(path.relative(ROOT, indexPath));
if (index.fieldCount !== NF) {
  Object.assign(index.fields, NEW_FIELDS);
  index.fieldCount = NF;
  index.critMeta = {
    basis: 'OpenStreetMap points of interest, Protomaps pois layer',
    kinds: [...CRIT_KINDS],
    cityEstimate: Math.round(totalCrit),
  };
  index.popMeta = {
    basis: 'OpenStreetMap building footprints, Census-anchored occupancy',
    m2PerHousehold: M2_PER_HOUSEHOLD,
    personsPerHousehold: PERSONS_PER_HOUSEHOLD,
    anchor: 'Census of India 2011, Tamil Nadu average household size (3.51)',
    limit: 'An occupancy model, not a census count of buildings. Reads as population present on an average day.',
    cityEstimate: Math.round(totalPop),
  };
  index.notes.push('pop[cell] = footprint/85 m2 * 3.51 persons (Census 2011 TN) — challenge 4.4 exposure estimate');
  index.notes.push('bldc[cell] = building footprint count; roadd[cell] = metres of mapped road');
  index.notes.push('crit[cell] = critical facilities: hospital, clinic, doctors, school, college, university, kindergarten, police, fire_station, shelter, community_centre');
  fs.writeFileSync(indexPath, JSON.stringify(index));
  log(`index.json: fields updated, fieldCount ${NF}`);
}
log('done');

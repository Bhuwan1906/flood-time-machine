// 06 — The score grid (the brain).
//
// Every ~100 m cell over Chennai gets, for each of the five slider years: a hazard term, a water
// depth and a 0-10 risk score, plus the input sub-scores so the app can show its working.
//
//   score = 10 * ( 0.40 * modelled depth  +  0.20 * past flood history
//                + 0.30 * low ground      +  0.10 * how built-up it is )
//
// Hazard comes from published zones (2005 GCC extent, 2015 NRSC inundation zone, 2020 Nivar hotspots,
// today's GCC hazard zoning, 200-year return-period corridors) plus a terrain hollow term, because
// water pools where the ground sits below its surroundings. Ground height and built-up share come from
// the elevation tiles and the basemap's building footprints and land use. Nothing here runs during the
// demo: it is all pre-baked into one small JSON file per tile.
import fs from 'node:fs';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import PbfMod from 'pbf';
import {
  ROOT, CACHE, DATA, log, writeJson, loadRegion, human,
  y2lat, round, clamp, decodePng, pngElevation, pointInPolygon, eachPolygon, bboxOfGeometry,
} from './lib.mjs';

const Pbf = PbfMod.default ?? PbfMod;
const region = loadRegion(process.argv[2]);
const [S, W, N, E] = region.bbox;
const Z = region.score.gridZoom;
const CPT = region.score.cellsPerTile;
const CELLS = CPT * CPT;
const CELL_M = (256 * (156543.03392 * Math.cos((region.center[1] * Math.PI) / 180))) / 2 ** Z / CPT;
const CELL_AREA_M2 = CELL_M * CELL_M;

// flat field layout per tile: [elev, vuln, expo, haz x5, depth x5, score x5, rain, wetland, mask]
const F = { ELEV: 0, VULN: 1, EXPO: 2, HAZ: 3, DEPTH: 8, SCORE: 13, RAIN: 18, WET: 19, MASK: 20 };
const NFIELDS = 21;
const WET_RING_FACTOR = [0.35, 0.25, 0.15, 0.08];

// Ground height is judged against fixed Chennai breakpoints rather than the region's percentiles:
// the coastal plain drains to the sea, so 2 m and below is the worst case and 20 m is effectively safe.
const ELEV_WORST_M = 2;
const ELEV_SAFE_M = 20;
const BUILT_KINDS = new Set([
  'residential', 'commercial', 'industrial', 'retail', 'hospital', 'school', 'college', 'university',
  'military', 'railway', 'platform', 'bus_station', 'parking', 'construction', 'stadium', 'dormitory', 'civic_admin',
]);

const YEARS = [
  { key: '2005', label: '2005 — GCC flood extent', slug: 'chennai-gcc-flood-extent-2005', source: 'GCC, via opencity.in', baseDepth: 0.35, history: true },
  { key: '2015', label: '2015 — NRSC flood inundation zone', slug: 'chennai-2015-floods-inundation-zone', source: 'NRSC, via opencity.in', baseDepth: 0.5, history: true },
  { key: '2020', label: '2020 — Cyclone Nivar hotspots', slug: 'chennai-gcc-flood-hostspots-2020', source: 'GCC, via opencity.in', baseDepth: 0.3, history: true },
  {
    key: 'today', label: 'Today — city flood hazard zoning', slug: 'chennai-flood-hazard-zones-map', source: 'GCC, via opencity.in',
    byCategory: { high: 0.7, moderate: 0.35, low: 0.1 }, defaultDepth: 0.25, history: false,
  },
  {
    key: '2070', label: '2070 — 200-year return period corridors', slug: 'chennai-flows-200-years-return-period', source: 'GCC, via opencity.in',
    byCategory: { high: 1.0, moderate: 0.6, low: 0.25 }, defaultDepth: 0.45, history: false,
  },
];
const HISTORY_YEARS = YEARS.filter((y) => y.history).length;

log(`grid: z${Z}, ${CPT}x${CPT} cells per tile, ${CELL_M.toFixed(0)} m per cell`);

// ---------------------------------------------------------------- global grid
const EXPONENT = Z + Math.log2(CPT);
const WORLD = 2 ** EXPONENT;
const gxOf = (lon) => Math.floor(((lon + 180) / 360) * WORLD);
const gyOf = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD);
};
const centerOf = (gx, gy) => [((gx + 0.5) / WORLD) * 360 - 180, y2lat(gy + 0.5, EXPONENT)];
const tileOfGx = (gx) => Math.floor(gx / CPT);
const idxInTile = (gx, gy) => (gy % CPT) * CPT + (gx % CPT);

const grid = new Map();
function tileArray(tx, ty) {
  const key = `${tx}:${ty}`;
  let arr = grid.get(key);
  if (!arr) {
    arr = new Float32Array(CELLS * NFIELDS);
    arr.fill(-1);
    grid.set(key, arr);
  }
  return arr;
}
const getField = (gx, gy, field) => {
  const arr = grid.get(`${tileOfGx(gx)}:${tileOfGx(gy)}`);
  return arr ? arr[idxInTile(gx, gy) * NFIELDS + field] : -1;
};

const tx0 = tileOfGx(gxOf(W));
const tx1 = tileOfGx(gxOf(E));
const ty0 = tileOfGx(gyOf(N));
const ty1 = tileOfGx(gyOf(S));
const zTiles = [];
for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) zTiles.push([tx, ty]);
log(`z${Z} tiles covering the region: ${zTiles.length}`);

const tileEdgeLon = (z, x) => (x / 2 ** z) * 360 - 180;
const tileEdgeLat = (z, y) => y2lat(y, z);
const metresPerPixel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

function pointInVectorRings(px, py, rings) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  if (!inRing(rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (inRing(rings[i])) return false;
  return true;
}

// ---------------------------------------------------------------- pass 1: elevation, buildings, land use, water
const terrainDir = path.join(ROOT, 'data', 'terrain');
const tilesDir = path.join(ROOT, 'data', 'tiles');
const sampleZ = region.terrain.sampleZoom;
const pngCache = new Map();
function terrainTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (pngCache.has(key)) return pngCache.get(key);
  const file = path.join(terrainDir, String(z), String(x), `${y}.png`);
  let png = null;
  if (fs.existsSync(file)) {
    try {
      png = decodePng(fs.readFileSync(file));
    } catch (err) {
      log(`  terrain decode failed ${key}: ${err.message}`);
    }
  }
  if (pngCache.size >= 8) pngCache.clear();
  pngCache.set(key, png);
  return png;
}

const BASEMAP_Z = region.basemap.tileZoomMax;
const parentScale = 2 ** (Z - BASEMAP_Z); // < 1 when the basemap is finer than the grid

/** Rasterise one basemap tile straight onto the parent grid tile it belongs to. */
function applyBasemapTile(z, x, y, arr, parentTx, parentTy, footArea, builtFlag, waterMask) {
  const file = path.join(tilesDir, String(z), String(x), `${y}.mvt`);
  if (!fs.existsSync(file)) return false;
  const vt = new VectorTile(new Pbf(fs.readFileSync(file)));
  const extent = vt.layers.buildings?.extent ?? vt.layers.landuse?.extent ?? 4096;
  const perParent = 2 ** (z - Z); // how many tiles of this zoom make up one parent tile
  const cellsPerSide = CPT / perParent;
  const offX = (x - parentTx * perParent) * cellsPerSide;
  const offY = (y - parentTy * perParent) * cellsPerSide;
  const tileWidthM = 256 * metresPerPixel(y2lat(y + 0.5, z), z);
  const mPerUnit = tileWidthM / extent;

  const buildings = vt.layers.buildings;
  if (buildings) {
    for (let i = 0; i < buildings.length; i++) {
      const geom = buildings.feature(i).loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      const ring = geom[0];
      let area = 0;
      let sx = 0;
      let sy = 0;
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        area += ring[j].x * ring[k].y - ring[k].x * ring[j].y;
        sx += ring[k].x;
        sy += ring[k].y;
      }
      area = (Math.abs(area) / 2) * mPerUnit * mPerUnit;
      const lcx = Math.floor((sx / ring.length / extent) * cellsPerSide);
      const lcy = Math.floor((sy / ring.length / extent) * cellsPerSide);
      if (lcx < 0 || lcy < 0 || lcx >= cellsPerSide || lcy >= cellsPerSide) continue;
      const cell = (offY + lcy) * CPT + (offX + lcx);
      footArea[cell] += area;
    }
  }

  const landuse = vt.layers.landuse;
  if (landuse) {
    for (let i = 0; i < landuse.length; i++) {
      if (!BUILT_KINDS.has(landuse.feature(i).properties.kind)) continue;
      const geom = landuse.feature(i).loadGeometry();
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of geom) {
        for (const pt of ring) {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        }
      }
      const cx0 = clamp(Math.floor((minX / extent) * cellsPerSide), 0, cellsPerSide - 1);
      const cx1 = clamp(Math.floor((maxX / extent) * cellsPerSide), 0, cellsPerSide - 1);
      const cy0 = clamp(Math.floor((minY / extent) * cellsPerSide), 0, cellsPerSide - 1);
      const cy1 = clamp(Math.floor((maxY / extent) * cellsPerSide), 0, cellsPerSide - 1);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = ((cx + 0.5) / cellsPerSide) * extent;
          const py = ((cy + 0.5) / cellsPerSide) * extent;
          if (!pointInVectorRings(px, py, geom)) continue;
          builtFlag[(offY + cy) * CPT + (offX + cx)] = 1;
        }
      }
    }
  }

  const water = vt.layers.water;
  if (water) {
    for (let i = 0; i < water.length; i++) {
      const geom = water.feature(i).loadGeometry();
      if (!geom.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const ring of geom) {
        for (const pt of ring) {
          if (pt.x < minX) minX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y > maxY) maxY = pt.y;
        }
      }
      const cx0 = clamp(Math.floor((minX / extent) * cellsPerSide), 0, cellsPerSide - 1);
      const cx1 = clamp(Math.floor((maxX / extent) * cellsPerSide), 0, cellsPerSide - 1);
      const cy0 = clamp(Math.floor((minY / extent) * cellsPerSide), 0, cellsPerSide - 1);
      const cy1 = clamp(Math.floor((maxY / extent) * cellsPerSide), 0, cellsPerSide - 1);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = ((cx + 0.5) / cellsPerSide) * extent;
          const py = ((cy + 0.5) / cellsPerSide) * extent;
          if (!pointInVectorRings(px, py, geom)) continue;
          waterMask[(offY + cy) * CPT + (offX + cx)] = 1;
        }
      }
    }
  }
  return true;
}

let buildingsSeen = 0;
let detailTilesUsed = 0;
for (const [tx, ty] of zTiles) {
  const arr = tileArray(tx, ty);
  const sampleTx = Math.floor((tx / 2 ** Z) * 2 ** sampleZ);
  const sampleTy = Math.floor((ty / 2 ** Z) * 2 ** sampleZ);
  const png = terrainTile(sampleZ, sampleTx, sampleTy);

  for (let cy = 0; cy < CPT; cy++) {
    for (let cx = 0; cx < CPT; cx++) {
      const gx = tx * CPT + cx;
      const gy = ty * CPT + cy;
      const [lon, lat] = centerOf(gx, gy);
      const idx = idxInTile(gx, gy) * NFIELDS;
      let elev = -1;
      if (png) {
        const west = tileEdgeLon(sampleZ, sampleTx);
        const east = tileEdgeLon(sampleZ, sampleTx + 1);
        const north = tileEdgeLat(sampleZ, sampleTy);
        const south = tileEdgeLat(sampleZ, sampleTy + 1);
        const px = clamp(Math.round(((lon - west) / (east - west)) * 256), 0, 255);
        const py = clamp(Math.round(((north - lat) / (north - south)) * 256), 0, 255);
        elev = round(pngElevation(png, px, py), 1);
      }
      arr[idx + F.ELEV] = elev;
      arr[idx + F.EXPO] = 0;
      arr[idx + F.WET] = 0;
      arr[idx + F.MASK] = 0;
    }
  }

  const footArea = new Float32Array(CELLS);
  const builtFlag = new Uint8Array(CELLS);
  const waterMask = new Uint8Array(CELLS);
  let used = 0;
  if (parentScale < 1) {
    // Prefer the finer basemap zoom: the coarse level merges whole blocks into single polygons.
    const per = 2 ** (Z - BASEMAP_Z) * -1;
    const children = 2 ** (BASEMAP_Z - Z);
    for (let dx = 0; dx < children; dx++) {
      for (let dy = 0; dy < children; dy++) {
        if (applyBasemapTile(BASEMAP_Z, tx * children + dx, ty * children + dy, arr, tx, ty, footArea, builtFlag, waterMask)) used++;
      }
    }
  } else {
    used = applyBasemapTile(BASEMAP_Z, tx, ty, arr, tx, ty, footArea, builtFlag, waterMask) ? 1 : 0;
  }
  if (used) detailTilesUsed += used;

  for (let i = 0; i < CELLS; i++) {
    const idx = i * NFIELDS;
    const share = clamp(0.6 * builtFlag[i] + footArea[i] / CELL_AREA_M2, 0, 1);
    arr[idx + F.EXPO] = Math.round(share * 100);
    arr[idx + F.MASK] = waterMask[i] ? 1 : 0;
    if (footArea[i] > 0) buildingsSeen++;
  }
}
log(`pass 1 done: ${grid.size} tiles, ${detailTilesUsed} basemap tiles read, built-up evidence in ${buildingsSeen} cells`);

// ---------------------------------------------------------------- pass 2: rasterise published layers
const zoneDepth = new Map();
function zoneArr(key, tx, ty) {
  let m = zoneDepth.get(key);
  if (!m) {
    m = new Map();
    zoneDepth.set(key, m);
  }
  const k = `${tx}:${ty}`;
  let arr = m.get(k);
  if (!arr) {
    arr = new Float32Array(CELLS);
    m.set(k, arr);
  }
  return arr;
}

for (const year of YEARS) {
  const file = path.join(CACHE, 'flood', `${year.slug}.json`);
  if (!fs.existsSync(file)) {
    log(`  !! missing ${year.slug} — run pipeline/03-fetch-flood.mjs first`);
    continue;
  }
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  let hits = 0;
  let pointFeatures = 0;
  for (const feature of fc.features) {
    const props = feature.properties || {};
    const category = String(props.CATEGORY ?? props.category ?? '').toLowerCase();
    const depth = year.byCategory ? year.byCategory[category] ?? year.defaultDepth : year.baseDepth;
    if (!depth) continue;

    if (feature.geometry?.type === 'Point' || feature.geometry?.type === 'MultiPoint') {
      const list = feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
      for (const [lon, lat] of list) {
        pointFeatures++;
        const gcx = gxOf(lon);
        const gcy = gyOf(lat);
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -2; dy <= 2; dy++) {
            const step = Math.abs(dx) + Math.abs(dy);
            if (step > 2) continue;
            const arr = zoneArr(year.key, tileOfGx(gcx + dx), tileOfGx(gcy + dy));
            const i = idxInTile(gcx + dx, gcy + dy);
            const value = depth * (1 - 0.3 * step);
            if (value > arr[i]) arr[i] = value;
            hits++;
          }
        }
      }
      continue;
    }

    eachPolygon(feature, (rings) => {
      const bbox = bboxOfGeometry({ type: 'Polygon', coordinates: rings });
      for (let gx = gxOf(bbox[1]); gx <= gxOf(bbox[3]); gx++) {
        for (let gy = gyOf(bbox[2]); gy <= gyOf(bbox[0]); gy++) {
          const [lon, lat] = centerOf(gx, gy);
          if (!pointInPolygon(lon, lat, rings)) continue;
          const arr = zoneArr(year.key, tileOfGx(gx), tileOfGx(gy));
          const i = idxInTile(gx, gy);
          if (depth > arr[i]) arr[i] = depth;
          hits++;
        }
      }
    });
  }
  log(`  ${year.key}: ${hits} cell hits from ${fc.features.length} features (${year.label}${pointFeatures ? `, ${pointFeatures} points` : ''})`);
}

// Measured inundation depths (published in inches) — evidence of where water actually stood deep.
const depthFile = path.join(CACHE, 'flood', 'chennai-inundation-points-with-depth-of-inundation.json');
const measured = new Map();
if (fs.existsSync(depthFile)) {
  const fc = JSON.parse(fs.readFileSync(depthFile, 'utf8'));
  const RADIUS_M = 300;
  let used = 0;
  for (const f of fc.features) {
    if (f.geometry?.type !== 'Point') continue;
    const inches = Number(f.properties?.DEPTH);
    if (!Number.isFinite(inches)) continue;
    const [lon, lat] = f.geometry.coordinates;
    const depthM = inches * 0.0254;
    const rCells = Math.ceil(RADIUS_M / CELL_M);
    used++;
    for (let dx = -rCells; dx <= rCells; dx++) {
      for (let dy = -rCells; dy <= rCells; dy++) {
        const gx = gxOf(lon) + dx;
        const gy = gyOf(lat) + dy;
        const [clon, clat] = centerOf(gx, gy);
        const dist = Math.hypot((clon - lon) * 111320 * Math.cos((lat * Math.PI) / 180), (clat - lat) * 110574);
        if (dist > RADIUS_M) continue;
        const value = depthM * (1 - (dist / RADIUS_M) ** 2);
        const key = `${tileOfGx(gx)}:${tileOfGx(gy)}`;
        const i = idxInTile(gx, gy);
        let arr = measured.get(key);
        if (!arr) {
          arr = new Float32Array(CELLS);
          measured.set(key, arr);
        }
        if (value > arr[i]) arr[i] = value;
      }
    }
  }
  log(`  measured depth points applied: ${used}`);
}

// ---------------------------------------------------------------- wetland distance field
const wetDist = new Map();
const wetlandFile = path.join(DATA, 'wetlands.geojson');
if (fs.existsSync(wetlandFile)) {
  const fc = JSON.parse(fs.readFileSync(wetlandFile, 'utf8'));
  let frontier = [];
  for (const feature of fc.features) {
    eachPolygon(feature, (rings) => {
      const bbox = bboxOfGeometry({ type: 'Polygon', coordinates: rings });
      for (let gx = gxOf(bbox[1]); gx <= gxOf(bbox[3]); gx++) {
        for (let gy = gyOf(bbox[2]); gy <= gyOf(bbox[0]); gy++) {
          const [lon, lat] = centerOf(gx, gy);
          if (!pointInPolygon(lon, lat, rings)) continue;
          const key = `${gx}:${gy}`;
          if (wetDist.has(key)) continue;
          wetDist.set(key, 0);
          frontier.push([gx, gy]);
        }
      }
    });
  }
  const inside = frontier.length;
  for (let ring = 1; ring < WET_RING_FACTOR.length; ring++) {
    const next = [];
    for (const [gx, gy] of frontier) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = `${gx + dx}:${gy + dy}`;
          if (wetDist.has(key)) continue;
          wetDist.set(key, ring);
          next.push([gx + dx, gy + dy]);
        }
      }
    }
    frontier = next;
  }
  log(`  wetlands: ${inside} cells inside, ${wetDist.size} cells in the attenuation field`);
}

// ---------------------------------------------------------------- pass 3: score and write
const elevations = [];
for (const arr of grid.values()) {
  for (let i = 0; i < CELLS; i++) {
    const idx = i * NFIELDS;
    if (arr[idx + F.MASK] > 0) continue;
    if (arr[idx + F.ELEV] >= -0.5) elevations.push(arr[idx + F.ELEV]);
  }
}
elevations.sort((a, b) => a - b);
const pctile = (list, p) => list[Math.min(list.length - 1, Math.max(0, Math.floor((p / 100) * list.length)))];
log(`ground elevation: p2 ${pctile(elevations, 2).toFixed(1)} m, median ${pctile(elevations, 50).toFixed(1)} m, p98 ${pctile(elevations, 98).toFixed(1)} m`);

const cellsTotal = grid.size * CELLS;
let cellsScored = 0;
let cellsMasked = 0;
let builtCells = 0;
const worst = [];
const demoStats = new Map(region.demoAreas.map((a) => [a.id, []]));
let writtenBytes = 0;

for (const [key, arr] of grid) {
  const [tx, ty] = key.split(':').map(Number);
  for (let i = 0; i < CELLS; i++) {
    const idx = i * NFIELDS;
    const cx = i % CPT;
    const cy = Math.floor(i / CPT);
    const gx = tx * CPT + cx;
    const gy = ty * CPT + cy;
    const [lon, lat] = centerOf(gx, gy);

    const elev = arr[idx + F.ELEV];
    if (arr[idx + F.MASK] > 0 || elev < -0.5) {
      arr[idx + F.MASK] = 1;
      arr[idx + F.VULN] = -1;
      cellsMasked++;
      continue;
    }

    const vuln = clamp((ELEV_SAFE_M - elev) / (ELEV_SAFE_M - ELEV_WORST_M), 0, 1);
    const expo = clamp(arr[idx + F.EXPO] / 100, 0, 1);
    if (expo > 0.1) builtCells++;
    const measuredDepth = measured.get(key)?.[i] ?? 0;

    let sum = 0;
    let count = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const e = getField(gx + dx, gy + dy, F.ELEV);
        if (e >= -0.5) {
          sum += e;
          count++;
        }
      }
    }
    const hollow = clamp(((count ? sum / count : elev) - elev) * 0.9, 0, 0.9);

    let historyCount = 0;
    const depths = [];
    const hazards = [];
    const scores = [];
    for (const year of YEARS) {
      const zone = zoneDepth.get(year.key)?.get(key)?.[i] ?? 0;
      let depth = zone > 0 ? zone + hollow : 0;
      if (year.key === 'today') depth = Math.max(depth, measuredDepth);
      if (year.history && zone > 0) historyCount++;
      const depthN = clamp(depth / 1.5, 0, 1);
      const hazard = 0.4 * depthN + 0.2 * (historyCount / HISTORY_YEARS);
      depths.push(depth);
      hazards.push(hazard);
      scores.push(10 * (hazard + 0.3 * vuln + 0.1 * expo));
    }

    arr[idx + F.VULN] = Math.round(vuln * 100);
    for (let k = 0; k < 5; k++) {
      arr[idx + F.HAZ + k] = Math.round(hazards[k] * 100);
      arr[idx + F.DEPTH + k] = Math.round(depths[k] * 100);
      arr[idx + F.SCORE + k] = Math.round(scores[k] * 10);
    }
    arr[idx + F.RAIN] = Math.round(60 - 35 * vuln);

    const ring = wetDist.get(`${gx}:${gy}`);
    arr[idx + F.WET] = ring === undefined ? 0 : Math.round((WET_RING_FACTOR[ring] ?? 0.05) * 100);
    cellsScored++;

    const record = { lon: round(lon, 5), lat: round(lat, 5), elev, scores: scores.map((s) => round(s, 1)) };
    if (worst.length < 200) {
      worst.push(record);
      if (worst.length === 200) worst.sort((a, b) => a.scores[4] - b.scores[4]);
    } else if (record.scores[4] > worst[0].scores[4]) {
      worst[0] = record;
      worst.sort((a, b) => a.scores[4] - b.scores[4]);
    }
    for (const area of region.demoAreas) {
      if (lon >= area.bbox[1] && lon <= area.bbox[3] && lat >= area.bbox[0] && lat <= area.bbox[2]) {
        demoStats.get(area.id).push({ lon: record.lon, lat: record.lat, scores: record.scores, elev, depth2070M: round(depths[4], 2) });
      }
    }
  }

  writtenBytes += writeJson(`data/score/${Z}/${tx}/${ty}.json`, {
    z: Z,
    x: tx,
    y: ty,
    cellM: round(CELL_M, 1),
    n: NFIELDS,
    years: YEARS.map((y) => y.key),
    c: Array.from(arr, (v) => Math.round(v * 10) / 10),
  });
}
worst.sort((a, b) => b.scores[4] - a.scores[4]);

writeJson('data/score/index.json', {
  region: region.id,
  gridZoom: Z,
  cellsPerTile: CPT,
  cellMetres: round(CELL_M, 1),
  fields: F,
  fieldCount: NFIELDS,
  years: YEARS.map((y) => ({ key: y.key, label: y.label, source: y.source, slug: y.slug })),
  weights: region.score.weights,
  tiles: grid.size,
  cellsTotal,
  cellsScored,
  cellsMasked,
  normalisers: { elevWorstM: ELEV_WORST_M, elevSafeM: ELEV_SAFE_M, basemapZoom: BASEMAP_Z },
  notes: [
    'score = 10 * (0.4 * depthNormalised + 0.2 * floodHistory + 0.3 * lowGround + 0.1 * builtUp)',
    'lowGround uses fixed Chennai breakpoints: 1.0 at or below 2 m, 0 at or above 20 m',
    'builtUp = 60% of built-up land use coverage plus measured building footprint coverage of the cell',
    'haz[year] stores only the two hazard terms (0-60) so the app can rescore a cell with wetlands restored',
    'depth[year] is modelled from the published zone plus a terrain hollow term; measured points override Today',
    'sea, rivers, lakes and marsh cells carry mask = 1 and no score',
    'wet[cell] = modelled share of hazard removed if the surrounding wetlands were restored (0-100)',
  ],
}, true);

const scoreKeys = YEARS.map((y) => y.key);
log('');
log('score distribution over demo areas (0-10 bins):');
log('       ' + Array.from({ length: 11 }, (_, i) => String(i).padStart(7)).join(''));
for (const [index, year] of YEARS.entries()) {
  const bins = new Array(11).fill(0);
  for (const list of demoStats.values()) for (const c of list) bins[Math.min(10, Math.round(c.scores[index]))]++;
  log(year.key.padEnd(7) + bins.map((n) => String(n).padStart(7)).join(''));
}

log('');
for (const area of region.demoAreas) {
  const list = demoStats.get(area.id) || [];
  list.sort((a, b) => b.scores[4] - a.scores[4]);
  const mid = list[Math.floor(list.length / 2)];
  log(`${area.label}: ${list.length} cells, worst 2070 ${list[0] ? list[0].scores[4] : '-'}, median ${mid ? mid.scores.join('/') : '-'} (elev ${mid ? mid.elev : '-'} m)`);
  if (list.length) {
    log(`  worst cells: ${list.slice(0, 3).map((c) => `${c.scores[4]} @ ${c.lat},${c.lon} (${c.elev} m)`).join(' | ')}`);
    log(`  safest     : ${list[list.length - 1].scores.join('/')} @ ${list[list.length - 1].lat},${list[list.length - 1].lon}`);
  }
}

writeJson('data/score/demo-snapshot.json', {
  note: 'Per-cell snapshots inside the demo areas, used to choose the three demo addresses.',
  worstOverall: worst.slice(0, 20),
  areas: Object.fromEntries(
    [...demoStats].map(([id, list]) => {
      const sorted = [...list].sort((a, b) => b.scores[4] - a.scores[4]);
      return [id, { cells: sorted.length, worst: sorted.slice(0, 10), best: sorted.slice(-10).reverse() }];
    }),
  ),
}, true);

log('');
log(`score grid written: ${grid.size} tiles, ${cellsScored} scored cells (${builtCells} built-up), ${cellsMasked} masked, ${human(writtenBytes)} -> data/score/`);

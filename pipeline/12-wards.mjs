// 12 — Ward-level exposure table + land-use split (challenge 4.4 deliverables).
//
// The PS asks for "affected infrastructure statistics". A ranked ward table with a CSV export is
// the usable form of that answer. This script joins the score grid (per-cell exposure fields and
// per-year depths) to the 201 ward polygons, and measures each cell's built-up split by
// residential / commercial / industrial land use from the OSM landuse layer.
//
// Outputs:
//   data/exposure-wards.json — per ward, per year: residents/buildings/roadKm/crit affected
//                              + severe tier + citywide built-up split per year
// The app turns the ward table into the CSV download.
import fs from 'node:fs';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import PbfMod from 'pbf';
import { ROOT, DATA, log, writeJson, readJson, loadRegion } from './lib.mjs';

const Pbf = PbfMod.default ?? PbfMod;
const region = loadRegion(process.argv[2]);
const Z = region.score.gridZoom;
const CPT = region.score.cellsPerTile;
const index = readJson('data/score/index.json');
const F = index.fields;
const NF = index.fieldCount;
const AFFECTED_M = 0.15;
const SEVERE_M = 0.6;

// ---------------------------------------------------------------- wards
const wards = readJson('data/wards.geojson').features
  .map((f) => {
    // normalise to a list of polygons, each { outer, holes }
    const polys = f.geometry.type === 'Polygon'
      ? [{ outer: f.geometry.coordinates[0], holes: f.geometry.coordinates.slice(1) }]
      : f.geometry.coordinates.map((p) => ({ outer: p[0], holes: p.slice(1) }));
    return { ward: f.properties.Ward_No, zone: f.properties.Zone_Name, polys };
  })
  .filter((w) => w.ward !== undefined && w.ward !== null);

// cell centre lon/lat (web-mercator global grid, same math as 06-score-grid)
const WORLD = 2 ** (Z + Math.log2(CPT));
const cellLon = (gx) => ((gx + 0.5) / WORLD) * 360 - 180;
const cellLat = (gy) => {
  const n = Math.PI - (2 * Math.PI * gy) / WORLD;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// centroid per ward (for the clickable 'fly to worst ward' button) — area-weighted shoelace centroid
function centroid(polys) {
  let best = null;
  let bestArea = 0;
  for (const poly of polys) {
    const ring = poly.outer;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      a += cross;
      cx += (ring[j][0] + ring[i][0]) * cross;
      cy += (ring[j][1] + ring[i][1]) * cross;
    }
    a /= 2;
    if (Math.abs(a) > bestArea) {
      bestArea = Math.abs(a);
      best = a !== 0 ? [cx / (6 * a), cy / (6 * a)] : null;
    }
  }
  return best;
}

function wardOf(lon, lat) {
  for (const w of wards) {
    for (const poly of w.polys) {
      if (!pointInRing(lon, lat, poly.outer)) continue;
      let hole = false;
      for (const h of poly.holes) if (pointInRing(lon, lat, h)) { hole = true; break; }
      if (!hole) return w;
    }
  }
  return null;
}

// ---------------------------------------------------------------- land-use split per cell (z15 basemap)
const BASEMAP_Z = region.basemap.tileZoomMax;
const perParent = 2 ** (BASEMAP_Z - Z);
const cellsPerSide = CPT / perParent;
const RES = new Set(['residential']);
const COM = new Set(['commercial', 'retail', 'office']);
const IND = new Set(['industrial', 'port', 'quarry', 'warehouse']);
const CELL_M = index.cellMetres;                    // ~99.3 m grid pitch
const CELL_AREA_M2 = CELL_M * CELL_M;
const luAccum = new Map(); // "tx:ty" -> Float32Array(CPT*CPT*3) [res, com, ind]
function lu(tx, ty) {
  const key = `${tx}:${ty}`;
  let a = luAccum.get(key);
  if (!a) {
    a = new Float32Array(CPT * CPT * 3);
    luAccum.set(key, a);
  }
  return a;
}
const metresPerPixel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

function shoelace(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return Math.abs(a / 2);
}

const tilesDir = path.join(DATA, 'tiles', String(BASEMAP_Z));
for (const xDir of fs.readdirSync(tilesDir)) {
  const xPath = path.join(tilesDir, xDir);
  if (!fs.statSync(xPath).isDirectory()) continue;
  for (const yFile of fs.readdirSync(xPath)) {
    if (!yFile.endsWith('.mvt')) continue;
    const x = Number(xDir);
    const y = Number(path.basename(yFile, '.mvt'));
    const parentTx = Math.floor(x / perParent);
    const parentTy = Math.floor(y / perParent);
    const parentKey = `${parentTx}:${parentTy}`;
    if (!luAccum.has(parentKey) && !fs.existsSync(path.join(DATA, 'score', String(Z), String(parentTx), `${parentTy}.json`))) continue;
    let vt;
    try {
      vt = new VectorTile(new Pbf(fs.readFileSync(path.join(xPath, yFile))));
    } catch {
      continue;
    }
    const landuse = vt.layers.landuse;
    if (!landuse) continue;
    const a = lu(parentTx, parentTy);
    const offX = (x - parentTx * perParent) * cellsPerSide;
    const offY = (y - parentTy * perParent) * cellsPerSide;
    for (let i = 0; i < landuse.length; i++) {
      const kind = landuse.feature(i).properties.kind;
      const which = RES.has(kind) ? 0 : COM.has(kind) ? 1 : IND.has(kind) ? 2 : -1;
      if (which < 0) continue;
      const geom = landuse.feature(i).loadGeometry();
      if (!geom.length || !geom[0].length) continue;
      // rasterise by sampling the polygon's bbox grid cells (centre-point test)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of geom[0]) {
        if (pt.x < minX) minX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y > maxY) maxY = pt.y;
      }
      const cx0 = Math.max(0, Math.floor((minX / 4096) * cellsPerSide));
      const cx1 = Math.min(cellsPerSide - 1, Math.floor((maxX / 4096) * cellsPerSide));
      const cy0 = Math.max(0, Math.floor((minY / 4096) * cellsPerSide));
      const cy1 = Math.min(cellsPerSide - 1, Math.floor((maxY / 4096) * cellsPerSide));
      const rings = geom;
      const inPolys = (px, py) => {
        let inside = false;
        for (const ring of rings) {
          let inRing = false;
          for (let i2 = 0, j2 = ring.length - 1; i2 < ring.length; j2 = i2++) {
            const xi = ring[i2].x, yi = ring[i2].y, xj = ring[j2].x, yj = ring[j2].y;
            if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inRing = !inRing;
          }
          if (inRing) inside = !inside; // even-odd across rings
        }
        return inside;
      };
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = ((cx + 0.5) / cellsPerSide) * 4096;
          const py = ((cy + 0.5) / cellsPerSide) * 4096;
          if (!inPolys(px, py)) continue;
          a[((offY + cy) * CPT + (offX + cx)) * 3 + which] += CELL_AREA_M2; // cell-centre test: whole cell counts
        }
      }
    }
  }
}

// ---------------------------------------------------------------- main join: cells x years x wards
const wardTable = new Map(); // ward -> per-year accumulators
function wacc(wardNo, zone) {
  let w = wardTable.get(wardNo);
  if (!w) {
    w = { ward: wardNo, zone, years: {} };
    for (const y of index.years) {
      w.years[y.key] = { people: 0, peopleSevere: 0, buildings: 0, roadM: 0, crit: 0, cells: 0 };
    }
    wardTable.set(wardNo, w);
  }
  return w;
}

const citySplit = { res: 0, com: 0, ind: 0 };
const citySplitWet = {}; // year -> {res, com, ind}
for (const y of index.years) citySplitWet[y.key] = { res: 0, com: 0, ind: 0 };

const scoreDir = path.join(DATA, 'score', String(Z));
let unassigned = 0;
let assigned = 0;
for (const xDir of fs.readdirSync(scoreDir)) {
  const xPath = path.join(scoreDir, xDir);
  if (!fs.statSync(xPath).isDirectory()) continue;
  for (const yFile of fs.readdirSync(xPath)) {
    if (!yFile.endsWith('.json')) continue;
    const tx = Number(xDir);
    const ty = Number(path.basename(yFile, '.json'));
    const tile = readJson(path.relative(ROOT, path.join(xPath, yFile)));
    if (tile.n !== NF) continue;
    const luArr = luAccum.get(`${tx}:${ty}`);
    for (let ci = 0; ci < CPT * CPT; ci++) {
      const o = ci * NF;
      if (tile.c[o + F.MASK] > 0) continue;
      const pop = tile.c[o + F.POP] || 0;
      const bldc = tile.c[o + F.BLDC] || 0;
      const roadd = tile.c[o + F.ROADD] || 0;
      const crit = (F.CRIT !== undefined ? tile.c[o + F.CRIT] : 0) || 0;
      if (pop <= 0 && bldc <= 0 && roadd <= 0 && crit <= 0) continue;
      const cx = ci % CPT;
      const cy = Math.floor(ci / CPT);
      const gx = tx * CPT + cx;
      const gy = ty * CPT + cy;
      const lon = cellLon(gx);
      const lat = cellLat(gy);
      const w = wardOf(lon, lat);
      if (!w) { unassigned++; continue; }
      assigned++;
      const acc = wacc(w.ward, w.zone);

      // land-use split (citywide): all wet built-up area this year
      if (luArr) {
        const res = luArr[ci * 3], com = luArr[ci * 3 + 1], ind = luArr[ci * 3 + 2];
        citySplit.res += res; citySplit.com += com; citySplit.ind += ind;
        for (let k = 0; k < 5; k++) {
          const depth = (tile.c[o + F.DEPTH + k] ?? 0) / 100;
          if (depth >= AFFECTED_M) {
            citySplitWet[index.years[k].key].res += res;
            citySplitWet[index.years[k].key].com += com;
            citySplitWet[index.years[k].key].ind += ind;
          }
        }
      }

      for (let k = 0; k < 5; k++) {
        const depth = (tile.c[o + F.DEPTH + k] ?? 0) / 100;
        if (depth < AFFECTED_M) continue;
        const severe = depth >= SEVERE_M;
        const y = acc.years[index.years[k].key];
        y.people += pop;
        y.buildings += bldc;
        y.roadM += roadd;
        y.crit += crit;
        y.cells++;
        if (severe) {
          y.peopleSevere += pop;
        }
      }
    }
  }
}

const years = index.years.map((y) => y.key);
const wardRows = [...wardTable.values()].map((w) => {
  const row = { ward: w.ward, zone: w.zone, cx: null, cy: null };
  for (const key of years) {
    const y = w.years[key];
    row[`${key}_people`] = Math.round(y.people);
    row[`${key}_people_severe`] = Math.round(y.peopleSevere);
    row[`${key}_buildings`] = Math.round(y.buildings);
    row[`${key}_road_km`] = Math.round(y.roadM / 100) / 10;
    row[`${key}_crit`] = Math.round(y.crit);
  }
  return row;
}).sort((a, b) => b.today_people - a.today_people);
for (const row of wardRows) {
  const w = wardTable.get(row.ward);
  const wDef = wards.find((d) => d.ward === row.ward);
  if (wDef) {
    const c = centroid(wDef.polys);
    if (c) { row.cx = Math.round(c[0] * 1000) / 1000; row.cy = Math.round(c[1] * 1000) / 1000; }
  }
}

const out = {
  region: region.id,
  thresholds: { affectedM: AFFECTED_M, severeM: SEVERE_M },
  landUse: {
    basis: 'OSM landuse polygons rasterised to the 100 m grid; affected = cell wet in that year',
    cityTotalKm2: { residential: roundKm2(citySplit.res), commercial: roundKm2(citySplit.com), industrial: roundKm2(citySplit.ind) },
    perYearWetKm2: Object.fromEntries(years.map((k) => [k, {
      residential: roundKm2(citySplitWet[k].res),
      commercial: roundKm2(citySplitWet[k].com),
      industrial: roundKm2(citySplitWet[k].ind),
    }])),
  },
  wards: wardRows,
  cellsAssigned: assigned,
  cellsOutsideWards: unassigned,
};
const size = writeJson('data/exposure-wards.json', out);
log(`wards: ${wardRows.length} · cells assigned ${assigned}, outside ward polygons ${unassigned}`);
const top3 = wardRows.slice(0, 3).map((r) => `Ward ${r.ward} (${r.zone}): ${r.today_people.toLocaleString('en-IN')} people today`).join(' · ');
log(`top: ${top3}`);
log(`land use wet today: res ${(out.landUse.perYearWetKm2.today.residential)} km² · com ${out.landUse.perYearWetKm2.today.commercial} km² · ind ${out.landUse.perYearWetKm2.today.industrial} km²`);
log(`wrote data/exposure-wards.json (${(size / 1024).toFixed(0)} KB)`);

function roundKm2(v) {
  return Math.round(v / 10000) / 100; // m2 -> km2, 2dp
}

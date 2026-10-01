// 14 — Emergency routes: road graph from the baked basemap tiles + least-risk vs shortest paths.
//
// PS 1.1: "identify suitable emergency routes during disasters … least-risk route, not simply
// shortest." This script builds a routable road graph from the SAME offline z15 MVT tiles the map
// already serves, attaches a per-year flood risk to every edge by sampling the packed score grid,
// then bakes, for a set of high-risk origin neighbourhoods, the route to their nearest hospitals
// and relief shelters TWICE: plain shortest distance, and least cumulative risk. The app just
// draws the pair and reads the receipt numbers — no routing math in the browser, so it stays
// instant and fully offline.
//
// Edge weight (least-risk): W = km × (1 + 2×risk + 3×severe) where risk = flood score/10 and
// severe = 1 when modelled depth ≥ 0.6 m (waist-deep: effectively impassable). Distance still
// dominates when roads are dry; flooded roads get priced out.
//
// Writes: data/routes/routes.json (precomputed route pairs + hospital/shelter POIs)
//         data/routes/graph-meta.json (graph stats for verify) · logs the risk-class km totals.
import fs from 'node:fs';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import PbfMod from 'pbf';
import { DATA, log, readJson, writeJson, loadRegion, tilesInBbox, x2lon, y2lat } from './lib.mjs';
// x2lon/y2lat (tile-corner math at real tile zooms) stay for the MVT geometry conversion below.

const Pbf = PbfMod.default ?? PbfMod;
const region = loadRegion(process.argv[2]);
const [S, W, N, E] = region.bbox;
const BASEMAP_Z = region.basemap.tileZoomMax;
const index = readJson('data/score/index.json');
const F = index.fields;
const Z = index.gridZoom;
const CPT = index.cellsPerTile;
const world = 2 ** (Z + Math.log2(CPT));

const SEVERE_DEPTH_M = 0.6;   // waist-deep
const ROAD_KINDS = new Set(['highway', 'major_road', 'minor_road']);
const HOSPITAL_KINDS = new Set(['hospital', 'clinic', 'doctors']);
// PS 1.1 inputs name "hospitals, shelters". Chennai's designated relief shelters are overwhelmingly
// schools and community halls, so OSM's education kinds count as shelters here — labelled as such.
const SHELTER_KINDS = new Set(['shelter', 'community_centre', 'school', 'college', 'university', 'kindergarten']);
const ORIGINS = [
  { id: 'velachery', label: 'Velachery — Sadasiva Nagar', lon: 80.20432, lat: 12.96218 },
  { id: 'taramani', label: 'Taramani — beside Pallikaranai marsh', lon: 80.23911, lat: 12.99162 },
  { id: 'ambattur', label: 'Ambattur — worst ward for exposure', lon: 80.15671, lat: 13.09954 },
];
const perOrigin = 2;

const metresPerPixel = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;

// ---------------------------------------------------------------- score lookup (packed tiles)
const scoreTiles = new Map();
const scoreBase = path.join(DATA, 'score', String(Z));
for (const xDir of fs.readdirSync(scoreBase)) {
  const full = path.join(scoreBase, xDir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const yFile of fs.readdirSync(full)) {
    if (!yFile.endsWith('.json')) continue;
    scoreTiles.set(`${xDir}:${yFile.replace('.json', '')}`, JSON.parse(fs.readFileSync(path.join(full, yFile), 'utf8')));
  }
}

const cellCache = new Map();
function cellAt(lon, lat) {
  const gx = Math.floor(((lon + 180) / 360) * world);
  const r = (lat * Math.PI) / 180;
  const gy = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world);
  const key = gx * 1000000 + gy;
  if (cellCache.has(key)) return cellCache.get(key);
  const tile = scoreTiles.get(`${Math.floor(gx / CPT)}:${Math.floor(gy / CPT)}`);
  let cell = null;
  if (tile) {
    const o = ((gy % CPT) * CPT + (gx % CPT)) * tile.n;
    if (!tile.c[o + F.MASK]) {
      cell = {
        elev: tile.c[o + F.ELEV] ?? 0,
        hazard: [0, 1, 2, 3, 4].map((k) => (tile.c[o + F.HAZ + k] ?? 0) / 100),
        depth: [0, 1, 2, 3, 4].map((k) => (tile.c[o + F.DEPTH + k] ?? 0) / 100),
      };
    }
  }
  cellCache.set(key, cell);
  return cell;
}

function riskAt(lon, lat, k) {
  const cell = cellAt(lon, lat);
  if (!cell) return { risk: 0, depth: 0 };
  return { risk: Math.min(1, cell.hazard[k] ?? 0), depth: cell.depth[k] ?? 0 };
}

// ---------------------------------------------------------------- graph build
// grid lon/lat: the score grid is NOT a power-of-two zoom (world = 2^zoom × cellsPerTile),
// so the lib tile helpers do not apply — invert the Web-Mercator formulas against `world` directly.
const lonOfGx = (gx) => (gx / world) * 360 - 180;
const latOfGy = (gy) => {
  const n = Math.PI - (2 * Math.PI * gy) / world;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const nodes = new Map(); // key "gx:gy" -> { lon, lat, edges: Map(neighborKey -> edge) }
const keyOf = (gx, gy) => gx * 1000000 + gy; // gy stays below 1e6 worldwide, so keys cannot collide
function nodeAt(lon, lat) {
  const gx = Math.round(((lon + 180) / 360) * world);
  const r = (lat * Math.PI) / 180;
  const gy = Math.round(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world);
  const key = keyOf(gx, gy);
  let n = nodes.get(key);
  if (!n) {
    n = { lon: lonOfGx(gx), lat: latOfGy(gy), edges: new Map() };
    nodes.set(key, n);
  }
  return key;
}

function roadRank(kind, detail) {
  if (kind === 'highway') return 0;
  if (kind === 'major_road') return 1;
  if (detail === 'primary' || detail === 'secondary') return 2;
  return 3;
}

const tiles = tilesInBbox([S, W, N, E], BASEMAP_Z);
let segments = 0;
let roadsKept = 0;
let tilesRead = 0;
for (const [z, x, y] of tiles) {
  const file = path.join(DATA, 'tiles', String(z), String(x), `${y}.mvt`);
  if (!fs.existsSync(file)) continue;
  let vt;
  try {
    vt = new VectorTile(new Pbf(fs.readFileSync(file)));
  } catch {
    continue;
  }
  const roads = vt.layers.roads;
  if (!roads) continue;
  tilesRead++;
  const mPerUnit = (256 * metresPerPixel(y2lat(y + 0.5, z), z)) / roads.extent;
  const xOff = x2lon(x, z);
  const yOffN = y2lat(y, z);
  const dLon = x2lon(x + 1, z) - xOff;
  const dLat = y2lat(y + 1, z) - yOffN;
  for (let i = 0; i < roads.length; i++) {
    const f = roads.feature(i);
    if (!ROAD_KINDS.has(f.properties.kind)) continue;
    const geom = f.loadGeometry();
    if (!geom.length) continue;
    roadsKept++;
    const rank = roadRank(f.properties.kind, f.properties.kind_detail);
    for (const line of geom) {
      let prevKey = null;
      for (let p = 0; p < line.length; p++) {
        const lon = xOff + (line[p].x / roads.extent) * dLon;
        const lat = yOffN + (line[p].y / roads.extent) * dLat;
        const key = nodeAt(lon, lat);
        if (prevKey !== null && key !== prevKey) {
          const a = nodes.get(prevKey);
          const b = nodes.get(key);
          const dx = ((b.lon - a.lon) * Math.PI / 180) * 6371000 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
          const dy = (b.lat - a.lat) * Math.PI / 180 * 6371000;
          const len = Math.hypot(dx, dy);
          if (len > 0.5) {
            const midLon = (a.lon + b.lon) / 2;
            const midLat = (a.lat + b.lat) / 2;
            const perYear = [];
            for (let k = 0; k < index.years.length; k++) perYear.push(riskAt(midLon, midLat, k));
            const edge = { to: key, len, rank, coords: [[a.lon, a.lat], [b.lon, b.lat]], perYear };
            if (!a.edges.has(key)) a.edges.set(key, edge);
            if (!b.edges.has(prevKey)) b.edges.set(prevKey, edge);
            segments++;
          }
        }
        prevKey = key;
      }
    }
  }
}
log(`graph: ${nodes.size.toLocaleString('en-IN')} nodes · ${segments.toLocaleString('en-IN')} edge pairs from ${roadsKept.toLocaleString('en-IN')} road lines in ${tilesRead} tiles`);

// ---------------------------------------------------------------- destinations: hospitals + shelters
const dests = [];
for (const [z, x, y] of tiles) {
  const file = path.join(DATA, 'tiles', String(z), String(x), `${y}.mvt`);
  if (!fs.existsSync(file)) continue;
  let vt;
  try {
    vt = new VectorTile(new Pbf(fs.readFileSync(file)));
  } catch {
    continue;
  }
  const pois = vt.layers.pois;
  if (!pois) continue;
  const xOff = x2lon(x, z);
  const yOffN = y2lat(y, z);
  const dLon = x2lon(x + 1, z) - xOff;
  const dLat = y2lat(y + 1, z) - yOffN;
  for (let i = 0; i < pois.length; i++) {
    const f = pois.feature(i);
    const kind = f.properties.kind;
    const isHosp = HOSPITAL_KINDS.has(kind);
    const isShelt = SHELTER_KINDS.has(kind);
    if (!isHosp && !isShelt) continue;
    const geom = f.loadGeometry();
    if (!geom.length || !geom[0].length) continue;
    const pt = geom[0][0];
    dests.push({
      lon: xOff + (pt.x / pois.extent) * dLon,
      lat: yOffN + (pt.y / pois.extent) * dLat,
      kind,
      role: isHosp ? 'hospital' : 'shelter',
      name: f.properties.name || null,
    });
  }
}
log(`destinations: ${dests.filter((d) => d.role === 'hospital').length.toLocaleString('en-IN')} hospitals/clinics · ${dests.filter((d) => d.role === 'shelter').length.toLocaleString('en-IN')} shelters/community centres`);

function nearestNode(lon, lat) {
  const gx0 = Math.round(((lon + 180) / 360) * world);
  const r = (lat * Math.PI) / 180;
  const gy0 = Math.round(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * world);
  for (let rad = 1; rad <= 8; rad++) {
    let best = null;
    let bestD = Infinity;
    for (let gx = gx0 - rad; gx <= gx0 + rad; gx++) {
      for (let gy = gy0 - rad; gy <= gy0 + rad; gy++) {
        if (!nodes.has(keyOf(gx, gy))) continue;
        const n = nodes.get(keyOf(gx, gy));
        const d = Math.hypot((n.lon - lon) * 92000 * Math.cos(lat * Math.PI / 180), (n.lat - lat) * 111000);
        if (d < bestD) {
          bestD = d;
          best = keyOf(gx, gy);
        }
      }
    }
    if (best !== null && bestD < 220 * rad) return best;
  }
  return null;
}

function dijkstra(startKey, k, mode) {
  const dists = new Map([[startKey, 0]]);
  const prev = new Map();
  const done = new Set();
  // binary heap of [dist, key]
  const heap = [[0, startKey]];
  const push = (d, key) => {
    heap.push([d, key]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const rgt = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (rgt < heap.length && heap[rgt][0] < heap[m][0]) m = rgt;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, key] = pop();
    if (done.has(key)) continue;
    done.add(key);
    const node = nodes.get(key);
    if (!node) continue;
    for (const [nKey, edge] of node.edges) {
      if (done.has(nKey)) continue;
      const py = edge.perYear[k] ?? { risk: 0, depth: 0 };
      let w = edge.len;
      if (mode === 'least-risk') w *= 1 + 2 * py.risk + 3 * (py.depth >= SEVERE_DEPTH_M ? 1 : 0);
      const nd = d + w;
      if (nd < (dists.get(nKey) ?? Infinity)) {
        dists.set(nKey, nd);
        prev.set(nKey, { key, edge });
        push(nd, nKey);
      }
    }
  }
  return { dists, prev };
}

function pathBetween(prev, startKey, destKey) {
  const path = [];
  let cur = destKey;
  let hops = 0;
  while (cur !== startKey && prev.has(cur) && hops++ < 500000) {
    const step = prev.get(cur);
    path.push(step.edge);
    cur = step.key;
  }
  if (cur !== startKey) return null;
  path.reverse();
  return path;
}

// label the route at a point that is safely past the shared frontage
function labelOnPath(pathEdges) {
  let acc = 0;
  const total = pathEdges.reduce((s, e) => s + e.len, 0);
  const want = Math.min(400, total * 0.4);
  for (const e of pathEdges) {
    acc += e.len;
    if (acc >= want) return e.coords[1];
  }
  return pathEdges.length ? pathEdges[pathEdges.length - 1].coords[1] : null;
}

const yearKeys = index.years.map((y) => y.key);
const results = [];
const riskClassKm = yearKeys.map(() => ({ dry: 0, wet: 0, severe: 0 }));

for (const origin of ORIGINS) {
  const startKey = nearestNode(origin.lon, origin.lat);
  if (startKey === null) {
    log(`  ! no road node within reach of ${origin.label} — skipped`);
    continue;
  }
  log(`origin: ${origin.label}`);
  const pool = [];
  for (const d of dests) {
    const nKey = nearestNode(d.lon, d.lat);
    if (nKey === null) continue;
    pool.push({ ...d, nKey, snapKm: 0 });
  }
  // snap distance for honesty check
  for (const p of pool) {
    const n = nodes.get(p.nKey);
    p.snapKm = Math.hypot((n.lon - p.lon) * 92, (n.lat - p.lat) * 111) / 1000;
  }
  for (let k = 0; k < yearKeys.length; k++) {
    const shortRun = dijkstra(startKey, k, 'shortest');
    const riskRun = dijkstra(startKey, k, 'least-risk');
    // nearest by shortest-distance to any hospital, then to any shelter
    for (const role of ['hospital', 'shelter']) {
      for (const mode of ['shortest', 'least-risk']) {
        const run = mode === 'shortest' ? shortRun : riskRun;
        let best = null;
        for (const p of pool) {
          if (p.role !== role) continue;
          const d = run.dists.get(p.nKey);
          if (d === undefined) continue;
          const km = (d / 1000) + p.snapKm;
          if (!best || km < best.km) best = { ...p, km };
        }
        if (!best) continue;
        const edges = pathBetween(run.prev, startKey, best.nKey);
        if (!edges || edges.length < 2) continue;
        // receipt numbers along the path (shortest-distance km regardless of mode)
        const shortD = shortRun.dists.get(best.nKey);
        if (shortD === undefined) continue;
        let totalKm = shortD / 1000 + best.snapKm;
        let riskKm = 0;
        let severeKm = 0;
        let maxDepth = 0;
        let riskSum = 0;
        let edgeLen = 0;
        for (const e of edges) {
          const py = e.perYear[k] ?? { risk: 0, depth: 0 };
          riskSum += py.risk * e.len;
          edgeLen += e.len;
          if (py.depth >= 0.15) riskKm += e.len / 1000;
          if (py.depth >= SEVERE_DEPTH_M) severeKm += e.len / 1000;
          if (py.depth > maxDepth) maxDepth = py.depth;
        }
        if (mode === 'shortest') {
          const st = riskClassKm[k];
          for (const e of edges) {
            const py = e.perYear[k] ?? { risk: 0, depth: 0 };
            if (py.depth >= SEVERE_DEPTH_M) st.severe += e.len / 1000;
            else if (py.depth >= 0.15) st.wet += e.len / 1000;
            else st.dry += e.len / 1000;
          }
        }
        const labelAt = labelOnPath(edges);
        if (mode === 'least-risk' || !results.some((r) => r.origin === origin.id && r.year === yearKeys[k] && r.role === role)) {
          results.push({
            origin: origin.id,
            originLabel: origin.label,
            originLonLat: [origin.lon, origin.lat],
            year: yearKeys[k],
            role,
            mode,
            dest: { name: best.name, kind: best.kind, lonLat: [best.lon, best.lat], snapM: Math.round(best.snapKm * 1000) },
            labelAt,
            km: Math.round(totalKm * 10) / 10,
            riskKm: Math.round(riskKm * 10) / 10,
            severeKm: Math.round(severeKm * 10) / 10,
            maxDepth: Math.round(maxDepth * 100) / 100,
            avgRisk: edgeLen ? Math.round((riskSum / edgeLen) * 100) / 100 : 0,
            edges: edges.map((e) => ({
              c: [e.coords[0][0], e.coords[0][1], e.coords[1][0], e.coords[1][1]],
              d: Math.round(((e.perYear[k] ?? {}).depth ?? 0) * 100) / 100,
              s: Math.round(((e.perYear[k] ?? {}).risk ?? 0) * 100) / 100,
            })),
          });
        }
      }
    }
    log(`  ${yearKeys[k]}: baked hospital+shelter routes (shortest & least-risk)`);
  }
}

// ---------------------------------------------------------------- write
writeJson('data/routes/routes.json', {
  built: new Date().toISOString(),
  region: region.id,
  years: yearKeys,
  note: 'least-risk weight = km * (1 + 2*risk + 3*severe[depth>=0.6m]); risk = packed flood hazard per 100 m cell sampled at edge midpoints',
  origins: ORIGINS.map((o) => ({ id: o.id, label: o.label, lonLat: [o.lon, o.lat] })),
  routes: results,
}, true);

const graphMeta = {
  nodes: nodes.size,
  edges: segments,
  roadLines: roadsKept,
  tiles: tilesRead,
  hospitals: dests.filter((d) => d.role === 'hospital').length,
  shelters: dests.filter((d) => d.role === 'shelter').length,
  routeCount: results.length,
};
fs.mkdirSync(path.join(DATA, 'routes'), { recursive: true });
fs.writeFileSync(path.join(DATA, 'routes', 'graph-meta.json'), JSON.stringify(graphMeta));

log('');
log('route receipts (today):');
for (const r of results.filter((r) => r.year === 'today')) {
  log(`  ${r.originLabel} → ${r.dest.name || r.dest.kind} (${r.mode}, ${r.role}): ${r.km} km · ${r.riskKm} km wet · ${r.severeKm} km severe · max depth ${r.maxDepth} m`);
}
log('');
log('shortest-route risk split per year (the case for least-risk):');
yearKeys.forEach((k, i) => {
  const st = riskClassKm[i];
  const total = st.dry + st.wet + st.severe;
  log(`  ${k}: ${st.dry.toFixed(1)} km dry · ${st.wet.toFixed(1)} km in water · ${st.severe.toFixed(1)} km in ≥0.6 m water (of ${total.toFixed(1)} km)`);
});
log('done');

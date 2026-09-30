// 07 — Bundle.
// Promotes the chosen layer for each slider year out of the raw cache into data/flood, simplifes it
// enough for a phone, and writes the receipts index the app shows next to every year. Then it checks
// that every file the app will ask for actually exists, and refuses to bless the build otherwise.
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, CACHE, DATA, log, writeJson, readJson, loadRegion, human,
  bboxOfGeometry, eachPolygon, round,
} from './lib.mjs';

const region = loadRegion(process.argv[2]);
const catalog = readJson('data/flood-catalog.json').catalog;
const receipts = readJson('data/receipts.json');
const scoreIndex = readJson('data/score/index.json');

const SELECTED = [
  { key: '2005', title: 'Chennai GCC Flood Extent 2005', tolerance: 1e-5, label: '2005 — GCC flood extent', source: 'Greater Chennai Corporation, published via opencity.in', rainfallEvent: '2005' },
  { key: '2015', title: 'Chennai 2015 Floods Inundation Zone ', tolerance: 1e-5, label: '2015 — NRSC flood inundation zone', source: 'National Remote Sensing Centre, published via opencity.in', rainfallEvent: '2015' },
  { key: '2020', title: 'Chennai GCC Flood Hostspots 2020', tolerance: 1e-5, label: '2020 — Cyclone Nivar hotspots', source: 'Greater Chennai Corporation, published via opencity.in', rainfallEvent: '2020' },
  {
    key: 'today', title: 'Chennai Flood Hazard Zones Map', tolerance: 1.5e-5, keepCategory: /high|moderate/i,
    label: 'Today — GCC flood hazard zoning (High + Moderate)', source: 'Greater Chennai Corporation, published via opencity.in', rainfallEvent: '2023',
  },
  { key: '2070', title: 'Chennai Flows 200 Years Return Period', tolerance: 1e-5, label: '2070 — 200-year return period corridors', source: 'Greater Chennai Corporation flow mapping, published via opencity.in', rainfallEvent: '2015' },
];

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Shoelace on lon/lat, good enough for a headline number at city scale. */
function ringAreaKm2(ring) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    total += rad(ring[i][0] - ring[j][0]) * (2 + Math.sin(rad(ring[j][1])) + Math.sin(rad(ring[i][1])));
  }
  return Math.abs((total * R * R) / 2);
}

function simplify(ring, tolerance) {
  if (ring.length < 5) return ring;
  const t2 = tolerance * tolerance;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    const [x1, y1] = ring[first];
    const [x2, y2] = ring[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const denom = dx * dx + dy * dy;
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = ring[i];
      let dist;
      if (denom === 0) {
        dist = (px - x1) ** 2 + (py - y1) ** 2;
      } else {
        let t = ((px - x1) * dx + (py - y1) * dy) / denom;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        dist = (px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2;
      }
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > t2 && index > 0) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out = ring.filter((_, i) => keep[i]);
  return out.length >= 4 ? out : ring;
}

const index = { region: region.id, generated: new Date().toISOString(), years: [] };

for (const selection of SELECTED) {
  const entry = catalog.find((c) => c.title === selection.title);
  if (!entry || !entry.features) {
    log(`!! ${selection.title} not in the cache — run pipeline/03 first`);
    continue;
  }
  const raw = JSON.parse(fs.readFileSync(path.join(CACHE, 'flood', `${slugify(selection.title)}.json`), 'utf8'));
  const features = [];
  let areaKm2 = 0;
  let dropped = 0;

  for (const feature of raw.features) {
    const category = String(feature.properties?.CATEGORY ?? '');
    if (selection.keepCategory && !selection.keepCategory.test(category)) {
      dropped++;
      continue;
    }
    const geom = feature.geometry;
    if (!geom) continue;
    let rings;
    if (geom.type === 'Point') {
      features.push({ type: 'Feature', properties: {}, geometry: geom });
      continue;
    }
    if (geom.type === 'Polygon') rings = [geom.coordinates];
    else if (geom.type === 'MultiPolygon') rings = geom.coordinates;
    else continue;

    const simplifiedRings = [];
    for (const polygon of rings) {
      const simplifiedPolygon = polygon.map((ring) => simplify(ring, selection.tolerance ?? 1e-5));
      const outer = simplifiedPolygon[0];
      if (outer && outer.length >= 4) {
        simplifiedRings.push(simplifiedPolygon);
        areaKm2 += ringAreaKm2(outer);
      }
    }
    if (!simplifiedRings.length) continue;
    features.push({
      type: 'Feature',
      properties: category ? { category: category.toLowerCase() } : {},
      geometry: simplifiedRings.length === 1
        ? { type: 'Polygon', coordinates: simplifiedRings[0] }
        : { type: 'MultiPolygon', coordinates: simplifiedRings },
    });
  }

  const bytes = writeJson(`data/flood/${selection.key}.json`, {
    type: 'FeatureCollection',
    features,
  });
  const event = receipts.events[selection.rainfallEvent];
  index.years.push({
    key: selection.key,
    label: selection.label,
    source: selection.source,
    sourceUrl: entry.source,
    dataset: entry.dataset,
    license: entry.license,
    publishedFeatures: entry.features,
    featuresInApp: features.length,
    droppedForCategory: dropped,
    publishedAreaKm2: round(areaKm2, 1),
    bytes,
    file: `data/flood/${selection.key}.json`,
    rainfall: event
      ? {
        label: event.label,
        window: event.window,
        totalMm: event.totalMm,
        maxDailyMm: event.maxDailyMm,
        maxDailyDate: event.maxDailyDate,
        source: event.source,
        role: selection.key === 'today'
          ? 'most recent comparable event'
          : selection.key === '2070'
            ? 'design storm: 2015 rainfall replayed'
            : 'rainfall during this event',
      }
      : null,
  });
  log(`${selection.key.padEnd(6)} ${String(features.length).padStart(5)} features, ${String(round(areaKm2, 1)).padStart(6)} km² published, ${human(bytes)} -> data/flood/${selection.key}.json`);
}

// Measured depth points travel as their own evidence layer.
const measuredFile = path.join(CACHE, 'flood', 'chennai-inundation-points-with-depth-of-indonation.json');
const measuredSrc = path.join(CACHE, 'flood', 'chennai-inundation-points-with-depth-of-inundation.json');
if (fs.existsSync(measuredSrc)) {
  const raw = JSON.parse(fs.readFileSync(measuredSrc, 'utf8'));
  const features = raw.features
    .filter((f) => f.geometry?.type === 'Point')
    .map((f) => ({
      type: 'Feature',
      properties: { inches: Number(f.properties?.DEPTH ?? 0), remark: String(f.properties?.F_REMARKS ?? '').slice(0, 60) },
      geometry: f.geometry,
    }));
  const bytes = writeJson('data/flood/measured.json', { type: 'FeatureCollection', features });
  index.measured = {
    label: 'Measured inundation depths',
    source: 'GCC via opencity.in — depth published in inches',
    count: features.length,
    maxInches: Math.max(...features.map((f) => f.properties.inches)),
    note: 'The published record carries no event date, so this is shown as evidence of depth, never as a timeline stop.',
    bytes,
  };
  log(`measured ${features.length} depth points (max ${index.measured.maxInches} in) -> data/flood/measured.json`);
}

writeJson('data/flood/index.json', index, true);
writeJson('data/receipts-summary.json', {
  normals: receipts.normals,
  citations: receipts.citations,
  events: Object.fromEntries(Object.entries(receipts.events).map(([year, e]) => [year, {
    label: e.label, window: e.window, totalMm: e.totalMm, maxDailyMm: e.maxDailyMm, maxDailyDate: e.maxDailyDate,
  }])),
}, true);

// ---------------------------------------------------------------- demo areas (always fresh from the region config)
const demoAreas = region.demoAreas.map((area) => ({
  id: area.id,
  label: area.label,
  subtitle: area.subtitle || '',
  whyShort: area.whyShort,
  preset: area.preset,
  bbox: area.bbox,
  center: [round((area.bbox[1] + area.bbox[3]) / 2, 5), round((area.bbox[0] + area.bbox[2]) / 2, 5)],
}));
writeJson('data/demo-areas.json', {
  note: 'Curated from data/regions.json and cross-checked against the score grid (data/score/demo-snapshot.json).',
  areas: demoAreas,
}, true);
log(`demo areas resolved: ${demoAreas.map((a) => a.label).join(', ')}`);

// ---------------------------------------------------------------- manifest + integrity check
const REQUIRED = [
  'index.html', 'app.js', 'map.js', 'score.js', 'three-d.js', 'style.css',
  'data/regions.json',
  'data/basemap-light.json', 'data/basemap-dark.json',
  'data/vendor/maplibre-gl.js', 'data/vendor/maplibre-gl.css',
  'data/score/index.json', 'data/places.json', 'data/wetlands.geojson',
  'data/flood/index.json', 'data/flood/measured.json',
  'data/receipts-summary.json', 'data/demo-areas.json',
  ...SELECTED.map((s) => `data/flood/${s.key}.json`),
];

const missing = [];
let totalBytes = 0;
const dirSize = (dir) => {
  let sum = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sum += dirSize(full);
    else sum += fs.statSync(full).size;
  }
  return sum;
};

for (const rel of REQUIRED) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) missing.push(rel);
  else totalBytes += fs.statSync(abs).size;
}

const sizes = {
  basemapTiles: fs.existsSync(path.join(DATA, 'tiles')) ? dirSize(path.join(DATA, 'tiles')) : 0,
  terrain: fs.existsSync(path.join(DATA, 'terrain')) ? dirSize(path.join(DATA, 'terrain')) : 0,
  scoreGrid: fs.existsSync(path.join(DATA, 'score')) ? dirSize(path.join(DATA, 'score')) : 0,
  floodLayers: fs.existsSync(path.join(DATA, 'flood')) ? dirSize(path.join(DATA, 'flood')) : 0,
  fonts: fs.existsSync(path.join(DATA, 'fonts')) ? dirSize(path.join(DATA, 'fonts')) : 0,
  sprites: fs.existsSync(path.join(DATA, 'sprites')) ? dirSize(path.join(DATA, 'sprites')) : 0,
};
const payload = Object.values(sizes).reduce((a, b) => a + b, 0);

// Nothing in the shipped app may point at an absolute path: the site has to work from any subfolder.
const absolutePathHits = [];
const appFiles = ['index.html', 'app.js', 'map.js', 'score.js', 'three-d.js', 'style.css'];
for (const file of appFiles) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  const matches = text.match(/(?:src|href|url|fetch)\s*[=(]\s*["'`]\/(?!\/)[^"'`]*/g);
  if (matches) absolutePathHits.push({ file, matches: matches.slice(0, 5) });
}

const demo = readJson('data/score/demo-snapshot.json');
const manifest = {
  built: new Date().toISOString(),
  region: region.id,
  regionName: region.name,
  years: index.years.map((y) => y.key),
  grid: { zoom: scoreIndex.gridZoom, cellMetres: scoreIndex.cellMetres, cells: scoreIndex.cellsScored, tiles: scoreIndex.tiles },
  sizes,
  payloadBytes: payload,
  offline: {
    required: REQUIRED.map((rel) => ({ path: rel, bytes: fs.existsSync(path.join(ROOT, rel)) ? fs.statSync(path.join(ROOT, rel)).size : 0 })),
    wholeDataFolderBytes: dirSize(DATA),
  },
  attribution: receipts.citations,
};
writeJson('data/manifest.json', manifest, true);

log('');
log(`payload: ${human(payload)} (basemap ${human(sizes.basemapTiles)}, terrain ${human(sizes.terrain)}, score ${human(sizes.scoreGrid)}, flood ${human(sizes.floodLayers)}, fonts ${human(sizes.fonts)})`);
if (missing.length) {
  log(`MISSING ${missing.length} required file(s):`);
  for (const m of missing) log(`  - ${m}`);
} else {
  log(`integrity: all ${REQUIRED.length} required app files present`);
}
if (absolutePathHits.length) {
  log('WARNING absolute paths found (breaks subfolder hosting):');
  for (const hit of absolutePathHits) log(`  ${hit.file}: ${hit.matches.join(' , ')}`);
} else if (appFiles.every((f) => fs.existsSync(path.join(ROOT, f)))) {
  log('paths: no absolute references in the app files');
}

log('');
log('demo stops ready:');
for (const area of region.demoAreas) log(`  ${area.label} — ${area.subtitle || ''} ${area.preset.join(',')}`);
if (demo.worstOverall?.[0]) log(`  worst cell citywide (2070 score ${demo.worstOverall[0].scores[4]}): ${demo.worstOverall[0].lat},${demo.worstOverall[0].lon}`);

if (missing.length) process.exitCode = 1;

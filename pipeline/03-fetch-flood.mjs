// 03 — Flood records. Real published footprints, not model output.
// Every layer here comes from Chennai's own open data portal (opencity.in), which mirrors
// GCC / NRSC / district administration releases. We download the KMLs, convert to GeoJSON,
// clip to the region and write an index so later stages can pick layers by name.
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, CACHE, log, ensureDir, writeJson, readJson, loadRegion,
  human, bboxOfGeometry, bboxOverlap, round,
} from './lib.mjs';
import { kmlToGeoJson } from './kml.mjs';

// Every Chennai flood dataset the portal publishes. More real events beats fewer invented ones:
// 2005 extent, 2015 NRSC satellite footprint, 2020 Cyclone Nivar hotspots, plus the return-period
// flow corridors used for the 2070 projection.
const DATASETS = [
  'chennai-floods-2005-data',
  'chennai-floods-2015-data',
  'chennai-flooding-data',
  'chennai-floods-2020-data',
];
const UA = { headers: { 'user-agent': 'FloodTimeMachine/1.0 (hackathon pre-bake)' } };
const region = loadRegion(process.argv[2]);
const outDir = path.join(CACHE, 'flood');
ensureDir(outDir);

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const catalog = [];
for (const dataset of DATASETS) {
  const url = `https://data.opencity.in/api/3/action/package_show?id=${dataset}`;
  const pkg = JSON.parse(await (await fetch(url, UA)).text()).result;
  log(`${dataset}: "${pkg.title}" — ${pkg.resources.length} resources`);
  for (const res of pkg.resources) {
    const name = res.name || res.description || res.url;
    const slug = slugify(name);
    const entry = {
      dataset,
      slug,
      title: name,
      format: (res.format || '').toUpperCase(),
      url: res.url,
      license: pkg.license_title || pkg.license_id || 'see opencity.in',
      source: `https://data.opencity.in/dataset/${dataset}`,
    };
    if (entry.format !== 'KML') {
      entry.skipped = `format ${entry.format}`;
      catalog.push(entry);
      continue;
    }
    const cacheFile = path.join(outDir, `${slug}.json`);
    const kmlFile = path.join(outDir, `${slug}.kml`);
    try {
      if (!fs.existsSync(kmlFile)) {
        const body = Buffer.from(await (await fetch(res.url, UA)).arrayBuffer());
        fs.writeFileSync(kmlFile, body);
      }
      const fc = kmlToGeoJson(fs.readFileSync(kmlFile, 'utf8'));
      // Clip to the region so a district-wide file does not drag in Tiruvallur and Vellore.
      const kept = [];
      let dropped = 0;
      for (const f of fc.features) {
        if (!f.geometry) continue;
        if (bboxOverlap(bboxOfGeometry(f.geometry), region.bbox)) kept.push(f);
        else dropped++;
      }
      fc.features = kept;
      const bytes = writeJson(cacheFile, fc);
      const types = {};
      for (const f of kept) types[f.geometry.type] = (types[f.geometry.type] || 0) + 1;
      Object.assign(entry, {
        features: kept.length,
        clippedOut: dropped,
        bytes,
        geometryTypes: types,
        properties: kept.length ? Object.keys(kept[0].properties) : [],
        geomCache: path.relative(ROOT, cacheFile).replace(/\\/g, '/'),
      });
      log(`  ✓ ${name} — ${kept.length} features (${human(bytes)}), dropped ${dropped} outside region`);
    } catch (err) {
      entry.error = err.message;
      log(`  ✗ ${name} — ${err.message}`);
    }
    catalog.push(entry);
  }
}

writeJson('data/flood-catalog.json', {
  region: region.id,
  fetched: new Date().toISOString(),
  note: 'Raw KMLs and converted GeoJSON live in .cache/flood (not committed). Selected layers are promoted to data/flood by pipeline/06.',
  catalog: catalog.map(({ geomCache, ...rest }) => rest),
}, true);

log('');
log('available flood layers (name → features):');
for (const e of catalog) {
  if (e.features !== undefined) log(`  ${String(e.features).padStart(6)}  ${e.title}`);
}
const usable = catalog.filter((c) => c.features > 0).length;
log(`${usable} usable layers cached in .cache/flood`);
if (!usable) process.exitCode = 1;

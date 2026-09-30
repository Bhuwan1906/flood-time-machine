// 04 — Wards, wetlands, place names.
// Buildings are NOT fetched here: the Protomaps tiles pulled in stage 01 already carry real building
// footprints (and a published height where one exists), so density and 3D massing come free and offline.
// Overpass is only needed for wetlands (the "restore nature" toggle) and the place-name search index.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, log, ensureDir, writeJson, loadRegion, human, sleep, round } from './lib.mjs';

const region = loadRegion(process.argv[2]);
const [S, W, N, E] = region.bbox;
const bbox = `${S},${W},${N},${E}`;
const ENDPOINTS = [region.overpass.endpoint, 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter'];

async function overpass(query, label) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const url = `${endpoint}?data=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: { 'user-agent': region.overpass.userAgent } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const n = json.elements?.length ?? 0;
        if (!n) throw new Error('empty result');
        log(`  ${label}: ${n} elements from ${new URL(endpoint).host}`);
        return json;
      } catch (err) {
        lastErr = err;
        await sleep(1500 * attempt);
      }
    }
  }
  throw new Error(`${label} failed on every mirror: ${lastErr?.message}`);
}

// ---------------------------------------------------------------- wards (datameet, CC-BY)
const wardsUrl = 'https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Chennai/Wards.geojson';
const wardsRaw = await fetch(wardsUrl, { headers: { 'user-agent': region.overpass.userAgent } });
if (!wardsRaw.ok) throw new Error(`wards download failed: HTTP ${wardsRaw.status}`);
const wards = await wardsRaw.json();
const wardNames = [];
for (const f of wards.features) {
  const p = f.properties || {};
  const name = p.ward_name || p.WARD_NAME || p.name || p.wardname || null;
  const no = p.ward_no || p.WARD_NO || p.wardno || null;
  if (name || no) wardNames.push({ no: String(no ?? ''), name: String(name ?? '') });
}
log(`wards: ${wards.features.length} polygons (${human(fs.statSync(path.join(ROOT, 'data')).size)})`);
writeJson('data/wards.geojson', wards);
writeJson('data/wards.json', {
  source: 'https://github.com/datameet/Municipal_Spatial_Data (CC-BY)',
  count: wards.features.length,
  attributeKeys: Object.keys(wards.features[0]?.properties || {}),
  sample: wardNames.slice(0, 5),
}, true);

// ---------------------------------------------------------------- wetlands + water bodies
const wetlandQuery = `[out:json][timeout:180];
(
  way["natural"="wetland"](${bbox});
  relation["natural"="wetland"](${bbox});
  way["wetland"](${bbox});
  way["landuse"="reservoir"](${bbox});
  relation["landuse"="reservoir"](${bbox});
);
out geom;`;
const wetlandJson = await overpass(wetlandQuery, 'wetlands');

const wetlandFeatures = [];
for (const el of wetlandJson.elements) {
  const tags = el.tags || {};
  const props = {
    osmId: `${el.type}/${el.id}`,
    name: tags.name || null,
    kind: tags.natural || tags.landuse || (tags.wetland ? 'wetland' : null),
    wetland: tags.wetland || null,
    protectedArea: tags.protection_title || tags['boundary:protected_area'] || null,
    source: 'OpenStreetMap (ODbL)',
  };
  if (el.type === 'way' && el.geometry?.length > 2) {
    const ring = el.geometry.map((pt) => [round(pt.lon, 5), round(pt.lat, 5)]);
    const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
    if (closed) wetlandFeatures.push({ type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } });
  } else if (el.type === 'relation' && el.members) {
    const outers = [];
    for (const m of el.members) {
      if (m.role === 'inner' || !m.geometry?.length) continue;
      const ring = m.geometry.map((pt) => [round(pt.lon, 5), round(pt.lat, 5)]);
      if (ring.length > 3) outers.push([ring]);
    }
    if (outers.length) wetlandFeatures.push({ type: 'Feature', properties: props, geometry: { type: 'MultiPolygon', coordinates: outers } });
  }
}
writeJson('data/wetlands.geojson', { type: 'FeatureCollection', features: wetlandFeatures });
const named = wetlandFeatures.filter((f) => f.properties.name);
log(`wetlands: ${wetlandFeatures.length} polygons (${named.length} named) -> data/wetlands.geojson`);

// ---------------------------------------------------------------- place names for offline search
const placeQuery = `[out:json][timeout:180];
(
  node["place"](${bbox});
  way["place"](${bbox});
);
out center;`;
const placeJson = await overpass(placeQuery, 'place names');

const PLACE_WEIGHT = { city: 0, town: 1, suburb: 2, quarter: 3, neighbourhood: 4, village: 5, hamlet: 6, locality: 7 };
const places = [];
for (const el of placeJson.elements) {
  const tags = el.tags || {};
  const name = tags.name;
  if (!name) continue;
  const lon = el.lon ?? el.center?.lon;
  const lat = el.lat ?? el.center?.lat;
  if (lon === undefined || lat === undefined) continue;
  places.push({
    n: name,
    en: tags['name:en'] || null,
    t: tags.place,
    w: PLACE_WEIGHT[tags.place] ?? 9,
    c: [round(lon, 5), round(lat, 5)],
  });
}
places.sort((a, b) => a.w - b.w || a.n.localeCompare(b.n));
for (const area of region.demoAreas) places.unshift({ n: area.label, en: null, t: 'demo', w: -1, c: [Math.round(((area.bbox[1] + area.bbox[3]) / 2) * 1e5) / 1e5, Math.round(((area.bbox[0] + area.bbox[2]) / 2) * 1e5) / 1e5], note: area.whyShort });

writeJson('data/places.json', {
  source: 'OpenStreetMap place nodes (ODbL)',
  count: places.length,
  places,
});
log(`places: ${places.length} searchable names -> data/places.json`);

// Demo areas are resolved in stage 07 from data/regions.json, so this file and the app can never
// drift apart from the region config.

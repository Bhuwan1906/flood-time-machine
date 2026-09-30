// Minimal KML -> GeoJSON converter.
// The opencity.in layers are ogr2ogr exports, so the structure is regular: Placemark →
// ExtendedData/SimpleData plus a Point / LineString / Polygon / MultiGeometry. No XML library needed.

const stripTags = (s) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

function parseCoordinates(text, precision) {
  const out = [];
  const parts = text.trim().split(/\s+/);
  for (const part of parts) {
    const bits = part.split(',');
    if (bits.length < 2) continue;
    const lon = Number(bits[0]);
    const lat = Number(bits[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    out.push([Number(lon.toFixed(precision)), Number(lat.toFixed(precision))]);
    // Drop consecutive duplicates — they survive float rounding and bloat the file.
    const n = out.length;
    if (n > 1 && out[n - 1][0] === out[n - 2][0] && out[n - 1][1] === out[n - 2][1]) out.pop();
  }
  return out;
}

/** Douglas-Peucker, on squared degrees. Keeps flood outlines recognisable at a fraction of the size. */
function simplifyRing(ring, tolerance) {
  if (tolerance <= 0 || ring.length < 5) return ring;
  const t2 = tolerance * tolerance;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = -1;
    let index = -1;
    const [x1, y1] = ring[first];
    const [x2, y2] = ring[last];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const denom = dx * dx + dy * dy;
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

function closeRing(ring, tolerance) {
  const simplified = simplifyRing(ring, tolerance);
  if (!simplified.length) return simplified;
  const [fx, fy] = simplified[0];
  const [lx, ly] = simplified[simplified.length - 1];
  if (fx !== lx || fy !== ly) simplified.push([fx, fy]);
  return simplified;
}

function polygonsFrom(xml, precision, tolerance) {
  const polygons = [];
  const polyRe = /<Polygon\b[^>]*>([\s\S]*?)<\/Polygon>/gi;
  let m;
  while ((m = polyRe.exec(xml))) {
    const body = m[1];
    const rings = [];
    const outer = /<outerBoundaryIs\b[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(body);
    if (outer) {
      const ring = closeRing(parseCoordinates(outer[1], precision), tolerance);
      if (ring.length >= 4) rings.push(ring);
    }
    const innerRe = /<innerBoundaryIs\b[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi;
    let inner;
    while ((inner = innerRe.exec(body))) {
      const ring = closeRing(parseCoordinates(inner[1], precision), tolerance);
      if (ring.length >= 4) rings.push(ring);
    }
    if (rings.length) polygons.push(rings);
  }
  return polygons;
}

function geometryFrom(placemark, precision, tolerance) {
  const polygons = polygonsFrom(placemark, precision, tolerance);
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  if (polygons.length > 1) return { type: 'MultiPolygon', coordinates: polygons };

  const lines = [];
  const lineRe = /<LineString\b[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/gi;
  let lm;
  while ((lm = lineRe.exec(placemark))) {
    const coords = parseCoordinates(lm[1], precision);
    if (coords.length >= 2) lines.push(coords);
  }
  if (lines.length === 1) return { type: 'LineString', coordinates: lines[0] };
  if (lines.length > 1) return { type: 'MultiLineString', coordinates: lines };

  const points = [];
  const pointRe = /<Point\b[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi;
  let pm;
  while ((pm = pointRe.exec(placemark))) {
    const coords = parseCoordinates(pm[1], precision);
    if (coords.length) points.push(coords[0]);
  }
  if (points.length === 1) return { type: 'Point', coordinates: points[0] };
  if (points.length > 1) return { type: 'MultiPoint', coordinates: points };
  return null;
}

export function kmlToGeoJson(xml, { precision = 5, tolerance = 0, maxDescription = 240 } = {}) {
  const features = [];
  const placemarkRe = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  let m;
  while ((m = placemarkRe.exec(xml))) {
    const body = m[1];
    const properties = {};

    const name = /<name>([\s\S]*?)<\/name>/i.exec(body);
    if (name) properties.name = stripTags(name[1]).slice(0, 160);

    const description = /<description>([\s\S]*?)<\/description>/i.exec(body);
    if (description) {
      const text = stripTags(description[1]);
      if (text) properties.description = text.slice(0, maxDescription);
    }

    const dataRe = /<SimpleData\s+name="([^"]*)"\s*>([\s\S]*?)<\/SimpleData>/gi;
    let d;
    while ((d = dataRe.exec(body))) {
      const key = d[1];
      const value = stripTags(d[2]);
      if (!key) continue;
      const num = Number(value);
      properties[key] = value !== '' && Number.isFinite(num) && !/^0\d/.test(value) ? num : value;
    }

    const geometry = geometryFrom(body, precision, tolerance);
    if (!geometry) continue;
    features.push({ type: 'Feature', properties, geometry });
  }
  return { type: 'FeatureCollection', features };
}

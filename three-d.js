// three-d.js — the 3D view.
//
// There is no second renderer and no 3D model file. The map tilts, real satellite elevation is
// switched on, the basemap's own building footprints are extruded, and the water you see is the
// score grid raised to each cell's modelled depth. That is why the water only ever appears where the
// published records put it.
//
// Building heights: OpenStreetMap publishes a height for a small minority of Chennai buildings, and
// we use it where it exists. The rest are drawn at a flat massing height and labelled as such — the
// alternative would be inventing a skyline, which is the one thing this project refuses to do.

const easing = (t) => 1 - (1 - t) ** 3;

export const THREE_D_NOTE =
  'Terrain is real satellite elevation, exaggerated 3× so 1 m of height reads clearly. Water blocks are each cell’s modelled depth at the same exaggeration. Buildings are true footprints: published heights where OpenStreetMap has them, otherwise a flat massing — Chennai has almost no surveyed building heights.';

function setVisibility(map, id, visible) {
  if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

export function paintSky(map, on) {
  if (on) {
    // A low warm sun and a hazy horizon sell the 'rising water over a real city' read.
    map.setSky({
      'sky-color': '#0b1626',
      'horizon-color': '#2a4a6b',
      'fog-color': '#16283e',
      'fog-ground-blend': 0.6,
      'horizon-fog-blend': 0.55,
      'sky-horizon-blend': 0.6,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0, 10, 0.5, 14, 0.85],
    });
    map.setLight({ anchor: 'map', position: [1.4, 210, 55], color: '#fff3e0', intensity: 0.45 });
  } else {
    // MapLibre v5 rejects setSky(null) and setSky({}) merges — pass an explicit neutral sky.
    map.setSky({
      'sky-color': 'transparent',
      'horizon-color': 'transparent',
      'fog-color': 'transparent',
      'fog-ground-blend': 0,
      'horizon-fog-blend': 0,
      'sky-horizon-blend': 0,
      'atmosphere-blend': 0,
    });
    map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.3, position: [1.15, 210, 30] });
  }
}

export function applyThreeD({ map, region, enabled }) {
  const exaggeration = region.terrain.verticalExaggeration;
  if (enabled) {
    map.setTerrain({ source: 'terrain', exaggeration });
    setVisibility(map, 'buildings-3d', true);
    setVisibility(map, 'water-3d', true);
    // Only one thing moves at a time: tilt first, then let the water settle in.
    paintSky(map, true);
    map.easeTo({ pitch: 58, bearing: -18, duration: 900, easing });
    map.once('moveend', () => {
      if (map.getLayer('water-3d')) setVisibility(map, 'water-3d', true);
    });
  } else {
    map.setTerrain(null);
    paintSky(map, false);
    setVisibility(map, 'buildings-3d', false);
    setVisibility(map, 'water-3d', false);
    map.easeTo({ pitch: 0, bearing: 0, duration: 780, easing });
  }
}

/** Height of a cell's water column on screen, metres. */
export function waterHeightOnScreen(depthMetres, region) {
  return Math.max(0, depthMetres * region.terrain.verticalExaggeration);
}

/** Human sentence for how deep the selected cell gets. */
export function describeDepth(depthMetres) {
  if (depthMetres <= 0.02) return 'no water modelled here';
  if (depthMetres < 0.25) return `${Math.round(depthMetres * 100)} cm — ankle deep`;
  if (depthMetres < 0.6) return `${depthMetres.toFixed(2)} m — knee deep`;
  if (depthMetres < 1.2) return `${depthMetres.toFixed(2)} m — waist deep`;
  return `${depthMetres.toFixed(2)} m — above waist`;
}

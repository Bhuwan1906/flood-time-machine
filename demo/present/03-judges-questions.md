# 03 — JUDGES QUESTIONS (the answers, verbatim)

## Data & honesty

**"Where does the data come from?"**
Only published, citable sources: NRSC satellite flood inundation and GCC extents via opencity.in
(public domain), AWS Terrain Tiles elevation, OpenStreetMap (ODbL) buildings/roads/POIs, Open-Meteo
ERA5 rainfall, datameet wards (CC-BY). Every layer's receipt — source, date, feature count — is in
the repo and shown in the app footer.

**"Is the depth measured?"**
Modelled, and labelled as such: published zones + terrain hollows. 192 real measured points exist
and override the model where published (shown on Today). Per-cell depth is a model — we never
claim otherwise.

**"Population numbers?"**
A gridded estimate, stated on screen: OSM building footprints ÷ 85 m² per household × 3.51 persons
(Census 2011 Tamil Nadu). No street-level census exists in India; coarser rasters (WorldPop/GHSL)
can't see a single street. For ranking exposure it's the right tool.

## Method

**"Is this AI?"**
No, deliberately. Transparent arithmetic on published data — every weight and formula is in the
repo. A flood tool nobody can audit is a liability.

**"Why these score weights?"**
Hazard 40% — published records are the strongest evidence. Low ground 30% — gravity doesn't
negotiate. Flood history 20% — streets that flooded twice flood again. Built-up 10% — worsens
consequence, doesn't cause floods.

**"How did you choose the MCDM weights? Is it AHP?"**
Weighted linear combination with weights fixed a priori by expert judgement, stated openly in the
repo — not a black-box AHP eigenvector. And we tested stability: perturbing every weight ±20%
leaves the top-100 risk ranking 100% intact (verified on 3,000 sampled cells). The conclusion
doesn't depend on the exact weights.

**"Landslide in flat Chennai? Isn't that an empty layer?"**
It's a finding, not a gap: the layer is slope-driven (0 below 3°, 100 above 15°) and Chennai's low
coastal relief is exactly why ~98% of cells are zero. The only real slopes are St. Thomas Mount and
the Guindy ridge. Re-target the same pipeline to a hilly city — one regions.json entry — and that
term wakes up unchanged.

**"What about 2070 — are you predicting?"**
We don't predict. GCC's own 200-year flow corridors plus 2015's measured rain replayed as a design
storm. Their projection, our stress test — tagged "est." on screen.

## Routes (PS 1.1)

**"Show me a route from MY address."**
Routes are pre-baked from the two worst flood-bowl origins to their nearest hospitals and 1,076
shelters. If you want yours: `node pipeline/14-route-graph.mjs chennai` re-bakes with any origin in
~9 seconds, fully offline. The engine doesn't need the internet — that's the point.

**"How does least-risk work?"**
Dijkstra over the OSM road graph; edge cost = km × (1 + 2 × risk + 3 × severe), where severe =
modelled depth ≥ 0.6 m (waist-deep). Dry streets cost normal; flooded streets are priced out. Both
routes are drawn — green (least-risk) over blue dashed (shortest) — so the trade-off is visible.

**"Why shelters = schools?"**
That's how Chennai actually shelters — schools and community halls are the designated relief sites.
OSM has 1,076 of them in the city; hospitals number 1,845.

## Scope & business

**"Only Chennai?"**
The city is one entry in `regions.json` — a bounding box and a pipeline re-run. The engine is
city-agnostic; the bottleneck is data partnerships, not code.

**"Who is this for?"**
Residents, journalists, ward officers, insurers — anyone who needs a street's risk in 10 seconds,
especially when the towers are down. Public data, MIT licence.

**"Weaknesses?"**
Four, all printed in the README: ERA5 smooths extreme rain; depths are modelled; the wetland toggle
is a planning illustration; past years use today's buildings. A tool that hides limits is dangerous.

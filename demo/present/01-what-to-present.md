# 01 — WHAT TO PRESENT

## The one-liner

**Flood Time Machine** — a geospatial decision-support system for Chennai: per-address, multi-hazard
risk from 2005 to 2070, plus least-risk emergency routing to hospitals and shelters. Fully offline:
92.9 MB, one folder, any laptop, no internet, no logins, no AI black box.

## How it maps to PS 1.1 (say this when judges ask "did you read the PS?")

| PS 1.1 asks | We deliver | Where judges see it |
|---|---|---|
| Integrate multiple hazards | Flood (5 yearly layers) + waterlogging + landslide, shown separately | "Hazard layers" buttons in the legend |
| Normalize indicators | Every criterion packed 0–100 per 100 m cell; method documented in `data/score/index.json` | Repo + judge card |
| MCDM-based risk index | Weighted linear combination, weights + justification on screen: **0.45 flood · 0.30 waterlogging · 0.15 landslide · 0.10 exposure** | "MCDM" tab + score panel row |
| Identify high-risk locations | Per-year exposure: people, buildings, roads, critical sites, worst ward, CSV export | Exposure panel (right) |
| Least-risk route, not shortest | Dijkstra over a 101,150-junction road graph; cost = km × (1 + 2·risk + 3·severe[≥0.6 m]) | "Emergency routes · PS 1.1" panel |
| Interactive route map | Origin + destination selectors, routes redraw per year on the slider | Same panel |
| Hospitals, shelters as inputs | 1,845 hospitals/clinics + **1,076 relief shelters (schools & community halls)** | Route destinations |

## The five demo stops (each has one receipt — say the receipt)

1. **Velachery, Today — score 8.5 EXTREME.** "This street floods in every recorded event." Every
   input is a published record: NRSC satellite inundation, the city's hazard zoning, satellite
   terrain, OSM buildings.
2. **The time machine.** Press play: 2005 (GCC's own extent map) → 2015 (NRSC satellite, 3,733
   polygons) → 2020 (Cyclone Nivar hotspots) → today → 2070 (GCC 200-yr corridors). Score moves
   because the water moves.
3. **The escape (PS 1.1 headline).** Routes panel: **shortest to King's Matric Hr Sec School = 1.1 km
   with 0.4 km in ≥0.6 m water; least-risk to BrightPath Play School = 1.4 km with ZERO waist-deep
   water.** Slide 2015 ↔ today — routes re-price per year. "Shortest is not safest."
4. **Multi-hazard.** Legend buttons: Flood → Waterlogging (visible citywide) → Landslide (near-zero:
   a finding — flat coastal plain; only St. Thomas Mount & the Guindy ridge have real slope) → MCDM
   (combined, weights on screen).
5. **Taramani + wetlands (the differentiator).** 5.6 → **4.7** when the Pallikaranai marsh is
   restored. "Same street, same rain, less risk." Then SRM campus at 35 m: **1.4 even in 2070** —
   the machine also tells you where NOT to worry.

## Close on honesty

Every layer has a receipt (source, date, count shown in-app). Limits are printed in the README and
on screen: modelled depths, gridded population estimate, counterfactual wetlands. "A risk tool that
hides its limits is dangerous. Ours states them."

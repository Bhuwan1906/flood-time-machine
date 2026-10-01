# FLOOD TIME MACHINE — JUDGE CARD (print this page)

**Team: Teen Titans** · Domain: Disaster Risk Analysis · The live app runs offline — nothing to type, nothing to load.

---

## THE ONE-LINER

**"Type any Chennai address, slide through 20 years of flood records, and see your street's risk — then restore the wetlands and watch it fall. And in a flood, it picks the safest route to a hospital or shelter — least-risk, not simply shortest."**

---

## THE SCORE (0–10 · higher = MORE risk)

```
score = 10 × ( 0.40 × FLOOD HAZARD   ← published record puts water here, this year
             + 0.30 × LOW GROUND     ← real satellite elevation (≤2 m = max, ≥20 m = 0)
             + 0.20 × FLOOD HISTORY  ← how often past records hit this cell
             + 0.10 × BUILT-UP )     ← OSM land use + measured building footprints
```

No ML anywhere. Every cell's score is explainable in 30 seconds. Weights live in `data/score/index.json`.

**2070** = GCC's own 200-yr flow corridors + 2015's measured rain replayed as a design storm. *Their projection, our stress test.*
**2005** = GCC's recorded flood extent replayed on today's terrain. *Real water, coarse map — tagged "est."*

---

## THE FIVE STOPS (verified numbers — say them with confidence)

| Stop | What it shows | Velachery score | Say this |
|---|---|---|---|
| **2005** `est.` | GCC flood extent, 239 km² | 7.2 | "The Corporation's own map from that monsoon." |
| **2015** | NRSC satellite inundation, 3,733 polys | 8.2 | "The worst flood in a century, measured from space." |
| **2020** | Cyclone Nivar hotspots | 4.5 | "A cleaner decade — the score honestly falls." |
| **Today** | GCC hazard zoning (High+Mod) | 8.5 | "This street floods in every recorded event." |
| **2070** `est.` | 200-yr corridors, 286 km² | 8.5 | "Already in the worst corridor — the map adds nothing here." |

**Other proven numbers:** Taramani 5.6 → **4.7** with wetlands · SRM campus **1.4** at 35 m (the control) · worst cell citywide **9.1** · depth "1.60 m — above waist" · rainfall receipts per stop (2005: 521.7 mm · 2015: 485.4 mm · 2020: 438.6 mm · today's design storm: Michaung 379.2 mm, 255.8 mm worst day).

**EXPOSURE (challenge 4.4 — affected infrastructure statistics):** in ≥15 cm of modelled water — **2015: ~7.4 lakh people · 91,888 buildings · 3,019 km roads · Today: ~14.8 lakh residents in hazard zones · 2070: ~12.4 lakh people, 4,325 km roads.** Severe tier (≥60 cm) shown beside each. "Who is exposed, per year — not just how deep."

**CRITICAL SITES (the line that lands):** **Today: 1,111 hospitals, clinics, schools, colleges, police stations, fire stations and shelters sit inside the city's own hazard zones — 586 of them in ≥60 cm water.** 2015: 590 · 2070: 932. Say it as: "over a thousand critical facilities are where the water goes."

**LAND USE + WARDS (the deliverable):** built-up land in today's water — **12.4 km² residential · 5.7 commercial · 22.0 industrial.** Worst ward today: **#86 Ambattur, ~25,600 people.** The app downloads the full ranked 201-ward table as CSV — statistics in usable form, no login, works offline.

**MULTI-HAZARD (PS 1.1 — labelled layers + MCDM):** the legend carries four buttons — **Flood · Waterlogging · Landslide · MCDM** — so each hazard layer is shown separately, then combined. The combined index is stated as what it is: **MCDM by weighted linear combination**, `MH = 10 × (0.45·flood + 0.30·waterlogging + 0.15·landslide + 0.10·built exposure)`. Justification we say out loud: *flood leads because the published record is the strongest evidence; waterlogging (low ground) is the terrain that cannot drain and is visible citywide — today 43,106 cells rank moderate and 733 high on the combined index; landslide is the PS's second hazard, genuinely ≈0 on this coastal plain (98% of cells) and the app says so; exposure weights consequence.* Landslide susceptibility comes from DEM slope (Zevenbergen–Thorne: 0 below 3°, 100 above 15°); re-target the same pipeline to a hilly city and that term wakes up unchanged. **Sensitivity: the top-risk ranking is stable under ±20% weight perturbation (verified on 3,000 sampled cells); weights are fixed a priori by expert judgement and stated in the repo.**

**EMERGENCY ROUTES (PS 1.1 — the least-risk engine):** a road graph built from the same offline tiles — **101,150 junctions, ~199,000 edge pairs, 1,845 hospitals/clinics + 1,076 relief shelters** (shelters = schools and community halls, how Chennai actually shelters) — with every street edge priced by its per-year flood risk. Dijkstra runs twice per origin (Velachery, Taramani) per year: **plain shortest, then least-risk with cost = km × (1 + 2·risk + 3·severe)**, where severe = waist-deep (≥0.6 m). Baked offline, drawn as green-with-white-casing (safe) over blue dashed (shortest), and the routes follow the year slider. The receipts, today: **Velachery → shelter: the shortest route to King's Matric Hr Sec School is 1.1 km but wades 0.4 km of ≥0.6 m water; least-risk reaches BrightPath Play School in 1.4 km with 0 km of waist-deep water.** Taramani → hospital: shortest 1.5 km (0.5 km severe) vs least-risk 1.7 km (0.2 km severe). Say it as: "the shortest route is not the safe one, and now the map proves it street by street."

---

## TOP 10 JUDGE ANSWERS (one breath each)

1. **"Why not use GCC data directly?"** → They published data, not answers. 7,360 polygons in a KML is not something a parent in Velachery can use. Type the address, get the verdict in 10 seconds — offline.

2. **"How does 2070 work?"** → We don't predict. GCC's own 200-year corridors + 2015's measured rain as a design storm. The projection is theirs, the math is transparent, it's tagged est.

3. **"Is this AI?"** → No, deliberately. Transparent arithmetic on published data. A flood tool nobody can audit is a liability.

4. **"What if the internet dies?"** → It never needs it. 90 MB — tiles, terrain, data — one folder, any laptop. When a city floods, towers go down. That's why it's built this way.

5. **"Weaknesses?"** → Four, all in the README: ERA5 smooths 2015's extreme rain; depths are modelled; the wetland toggle is an illustration; past years use today's buildings. A tool that hides limits is dangerous.

6. **"Why these weights?"** → Hazard 40% because records are the strongest evidence; low ground 30% because gravity doesn't negotiate; history 20% because streets that flooded twice flood again; built-up 10% worsens consequences, doesn't cause floods.

7. **"Depth says waist-deep — measured?"** → Modelled: flood zone + terrain-hollow term. 192 real measured points exist and are shown on Today, but per-cell depth is modelled and labelled.

8. **"Only Chennai?"** → The city is one entry in regions.json. Swap flood datasets, re-run the pipeline, ship Mumbai. The engine is city-agnostic.

9. **"Wetlands toggle — real?"** → It's a planning illustration, labelled on screen: cells within 400 m of a marsh get 35–8% hazard discount in four rings. That's what a wetland physically does — absorb and slow.

10. **"Who is it for?"** → Residents, journalists, ward officers — anyone who needs their street's risk in 10 seconds. Public data, MIT license; if GCC built this themselves, we'd have won.

11. **"Where do the population numbers come from?"** → A gridded estimate, labelled as such: building footprints ÷ 85 m² per household × 3.51 persons (Census 2011 TN). WorldPop/GHSL rasters are coarser than a city block; no street-level census exists in India. Ours is a comparison tool across years and streets — and the footer credits it as an estimate, not a census.

12. **"Multi-hazard — isn't Chennai flat?"** → Yes, and we say so on screen: landslide susceptibility is ~0 for 98% of cells. But the PS asks for a multi-hazard system, and the honest answer is a framework that already carries flood + landslide + exposure — same pipeline, same MCDM math, one regions.json entry re-targets it to Nilgiris or Mumbai where the landslide term dominates.

13. **"How does the least-risk route work?"** → Dijkstra on the OSM road graph with per-edge flood pricing: cost = km × (1 + 2 × risk + 3 × severe[≥0.6 m]). Distance still wins on dry streets, so it never detours for nothing — but waist-deep streets get priced out. Both routes are precomputed per year and work fully offline, because in a flood the towers are down.

---

## EMERGENCY LINES

- App frozen? → Press **R** (recenter) or reload — state is in the URL-free app, nothing is lost.
- Judge pushes on a number? → "Let me open the receipts for that year" — click the footer line, show the count.
- Lost for words? → **"Same street, same rain, less risk — that's the cheapest flood defence a city can buy."**
- Time cut to 2 min? → Skip to **Stop 3.5**: 2070 + Taramani + Restore wetlands, let the dial fall. That's the differentiator.

---

*Sources: GCC & NRSC via opencity.in (public domain) · AWS Terrain Tiles · OpenStreetMap (ODbL) · Open-Meteo ERA5 · Protomaps · datameet wards. Depths modelled; wetland effect is a planning illustration; every number's receipt is shown in-app.*

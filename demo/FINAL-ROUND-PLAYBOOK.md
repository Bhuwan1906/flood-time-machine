# FINAL-ROUND PLAYBOOK — print this page

GEO IMPATHON 1.0 · FINAL ROUND · Wed Oct 1 · Tech Park 2, Hall 712, SRMIST.
Registration 8:00–9:00 (STRICT) · Problem statement 9:00 · SUBMIT BY 12:00 — a 3-hour window.
Juries are from INDUSTRY and the rubric follows their recommendations: they reward a working
demo, real numbers, and data honesty over slideware. Lead with the live map, the score dial,
the exposure statistics, and "every layer has a receipt."
Join the official WhatsApp group (link in the organizers' email) TONIGHT — overnight schedule
or PS changes land there first.
Read this top to bottom the moment the problem statement (PS) is handed out. Follow it mechanically.

---

## RULE ZERO — never touch the proven folder

`flood-time-machine/` is the finished, judge-proofed, offline-verified product. If the PS needs a
new city or a new hazard, **copy the folder first** and bake the new region in the copy:

```bash
cp -r flood-time-machine ftm-NEWCITY          # from "E:/Hackathon Project"
rm -rf ftm-NEWCITY/data ftm-NEWCITY/.cache    # data/ must be rebuilt; .cache is source-specific
```

The original stays as the fallback demo. If anything goes wrong in the copy, we still present
Chennai offline — a working demo of a strong product beats a broken demo of a new one.

---

## THE DECISION RULE (9:00–9:20 — first 20 minutes)

**Min 0–7 — Read the PS twice.** Write down, verbatim, on paper:
- every required deliverable / "expected output" bullet
- the judging criteria or rubric, if given
- hard constraints (data allowed, offline?, submission format)

**Min 7–14 — Map every deliverable to reuse / adapt / build.** Be honest per item.
Count the reusable share. **≥ 60% reusable → adapt, never rebuild.**

**Min 14–20 — Decide and write the one-liner** that maps the new PS title onto our product,
e.g. *"Flood Time Machine's exposure engine, re-pointed at <new city/hazard>, delivers exactly
the required hazard-exposure map + affected-infrastructure statistics."*
Send the PS text + rubric to the agent; the verdict and minute-by-minute plan come back in minutes.

### The three verdicts

| Verdict | When | What we do |
|---|---|---|
| **A — PRESENT** | PS is our 4.4 lane (hazard + exposure mapping, any city) | Polish, rehearse, present. Chennai demo if allowed; re-bake if the PS names a different city |
| **B — ADAPT** | Different city and/or flood-family hazard (riverine, cyclone surge, urban) — same disaster-mapping DNA | One `regions.json` entry + pipeline re-bake in the copied folder (~1 hr with internet). Judges see a *new* project; we spend the saved hours on polish + rehearsal |
| **C — TRANSPLANT** | Structurally different domain (sensors, ML training, non-geospatial) | New folder, but strip-mine organs from the proven repo: MapLibre+PMTiles offline map stack, 0–10 scoring engine, ward statistics + CSV export, 3D view. Still faster than any from-scratch team |

**Send one teammate to ask the organizers before 9:20:** Is Chennai acceptable as the study
area? Is there venue internet? Submission format (repo / live demo / slides)? The time limit is
now known: PS 9:00 → submit 12:00.

---

## PS 1.1 IS ALREADY BUILT — the verdict is pre-decided

The Day-2 PS (shared in advance, `problem_statement_Day2.pdf`) is **1.1: multi-hazard
decision-support + least-risk emergency routes**. The product already answers it:

- **Multi-hazard MCDM index** — "Multi-hazard index" toggle (right panel): MH = 10 × (0.45·flood hazard + 0.40·landslide susceptibility + 0.15·built exposure), per 100 m cell, per year. Landslide susceptibility (field LH) is baked from DEM slope (Zevenbergen–Thorne, 0 below 3° / 100 above 15°) by `pipeline/13-multihazard.mjs`.
- **Least-risk emergency routes** — `pipeline/14-route-graph.mjs` builds a 101k-node road graph from the same offline tiles, prices every edge per year (cost = km × (1 + 2·risk + 3·severe[≥0.6 m])), and bakes shortest vs least-risk Dijkstra pairs from Velachery and Taramani to their nearest hospitals and shelters. The app draws them (green safe over blue shortest) and follows the year slider.
- **Honesty line rehearsed:** Chennai is flat — ~98% of cells carry zero landslide susceptibility, and the app says so. The framework re-targets to hilly cities unchanged.

If the on-stage PS matches the PDF, the morning is **Scenario A (present + polish)**: confirm the
match in minutes, spend 9:20–11:15 on rehearsal — never on new features. If it differs, run the
decision rule below as written.

## THE OFFICIAL CLOCK — Wed Oct 1 (Scenario B — adapt)

| Time | Block | What happens |
|---|---|---|
| 8:00–8:30 | Arrive + register | Register the moment the desk opens (closes 9:00 STRICT). Sockets first, laptop on charger |
| 8:30–9:00 | Settle in | Boot laptop, open the project folder, re-test start.bat, check the WhatsApp group, quiet the team |
| 9:00–9:20 | Decision rule | Above. Verdict + one-liner + rubric mapped to features. PS text → agent |
| 9:20–10:20 | Bake | Copy folder (Rule Zero) · regions.json entry (fields below) · pipeline re-run, **fetch steps 01/02/03/04/05 in parallel terminals** (verified independent: only 05 writes receipts.json, 07 reads it later) |
| 10:20–10:50 | Prove it | `08-verify` must pass (now 38 checks incl. routes + multi-hazard) → `node server.mjs` → offline smoke test of demo areas (Wi-Fi off) · toggle **Multi-hazard index** · open **Emergency routes**, flip origin/role and slide 2015↔Today — routes must re-price · rename the 4 Chennai strings · rewrite judge-card headline numbers |
| 10:50–11:15 | Rehearse | ONE full pass with the 3-min cut. Team talks while the agent fixes nits |
| 11:15 | **HARD FREEZE** | Nothing new gets built. Polish the closing line. Breathe |
| 11:30–11:45 | SUBMIT | Never cut a deadline to the wire — beat 12:00 by 15 minutes |

Scenario A (present as-is) spends 9:20–11:15 on polish, deeper verification, and two rehearsals.
Extra time is always spent on rehearsal, never on new features.

### New-city regions.json entry — fields to fill

Copy the `chennai` entry and edit: `id`, `name`, `nameLocal`, `state`, `bbox` (draw it on
bboxfinder.com), `center`, `initialView`, `basemap.buildUrl` (keep the same Protomaps build date —
it's already fetched), `years`, and `demoAreas` (2–3 spots: one known-flooded, one that recovered,
one landmark — same story arc as Velachery / Taramani / SRM). Weights and score config stay as-is.

### Pipeline — exact commands (run inside the copied folder)

```bash
node pipeline/01-fetch-basemap.mjs NEWCITY   # internet: Protomaps z15 tiles for the bbox
node pipeline/02-fetch-terrain.mjs NEWCITY   # internet: AWS terrarium elevation
node pipeline/03-fetch-flood.mjs  NEWCITY    # internet: hazard extents — THE PS-SPECIFIC STEP
node pipeline/04-fetch-places.mjs NEWCITY    # internet: geocoding/places
node pipeline/05-fetch-rainfall.mjs NEWCITY  # internet: rainfall history
node pipeline/06-score-grid.mjs NEWCITY      # local: bakes the 25-field score grid
node pipeline/07-bundle.mjs      NEWCITY     # local: publishes per-year flood layers
node pipeline/08-verify.mjs      NEWCITY     # local: ~35 automated checks — must pass
node pipeline/09-coverage.mjs                # local: coverage outline (no region arg)
node pipeline/10-population.mjs  NEWCITY     # local: people/buildings/roads/critical sites
node pipeline/11-exposure.mjs    NEWCITY     # local: per-year exposure stats
node pipeline/12-wards.mjs       NEWCITY     # local: ward table + CSV data
node pipeline/13-multihazard.mjs NEWCITY     # local: landslide field (LH) + multi-hazard metadata
node pipeline/14-route-graph.mjs NEWCITY     # local: road graph + least-risk vs shortest route pairs
```

The two PS-1.1 steps (13/14) are local-only and fast (<10 s each) — run them right after 12.

**The hazard layer (03) is the only PS-specific step.** Everything after it — scoring, exposure
statistics, wards, CSV — is hazard-agnostic and runs untouched. If the new city's flood data
isn't available from the same sources, swap the source inside 03 but keep its output contract
(`data/flood/<year>.json` + catalog + receipts): the rest of the machine doesn't care where the
water polygon came from.

### The 4 Chennai strings to rename (cosmetic only — the engine is generic)

1. `index.html` `<title>` and meta description
2. `app.js` CSV filename: `chennai-flood-exposure-by-ward.csv` (~line 385)
3. `app.js` low-ground tooltip wording (~line 61 area)
4. `three-d.js` building-heights fact strings (lines 8, 15)

Header title, subtitle region name, and years already come from regions.json — verify they
changed on load.

---

## PRE-WRITTEN JUDGE ANSWERS

**"Is this Chennai-only?"**
*"Chennai is a dataset, not an architecture. One config file and one command re-target any city,
and the exposure engine — people, buildings, roads, critical sites, wards — works for any hazard.
We can re-point it live if you name a city."*

**"How long did this take?"**
*"The engine was built and battle-tested in the six-hour preliminary. Today's run proves the
claim: the same machine, re-pointed at <new area>, baked and verified inside the three-hour
window."*
(Scenario A: *"Built in six hours in the preliminary; today went into polish, verification, and rehearsal."*)

**"Where does the data come from?"**
*"Only published, citable sources: OpenStreetMap basemap and buildings, AWS Terrain Tiles
(satellite-derived elevation), published municipal/satellite flood extents, IMD rainfall records,
and Census 2011 occupancy rates for the population estimate. Every layer has a receipt in the
repo — data/receipts.json records source, date, and extent for each fetch."*

**"The population numbers — how accurate are they?"**
*"Honest answer: it's a gridded estimate, not a census — building footprints × Census 2011
occupancy (3.51 persons per occupied residential unit), stated as such in the app's footer. For
exposure ranking — which areas have the most people in harm's way — it's exactly the right tool."*

**"What if the internet dies mid-demo?"**
*"It can't — the entire app is offline. Basemap tiles, terrain, flood layers, the score grid,
everything is baked into the folder. Watch:"* (then Wi-Fi is already off, because we rehearsed it).

**"What did you add for this problem statement?"**
*"For PS 1.1: a multi-hazard MCDM index — 45% flood hazard, 40% landslide susceptibility from DEM slope, 15% built exposure — as one toggle on the same grid, and a least-risk emergency-route engine: a 101,000-junction road graph built from our own offline tiles, every street priced by flood depth per year, Dijkstra run twice per origin to the nearest hospitals and shelters. Today, the shortest route from Velachery wades 0.4 km of waist-deep water; the least-risk route takes the same 1.3 km and wades 0.1 km. Shortest is not safest — the map proves it street by street, offline."*

---

## NIGHT-BEFORE CHECKLIST

- [ ] Join the WhatsApp group from the organizers' email; notifications ON
- [ ] Wi-Fi OFF → double-click `start.bat` → map boots, timeline works, 3D works → Wi-Fi back on
- [ ] Print judge-card ×5 (one per judge) + this playbook
- [ ] Laptop charger + mouse in the bag
- [ ] USB stick: video backup + zip of the repo + zip of `deploy-staging`
- [ ] Phone hotspot tested; know the password by heart
- [ ] Sleep by midnight. Two alarms. Target: walk in at 8:00.

## DURING THE ROUND — three unbreakable rules

1. **Read the PS twice before touching a keyboard. Registration closes 9:00 STRICT — never be late.**
2. **≥ 60% reusable → adapt, never rebuild.** Speed is our weapon; don't throw it away.
3. **At 11:15, freeze. Submit by 11:45.** A finished submission beats a perfect intention.

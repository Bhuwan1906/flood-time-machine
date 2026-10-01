# 05 — IF THINGS BREAK (+ the clock)

## Failure → action (never debug on stage)

| Symptom | Do this |
|---|---|
| Map blank / app frozen | Reload the page (state is in the app, nothing is lost). If still blank: open the **hosted URL** |
| Score shows "—" | You tapped water. Tap the nearest street — say "that's the sea saying no" |
| Route panel empty | Origin/role/year combo not baked — switch origin to **Velachery**, role to **relief shelter** |
| Judge taps a weird address with no score | Coverage edge — say "one street over is covered", tap nearby |
| 3D looks wrong | Press 3D twice (off/on). Terrain exaggeration is ×3 on purpose — say so |
| Laptop dies | Second device → hosted URL → backup video queued |
| Venue Wi-Fi dies | Nothing breaks — the app is offline. Say: "this is why we built it offline" |
| Projector low-res | The layout stacks by itself; set browser zoom 90% |

## Never do

- Never force-reload in front of judges more than once.
- Never promise a feature that isn't on screen ("we could add…" is fine; "it does…" is not).
- Never argue with a judge about a number — open the receipt line in the footer instead.
- Never run `git`, the pipeline, or any command live except the one route re-bake flex.

## The official clock — Wed Oct 1

| Time | Block |
|---|---|
| 8:00–8:30 | Arrive, register (desk closes **9:00 STRICT**) — sockets first, laptop on charger |
| 8:30–9:00 | Boot, smoke test, WhatsApp group check, quiet the team |
| 9:00–9:20 | Read the PS twice, map deliverables (already done: PS 1.1 is pre-covered) |
| 9:20–10:20 | Polish only — no new features |
| 10:20–10:50 | `npm run verify` (38 checks) + offline smoke test + rename checks |
| 10:50–11:15 | ONE full rehearsal with the 3-minute cut |
| **11:15** | **HARD FREEZE — nothing new gets built** |
| 11:30–11:45 | **SUBMIT — beat the 12:00 deadline by 15 minutes** |

## Submission format

Public GitHub repo link under the team lead's account with complete committed code.
All work is committed and pushed (`cdd9276` is the latest). Before leaving for the venue:
refresh the repo page and screenshot it — the top commit and `data/routes/`, `pipeline/13-multihazard.mjs`,
`pipeline/14-route-graph.mjs` must be visible in the file list.

## If asked "what did you add for this PS?"

*"For PS 1.1: labelled multi-hazard layers — flood, waterlogging, landslide susceptibility from DEM
slope — plus an explicit MCDM combined index with the weights and justification on screen, and a
least-risk emergency-route engine: a 101,000-junction road graph built from our own offline tiles,
every street priced by flood depth per year, Dijkstra run twice per origin to the nearest hospitals
and 1,076 relief shelters. Shortest is not safest — the map proves it street by street, offline."*

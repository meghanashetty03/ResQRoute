# Stages 3–4: hazards and rule-based route evaluation

This guide records the Stage 3–4 baseline. Stage 5 supersedes the manual-only synchronization behavior; see [Dynamic rerouting](STAGE_5.md).

Stages 1–2 remain intact: React/Vite/Tailwind, Leaflet/OSM, Express, local SQLite, health checks, OSRM routes and the labelled Mangalore demo. No Stage 5 automatic rerouting, ML, authentication, cloud database or deployment is implemented.

## Run and check

From `D:\ResQRoute`, run `npm install` if necessary, then `npm run dev:backend` and `npm run dev:frontend` in separate terminals. Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The backend is [http://127.0.0.1:5000](http://127.0.0.1:5000). Both bind to `127.0.0.1` only. Reuse existing project development servers rather than starting duplicates. Reload an old browser tab after an update.

Run `npm run check` for backend/shared syntax checks, Node unit/API tests and the frontend build.

## SQLite migration and persistence

`backend/database/migrate.js` runs in an immediate transaction after the Stage 1 schema. It adds missing columns without dropping/rebuilding existing tables: `is_complete_closure`, `segment_confirmed`, `incident_id`, `scenario_mode`, `updated_at`. Original PRD fields and existing ambulance/emergency/hazard records are preserved.

Additional local tables: `schema_migrations` (migration history), `road_segments` (actual saved geometry for explicit assignment), `application_state` (hazard revision updated by insert/update/delete triggers), and `route_calculations` (original route candidates for manual re-evaluation). Startup is idempotent. There are no destructive resets or automatically seeded hazards. Route-cache/segment retention is not automated in this prototype.

IDs and report timestamps come from the backend. Reports survive page refresh and backend restart. Deactivation retains a row; the UI confirms permanent deletion of the selected row. **Reset demo routes reloads candidates and evaluates current reports; it never deletes hazards.**

## APIs

| Method/path | Response |
|---|---|
| `GET /api/hazards` | `{ hazards, revision, segments }` |
| `GET /api/hazards/:id` | `{ hazard, revision }` |
| `POST /api/hazards` | 201 `{ hazard, revision }` |
| `PATCH /api/hazards/:id` | 200 `{ hazard, revision }` |
| `DELETE /api/hazards/:id` | 200 `{ deletedId, revision }` |
| `POST /api/routes/calculate` | Original routes plus backend risk, eligibility, cost, rank and recommendation |
| `POST /api/routes/recalculate` | Manually refreshed evaluation of a saved calculation |

Creation requires `type`, numeric `latitude`/`longitude`, `severity` and nonempty `description` (maximum 1000 characters). Type values: `road_damage`, `construction`, `road_blockage`, `flooding`, `traffic`, `narrow_road`, `accident`. Severity: `Low`, `Medium`, `High`.

Optional fields: `scenario_mode` (`live` default or `demo`), boolean `is_active`, `expires_at` (null or ISO timestamp with timezone), `affected_segment_id` (null or saved segment ID), boolean `segment_confirmed`, boolean `is_complete_closure`, `incident_id` (null or up to 80 characters). New reports start `Reported`; PATCH can set `Verified` or `Rejected`. IDs/report timestamps are not client-editable. Booleans must be JSON booleans, not strings/numbers.

New expiration values must be in the future. An already-expired record can be edited without changing its expiration. Explicit segment assignments must be in the same mode and within 30 m of the hazard. Same-road confirmation requires an assigned saved segment. Invalid input returns 400, missing records 404; errors use `{ "error": "message" }`. Local frontend CORS includes PATCH/DELETE preflights.

The calculate request remains `{ mode, start: {lat,lng}, destination: {lat,lng} }`. Responses include `calculationId`, `recommendedRouteId`, `recommendationExplanation`, `hazardRevision`, `evaluatedAt`, `nextHazardExpiration`, `scoring`, segment catalogue and per-route details. Recalculate accepts **only** `{ "calculationId": "<previous response ID>" }`. The backend reads original candidates from SQLite and fresh hazards; no client-supplied risk scores or geometry are trusted. Recalculation does not contact OSRM or change the provider's geometry/ETA. Existing health/demo APIs remain available.

## Geographic matching

`shared/geo.js` uses spherical great-circle point-to-finite-segment distances in metres, clamped to segment endpoints, with zero-length handling. Route distance is the minimum over its segments. Raw degree distances are never compared to metre thresholds.

Active, non-rejected, unexpired hazards in the current mode match within `HAZARD_PROXIMITY_METRES` (default 30). For an explicit binding, the saved segment's endpoints and great-circle midpoints must also lie within 2 m of the candidate route. Merely crossing at one intersection is insufficient. Segment assignment itself has a conservative 30 m validation radius independent of the scoring-radius setting.

Four predefined demo choices cover an actual unique edge on each A/B/C route and their shared starting road. Live road edges are registered after route generation with deterministic geometry-based IDs. The form lists nearby saved segments. Click a road, then assign/confirm its actual edge where known. For the demo, the segment-placement selector moves the report pin onto the selected stored road edge.

Proximity alone can still match a parallel road; production use needs validated map matching. Operator confirmation is a manual assertion, not independent verification.

## Risk calculation

This is a transparent rule-based prototype, not a trained AI model or validated road-safety probability.

| Hazard | Base penalty |
|---|---:|
| Road damage | 20 |
| Construction | 25 |
| Blockage | 50 |
| Flooding | 45 |
| Traffic | 20 |
| Narrow road | 30 |
| Accident obstruction | 40 |

Severity: Low 0.5, Medium 1, High 1.5. Confidence: Reported 0.6, Verified 1, Rejected 0. Inactive and expired reports contribute zero.

```text
report contribution = base penalty × severity × confidence
raw risk = sum(maximum contribution per matched incident)
display risk = min(100, max(0, raw risk))
risk-time penalty = display risk × RISK_MINUTES_PER_POINT
final cost = provider travel minutes + additional traffic delay + risk-time penalty
```

Scores use two decimal places, costs/penalties four internally and two in cards. Normalization is absolute across candidates, never relative to another route's current risk. Categories: 0–20 Low reported risk; >20–50 Moderate; >50–75 High; >75–100 Very high. Zero/low scores mean few/no relevant reported hazards, **not guaranteed safety**.

Duplicate reports share an explicit incident ID. Without IDs, reports of the same type and same segment binding within 10 m and 30 minutes are grouped. Different explicit incident IDs remain distinct. Connected duplicate groups contribute their maximum penalty once. Any confirmed complete closure in a group is retained even when another report supplies its maximum penalty. This heuristic can merge distinct nearby incidents or miss distant duplicates; use incident IDs where appropriate. Cards expose relevant incident counts, duplicate counts, report IDs, hazard types and individual contributions.

Set `HAZARD_PROXIMITY_METRES=30` and `RISK_MINUTES_PER_POINT=0.15` in `backend/.env`; restart after changes. Weights are in `shared/hazards.js`; multipliers/duplicate settings in `backend/config/riskConfig.js`. Current OSRM/demo adapters have no live traffic feed, so separate delay is zero. The engine ignores separate delay if a future provider marks its ETA as already including that traffic. No new ETA is invented to simulate traffic.

## Eligibility and recommendation

Hard exclusion requires an active/unexpired, Verified report explicitly asserting a complete closure, same-road confirmation, valid saved-segment binding and that segment's actual match to the candidate. Proximity-only or unverified closures and ordinary potholes add penalties without automatic exclusion.

Excluded cards read **Unavailable – Verified Road Closure** and lines are red/dashed. Eligible routes rank by final cost, then travel duration and stable ID for ties. The lowest-cost eligible candidate is green/recommended. Other eligible routes are blue/purple or orange for risk >50. A thicker line/card outline means selected for review; selecting an excluded route does not override eligibility or the recommendation. Explanations are derived from actual costs, matched hazard types and closure decisions.

If all candidates are excluded, no route is recommended: “No verified accessible alternative is currently available. Dispatcher review required.” No alternative or arrival estimate is invented.

## Manual-only recalculation

Hazard updates refresh markers and flag existing evaluations as outdated. Expiration also flags old snapshots. **Neither mutations nor timers trigger a scoring request or change the recommendation.** The dispatcher clicks **Recalculate Routes** or **Find routes**. Outdated recommendations are labelled and their green line becomes grey until re-evaluation succeeds. Failed manual refreshes preserve the last successful snapshot with an error/outdated warning. Changes made in another tab are loaded with **Refresh reports** or page reload; no cross-tab push subscription is implemented.

## Manual verification

1. Load the demo on the dashboard. With no relevant reports, A has the lowest cost.
2. Open Road Hazard Reports, choose **Demo scenario only**, then **Place on a known demo road → Route A**. Save a Medium pothole with a description. Confirm the success notice, marker and row. Refresh: the report remains.
3. Return and recalculate. A's Reported Medium pothole contributes `20 × 1 × 0.6 = 12`, adding 1.8 equivalent minutes. B has lower cost in the supplied scenario.
4. Verify the report. The previous evaluation stays unchanged but becomes outdated. Manually recalculate: A's contribution becomes 20 and its risk-time penalty 3 minutes. B/C remain unaffected.
5. Reject/deactivate the report or let it expire; recalculate and confirm its contribution is zero. Add a far-away report and confirm scores do not change.
6. Edit an on-segment report into a Verified complete road blockage, select/confirm the actual road segment and save. Recalculate: that route is unavailable/red and another eligible route is recommended.
7. Move the complete closure onto **Shared starting road**, re-confirm and save. Recalculate: all three demo routes are unavailable and the dispatcher warning appears.
8. Deactivate/delete test reports and recalculate to recover. Restart the backend and refresh reports to verify persistence. Confirm health, sidebar navigation, map clicks/presets and route inspection still work.

## Checks and limitations

Automated tests cover migration/restart preservation, CRUD/validation, geographic distances and parallel roads, all weights/multipliers, duplicates, expiration/rejection, eligibility, cost conversion, traffic double counting, ranking, all-blocked behavior and the complete stored-hazard → manual evaluation flow. Stage 1/2 tests remain included.

OSRM and OSM tiles are best-effort external services. Demo calculation/scoring and SQLite persistence work offline; basemap tiles need internet. Historical analytics, automatic rerouting, fleet assignment and emergency saving remain outside scope. SQLite on Node 24 may emit an informational experimental warning.

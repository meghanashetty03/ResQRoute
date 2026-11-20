# ResQRoute — Stages 1–6

Local emergency route decision-support prototype: React/Vite, React Leaflet/OpenStreetMap, Express and SQLite. No deployment is configured. Both servers bind only to `127.0.0.1` on fixed ports.

## Exact localhost setup

Requires **Node.js 24+** and npm (tested with Node 24.14.0/npm 11.9.0). In PowerShell:

```powershell
Set-Location D:\ResQRoute
npm ci
```

Terminal 1:

```powershell
Set-Location D:\ResQRoute
npm run dev:backend
```

Terminal 2:

```powershell
Set-Location D:\ResQRoute
npm run dev:frontend
```

Open [Dashboard](http://127.0.0.1:5173). Check [API health](http://127.0.0.1:5000/api/health). Stop each service with Ctrl+C. Reuse existing development servers if these ports are occupied. Do not add public host flags or tunnels.

No environment files are required. The default database remains `backend/database/resqroute.sqlite`. Additive migrations preserve reports and saved calculations. Startup never resets or seeds hazards. Optional configuration is in `backend/.env.example` and `frontend/.env.example`; `DATABASE_PATH` resolves relative to `backend/`. Keep the existing path to retain your data. Frontend API configuration accepts only HTTP loopback port 5000. Node's experimental SQLite warning is informational.

## Implemented features

- Responsive dashboard/emergency routing, hazard reporting, real analytics and sidebar navigation.
- End-to-end two-leg planning: ambulance → patient and patient → manually selected hospital. Each leg has its own backend candidates, risk evaluation and recommendation.
- Map clicks, coordinate fields and Mangalore presets. Genuine OSRM geometry, distance and estimated travel time; a single result stays a single route.
- Local hospital directory with facility location, contacts and emergency-service capability tags. Hospital status is entered by staff/dispatchers or supplied by a future explicitly authorized backend feed; missing/expired data displays Unknown. Status updates retain source, updater, timestamp, notes and audit history. No bed counts or hospital recommendation are generated.
- Three geographically consistent, explicitly labelled predefined demo candidates with isolated hazard scope.
- Persistent hazard creation/editing, verification/rejection, activation/deactivation, expiry and deletion.
- Backend geometry matching, duplicate suppression, risk scoring, confirmed-closure eligibility and lowest-cost eligible recommendation.
- Automatic hazard/expiry-triggered reevaluation. Map/cards and recommendation-change explanations use backend results. Provider travel time and risk-adjusted cost remain distinct.
- Tab-scoped draft/calculation recovery after refresh. Session storage holds an identifier and draft; scores are fetched afresh from backend state. Unavailable storage degrades gracefully; a missing saved calculation requests a new one.
- Type-ahead search for ambulance, patient and hospital locations through a local backend proxy to Photon/OpenStreetMap. Every query uses a fixed regional relevance focus around Dakshina Kannada and Udupi; results with district metadata are ranked and labeled in-area, outside-focus or unconfirmed. This is a search preference, not a hard district boundary filter. Search suggestions carry provider coordinates into map markers and both routing legs; map selection and manual coordinates remain available. Search uses debounce, request cancellation, a short backend cache and clear no-result/provider-error states. Hospital directory matches keep manual hospital selection and recorded status; external place results have Unknown availability.
- SQLite analytics audit of actual scoring runs, candidate evaluations and recommendation changes; live/demo filters, current comparison and recent history. Unchanged polling does not inflate evaluations. Audit history begins with Stage 6; earlier missing history is not invented.

## Demo

See [DEMO_GUIDE.md](DEMO_GUIDE.md) for the presentation script, scoring and limitations.

1. **Load rerouting demo**: Route B recommended; risks A **67.5**, B **15**, C **12**.
2. **Verify demo blockage on B**: B unavailable, C automatically recommended without recalculation.
3. **Road Hazard Reports** → incident `stage5-blockage-b` → **Deactivate**: B recovers automatically.
4. Dashboard → **Reset demo routes**: original three reports, scores and B recommendation return. Repeat reset for the same result.

Both reset controls replace only dedicated scope `stage5-rerouting` reports, including edits/additional reports in that scope. Ordinary live and other demo reports remain. Analytics history remains. **Clear Demo Hazards** is a separate confirmed action; reset restores the seeded scenario afterward.

## Checks

```powershell
Set-Location D:\ResQRoute
npm run check
```

Runs backend/shared syntax checks, **54 automated tests**, and frontend production build. Tests use isolated SQLite databases and injected provider responses. Coverage includes validation/provider failures, geometry, scoring/deduplication, closures, hazard lifecycle/expiry, rerouting, notifications, no eligible candidate, repeated reset, real HTTP/database restart, hospital CRUD/status/audit/staleness, analytics, safe session persistence and place search including district ranking, coordinate validation and selected-coordinate two-leg integration.

Place search uses Photon’s public instance by default. It needs internet access and has no guaranteed uptime; if it is unavailable, choose points on the map or enter coordinates. The two-district focus uses Photon’s documented geographic relevance bias, not strict administrative-boundary polygons. Results lacking district metadata are labeled unconfirmed; district classification depends on OpenStreetMap address data. The backend setting `GEOCODER_BASE_URL` can point to an operator-configured Photon-compatible service; credentials, if a private provider requires them, belong in backend configuration and are never sent to the browser. Results are OpenStreetMap data and are labelled as such. [Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md)

With the backend running:

```powershell
node scripts/verify-rerouting.mjs
node scripts/verify-final.mjs
Invoke-RestMethod http://127.0.0.1:5000/api/health
```

Probes exercise and restore only the dedicated demo. The final probe also requests live OSRM and reports external unavailability honestly. Browser checks are separate from `npm run check`; no unattended browser runner is bundled. Follow the demo guide for repeatable UI verification.

## Architecture / API

`frontend/src/components`, `pages`, `hooks`, `services`: modular views, shared routing/hazard state, polling, API and session handling. `backend/routes`, `services`, `database`, `utils`: Express API, OSRM adapter, risk/rerouting engine, analytics audit and SQLite migrations. `shared/` holds scoring configuration/labels; `backend/data/demoScenario.json` includes geometry provenance.

- `GET /api/health`: real SQLite query, 503 on failure.
- `POST /api/routes/calculate`: `{ start:{lat,lng}, destination:{lat,lng}, mode:"live" }`.
- `GET /api/routes/:id/state`: backend evaluation/version/notifications and active watch.
- `POST /api/routes/recalculate`: manual retry with `calculationId`.
- `POST /api/routes/demo/reset` (alias `/api/routes/rerouting-demo/reset`): canonical seeded reset.
- `DELETE /api/routes/rerouting-demo/hazards`: explicit dedicated-scope clear.
- `GET/POST /api/hazards`, `GET/PATCH/DELETE /api/hazards/:id`.
- `GET /api/analytics?mode=all|live|demo`, optional `calculationId`.
- `GET/POST /api/hospitals`, `GET/PATCH/DELETE /api/hospitals/:id` (DELETE deactivates and retains history).
- `POST /api/hospitals/:id/availability`: staff-entered status with updater identity/role and optional notes.
- `POST /api/hospitals/:id/availability/refresh`: refreshes only through an injected authorized backend adapter; returns 503 when none is configured and never fabricates a value.
- `GET /api/geocode/search?q=...`: backend-proxied Photon place search with the Dakshina Kannada and Udupi regional focus.

Hospital status defaults to **30 minutes** before it becomes Unknown/stale. Configure `HOSPITAL_STATUS_STALE_MINUTES` in `backend/.env` (allowed range 1–1440). The current staff form records self-reported name and role; it is not authentication. Do not treat the statuses as verified outside this prototype.

Errors distinguish invalid input (400), missing records (404), unroutable locations (422), upstream failure (502) and database/service errors. CORS accepts only local frontend origins. Earlier algorithm details remain in [Stages 3–4](docs/STAGES_3_4.md) and [Stage 5](docs/STAGE_5.md); current reset, refresh and analytics behavior above supersedes older descriptions.

## Limitations

Public OSRM and OpenStreetMap tiles require internet. Demo scoring uses local saved geometry; failed tiles show a retry warning while polylines remain usable. OSRM may supply one candidate. Rerouting selects existing candidates; generating new closure-avoidance geometry is not supported. No eligible candidate means dispatcher review, never an invented route.

Estimates are ordinary driving snapshots without live traffic or ambulance-access guarantees. Risk reflects reports, not guaranteed safety. Views synchronize about every second; hazards about every two seconds; backend expiry checks every second. Disconnection can leave a visibly stale/error snapshot until recovery. No authorized hospital feed or account authentication is configured; availability is Unknown until a staff/dispatcher enters a status, then it expires to Unknown after the configured window. Fleet assignment, emergency saving, hospital recommendation, bed-capacity data and GPS are outside this prototype. This is not intended for real emergency dispatch or clinical use.

# Stage 6 completion and verification

Verified locally on 14 November 2026. No deployment or publishing performed. Existing local SQLite remains in use, with an additive analytics-history migration.

## Results

| Feature/check | Result | Evidence |
|---|---|---|
| Complete dashboard B → verified blockage → C → deactivate → B → reset B workflow | PASS | Browser interaction and real HTTP integration |
| Repeated primary demo resets | PASS | Exact initial risks 67.5 / 15 / 12, three seeded reports, B recommendation; repeated browser and API resets |
| Clear versus reset | PASS | Separate confirmed clear removes dedicated scope only; reset restores original hazards |
| Navigation and cross-section synchronization | PASS | Dashboard, Emergency Routing, Hazard Reports, Analytics; mobile sidebar |
| Backend connection | PASS | Actual SQLite health query, Stage 6 response, loopback ports verified |
| Map / locations / route selection | PASS | Loaded OSM tiles and three demo polylines; map click updated start; presets; candidate review preserves recommendation |
| Live OSRM routing | PASS | Real API and frontend requests returned one genuine candidate; no alternatives invented |
| Hazard create/edit/verify/deactivate | PASS | Browser create/edit persisted after refresh; verification/deactivation updated recommendation automatically |
| Persistence across server restart | PASS | Automated real HTTP server shutdown and SQLite file reopen retained hazard, calculation and analytics |
| Geometry matching, risk, duplicate reports, closures | PASS | Existing risk/geometry unit and API tests |
| Automatic rerouting and hazard removal/expiry recovery | PASS | Automated lifecycle coverage and real local integration probe |
| No eligible candidate / notification content | PASS | Backend tests and local all-blocked probe; null recommendation and dispatcher-review warning |
| Analytics | PASS | Persisted scoring snapshots, live/demo filtering, real history/counts, unchanged polling not counted |
| Invalid coordinates / provider failure / missing routes / database failure | PASS | Deterministic automated error tests; no fabricated successful result |
| Browser refresh | PASS | Verified closure and C recommendation restored through backend state; edited report persisted |
| Responsive layout / console | PASS | Desktop 1440 and mobile 390 viewport checks; no horizontal page overflow at 390; no observed browser warning/error logs |
| Frontend build / syntax | PASS | Vite build; 30 backend/shared JavaScript files checked |

**Automated tests: 40 passed, 0 failed, 0 skipped.** The original 34 tests remain; six Stage 6 tests cover full reset workflow, explicit clear, real analytics, server/database restart, database failures and safe session storage. Browser checks were tool-driven against the running app, separate from the automated test count. No unattended browser runner was added.

Both real integration probes passed:

```powershell
npm run check
node scripts/verify-rerouting.mjs
node scripts/verify-final.mjs
```

The final frontend build was repeated after map-zoom/status styling changes and passed. Disposable browser reports were removed by resetting their dedicated demo scope. Ordinary live reports were preserved; the application was left with the original three demo hazards and B recommended.

## Fixes and improvements

- Primary **Reset demo routes** now uses the same seeded backend reset as the rerouting demo control. The previous geometry-only reset could recommend A without restoring the reproducible reports.
- A separate confirmed clear action removes only dedicated demo hazards; reset never doubles as clear.
- Refresh restores this tab's draft and saved calculation identifier, then obtains current scores from the backend. Missing/corrupt/disabled browser storage has explicit safe recovery.
- Real SQLite-backed route analytics replaces the unfinished view. Audit history starts with Stage 6; actual history survives resets/restarts. Counts cover scoring runs across stored calculations, including multiple watched calculations.
- Polling no longer refits map bounds each second and undoes pan/zoom. Explicit Fit and new calculations still fit geometry.
- Improved route metrics, hazard verification badges, legends, loading/empty/error states and responsive analytics tables. Reset/clear/verification controls guard overlapping operations.
- Updated Stage 6 status, exact localhost README and hackathon demo guide.

## Remaining limits / manual coverage

No blocking errors remain in the checks above. Live routing and tiles depend on external public services; the verified live response supplied one candidate. Rerouting uses existing candidates, not newly generated avoidance geometry. No live traffic or guaranteed ambulance access. Analytics has no reconstructed pre-Stage-6 history. Node SQLite prints an informational experimental warning.

Browser verification covered the available in-app browser at desktop/mobile viewport sizes. Physical phones, other browsers, screen-reader audits and sustained load testing remain unverified. The all-blocked, provider/database-failure and expiry scenarios were verified through automated tests/API probes rather than every failure being reproduced interactively in the browser.

See [DEMO_GUIDE.md](../DEMO_GUIDE.md) for the final presentation script and [README.md](../README.md) for exact localhost startup commands.

# Stage 5: dynamic rerouting on localhost

The existing hazard storage, geographic matching, scoring weights, eligibility rules, OSRM adapter and original candidate geometry are preserved. No cloud services, hosting, tunnels, authentication, fleet tracking or unrelated features were added.

## Behavior

After a hazard is created, edited, verified, rejected, activated/deactivated or deleted, the hazard API immediately reevaluates active calculations using the existing backend scoring engine. A calculation is active while its state is being watched, with a 60-second grace lease. All candidates are rescored conservatively; a distant or other-scope report leaves their relevant scores unchanged. No notification is generated unless the recommendation actually changes.

The backend checks expiration for active calculations every second using a worker tied to the local HTTP server's lifetime. The frontend watches its active calculation via `GET /api/routes/:id/state` approximately every second. State requests also check expiry, even when the revision counter has not changed, and catch up after a server restart or temporarily inactive browser tab. Calculations whose 60-second watching lease has expired are reevaluated when viewed again. Background browser throttling or connectivity can delay visible updates; returning to a visible tab requests synchronization immediately.

Hazard records refresh automatically about every two seconds. Both hooks stay mounted in App while moving between dashboard, routing, hazard management and analytics. New calculations immediately refresh the hazard catalogue. Dashboard markers use exactly the current routing mode/scenario, while hazard management can inspect all records.

Backend evaluation versions and client request cancellation prevent older responses from replacing newer route results. If synchronization fails, the last received evaluation remains visible with an error/outdated warning and automatic retries. The manual **Recalculate Routes** control remains available. The UI never claims a new recommendation merely because a request was attempted.

## Candidate and ETA transparency

Rerouting reuses the original candidates stored in SQLite. It recalculates risk, complete-closure eligibility, risk-time penalty, final cost and ranking. It does not move any geometry, alter a provider's duration, or create an extra candidate to bypass a closure. OSRM avoidance generation is not implemented. If all existing candidates are excluded, the actual backend warning requests dispatcher review.

Cards explicitly separate **Provider ETA to patient** from **Risk-adjusted cost**. Selecting a different recommended candidate can change the displayed travel duration, but each candidate's original ETA is unchanged. Risk-time penalties are equivalent minutes for ranking, not a prediction of actual arrival delay.

## Notifications

Recommendation changes produce a persisted backend event with:

- Previous/new route IDs and names, timestamp, trigger action and hazard ID.
- A reason derived from actual eligibility, closure reports and route costs.
- Previous/new provider travel estimates and their difference.
- Previous/new risk-adjusted costs and their difference.
- `providerEstimatesChanged: false` and an existing-candidate limitation.

The notification remains available across sidebar navigation; the latest 20 events are retained per calculation and shown in a history disclosure. Polling an unchanged recommendation does not repeat an event. If no eligible route remains, the new route and travel/cost values are null, and the warning never invents an available route.

## Database/API additions

An additive transaction adds nullable `hazards.scenario_id` and the `route_runtime` table, recording migration version 2. Existing records retain null scenario IDs and their previous behavior. Runtime rows store the last computed evaluation, version, notification history, active lease and synchronization error; they reference the original `route_calculations` cache. No data is dropped during migration.

- `GET /api/routes/:id/state`: automatically synchronize and return current backend evaluation, version, events and existing-candidate limitation; refresh the active lease. Missing calculations return 404.
- `POST /api/routes/rerouting-demo/reset`: restore only the dedicated rerouting scenario's reports and return a fresh evaluated calculation.
- Existing hazard mutations now immediately reevaluate active calculations. A successful hazard save remains confirmed even if a route update fails; `reroutingErrors` identifies that separate failure and subsequent state checks retry.
- Existing calculate/manual-recalculate responses now include evaluation versions and notifications. No frontend geometry or risk values are accepted for scoring.

## Reproducible demo

**Load rerouting demo** creates three simulated reports in isolated `scenario_id = stage5-rerouting`:

1. Verified High flooding on A: risk 67.5, cost about 16.47 equivalent minutes.
2. Reported Medium damage on C: risk 12, cost about 12.34 equivalent minutes.
3. Reported Low complete blockage on B, with same-road confirmation: risk 15, still eligible, cost about 9.79 equivalent minutes.

B is initially recommended. Clicking **Verify demo blockage on B** changes the real SQLite report to Verified. B becomes ineligible and C is recommended automatically. The event reports B → C and explains the verified closure. B's travel estimate remains 7.545 minutes and C's remains 10.5383 minutes; selection changes which one is displayed.

**Reset rerouting demo** recreates these three reports and starts a fresh calculation/history. It removes only reports in this explicitly dedicated demo scope, including additional reports the operator added to that scope. Ordinary live reports and classic-demo reports are preserved. Existing viewers automatically receive the new demo report IDs after a reset. No reports are seeded simply by starting the application.

## Manual verification

1. From `D:\ResQRoute`, start backend/frontend in separate terminals with `npm run dev:backend` and `npm run dev:frontend`. Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Backend: [http://127.0.0.1:5000](http://127.0.0.1:5000). Both remain bound to `127.0.0.1` only.
2. Click **Load rerouting demo**. Confirm B is recommended; compare provider ETA and adjusted cost.
3. Click **Verify demo blockage on B**. Do not click Recalculate. Within the next successful automatic synchronization, C becomes green/recommended, B becomes red/dashed/unavailable, and the Route Updated notification explains B → C.
4. Open **Road Hazard Reports**. Find the simulated B blockage. Deactivate, reject or delete it. The global notification and active route evaluation update automatically even while that section is open. Return to the dashboard; B is eligible again and recommended.
5. Add a new report with scope **Rerouting demo**, on one of its known road segments. Edit severity/verification, set a future expiration, or remove it. Watch actual scores update automatically; after expiration it contributes zero.
6. To test no alternative, create a complete closure on the shared starting road, confirm the same segment and verify it. All three candidates become unavailable; dispatcher review is requested. Removing/deactivating/rejecting the closure restores eligible candidates automatically.
7. Reset the dedicated demo to repeat. Ordinary reports remain intact.

## Checks

`npm run check` runs backend/shared syntax checks, all 34 tests and the frontend build. New tests cover creation-triggered backend reevaluation before a state read, closure verification and B → C selection, editing/rejection/deactivation/deletion recovery, all candidates blocked, expiration without a revision change, accurate event content, stable candidate geometry/ETA, no duplicate polling alerts and reproducible reset without deleting ordinary hazards.

With the local backend running, `node scripts/verify-rerouting.mjs` performs real HTTP integration checks including real-time expiration, closure/recovery, all-blocked state, notifications and ordinary-report preservation. This command resets the dedicated demo, cleans its disposable extra reports and leaves its three original demo reports ready to use.

The original map-matching and duplicate heuristics remain prototype limitations. Public map tiles/live OSRM require internet; rerouting among saved demo candidates and local SQLite persistence do not. Node 24's SQLite experimental warning remains informational. No automatic retention policy is added to the existing local candidate cache; notification history is bounded to 20 per calculation.

Verification completed: all 34 tests, syntax checks for 27 backend/shared JavaScript files, the frontend build and the live localhost integration probe passed. Browser checks observed B → C after verification and C → B after deactivation while viewing hazard management, with no manual recalculation. Map line colors, card selection, notification travel/cost values and demo reset matched backend results. The notification fit at 390 px without horizontal overflow; the final browser check captured no console warnings/errors. Disposable probe reports were removed and the dedicated demo was left reset; ordinary reports were preserved.

# ResQRoute hackathon demo guide

## Introduction and problem

ResQRoute is a localhost emergency dispatch decision-support prototype. The shortest journey can be unsuitable when flooding or a complete blockage affects its roads. Dispatchers need understandable comparisons of travel time, reported hazards and route availability.

## Main innovation

Geometry-matched hazards drive backend risk scoring, hard closure eligibility and time-plus-risk ranking. Report changes automatically update recommendations, map highlights, route cards and explanations using actual calculations. A verified complete closure excludes its affected candidate rather than merely changing a colour.

## Architecture

```text
React / Vite / React Leaflet — 127.0.0.1:5173
          | local JSON API + state polling
Express backend — 127.0.0.1:5000
          |-- live OSRM route adapter (internet)
          |-- saved Mangalore demo geometries
          |-- geometry matching → risk → eligibility → cost ranking
          |-- hazard/expiry reevaluation → notification history
          `-- local SQLite: reports, segments, candidates, runtime, analytics
OpenStreetMap: attributed basemap tiles (internet)
```

Use README's exact two-terminal startup commands. Before presenting, open the dashboard, confirm the green connection banner and load the demo. Nothing is hosted or deployed.

## Step-by-step demonstration

1. Open **Dashboard** and click **Load rerouting demo**, or **Reset demo routes** if already loaded. The Mangalore/Kankanady endpoints are fixed and clearly labelled demo.
2. Confirm **Route B** is recommended. A has verified High flooding, B a Reported Low complete blockage on a confirmed segment, C Reported Medium potholes. A reported blockage contributes risk but is not yet a verified closure.
3. Inspect route cards/map. Green means recommended; blue eligible alternative; orange higher reported risk; red/dashed verified closure. Thicker means selected for review. Selecting a card/line does not override backend eligibility or recommendation. Expand risk details to inspect matched reports.
4. Click **Verify demo blockage on B**. Wait about one second without clicking Recalculate: B becomes **Unavailable – Verified Road Closure**, C becomes recommended and green. Read the actual closure explanation and the separate travel-time/cost changes.
5. Refresh the browser. C and the verified report remain. The app fetches the saved backend calculation instead of resetting the scenario. Navigate among sections to demonstrate synchronization.
6. Open **Road Hazard Reports**, find incident `stage5-blockage-b`, click **Deactivate**. The recommendation changes to B even while this section is open. Return to Dashboard: B is eligible again. A/C still have their original reports; B now contributes zero risk because inactive.
7. Click **Reset demo routes**. The original three hazards, scores and B recommendation return. Repeat reset to prove consistency and no duplicate accumulation. Reset preserves ordinary reports and analytics history.
8. Open **Route Analytics**, select Demo scope and inspect actual evaluation counts, current route metrics and recent decisions. Counts are persisted records; unchanged polling does not fabricate new evaluations. Explicit resets are real evaluations and can increase history counts.

## Initial expected values

| Route | Report | Travel minutes | Risk /100 | Adjusted cost minutes | Status |
|---|---|---:|---:|---:|---|
| A | Verified High flooding | 6.3433 | 67.5 | 16.4683 | Eligible |
| B | Reported Low complete blockage | 7.5450 | 15 | 9.7950 | Recommended |
| C | Reported Medium potholes | 10.5383 | 12 | 12.3383 | Eligible |

The UI rounds values. Verification gives B risk 25 but excludes it regardless of cost; C wins among eligible candidates. Deactivation makes B risk zero/cost 7.5450. Reset restores its Reported risk 15/cost 9.7950.

Both reset controls restore reports in dedicated scope `stage5-rerouting`, including replacing edits/additional reports in that scope. Other reports remain. **Clear Demo Hazards** is separate and requires its inline confirmation. It removes only that scope; with these reports absent, A normally wins. Reset restores the three seeded reports. Do not clear during the main presentation unless explaining this distinction.

## Scoring explanation

The backend matches reports to actual route geometry using geographic distance, scope and road-segment identity. Inactive, expired, rejected or unrelated reports contribute zero. Applicable contribution is type base penalty × severity × verification confidence. Duplicate incident reports count their maximum contribution once. Risk is capped at 100.

```text
risk = min(100, sum of deduplicated applicable contributions)
cost = provider travel minutes + additional traffic delay + risk × 0.15
recommendation = lowest-cost eligible route
```

Additional traffic delay is currently zero: there is no live traffic feed. Equivalent-minute risk cost is a comparison metric, not predicted physical delay. An active Verified complete closure on its confirmed actual road segment excludes affected routes. Proximity alone cannot impose a hard exclusion. A low risk score reflects available reports, not guaranteed safety.

## Dynamic rerouting

Creation, edits, verification, rejection, deactivation, deletion and expiration reevaluate watched candidates in the backend. Runtime results and actual analytics records are persisted; notifications explain recommendation changes. Polling synchronizes the UI; the backend expiry worker does not require the hazards section to be open.

Candidates keep their original geometry and travel estimates. A travel-time change in a notification results from selecting a different candidate; risk-adjusted cost is reported separately. When all candidates are ineligible, recommendation is null and the UI requests dispatcher review. No bypass is invented.

## Verification and live routing

```powershell
Set-Location D:\ResQRoute
npm run check
node scripts/verify-rerouting.mjs
node scripts/verify-final.mjs
```

Run probes with the local backend running. They exercise and restore only dedicated demo reports, including an all-blocked scenario and real-time expiry. Automated tests use isolated databases and injected provider failures. Browser checks follow the script above; there is no bundled unattended browser runner.

For live routing click **Use live routing**, choose Central Mangalore start and Kankanady pickup presets, then **Find routes**. Inspect actual OSRM results. One returned candidate is valid; never present it as three alternatives. If the provider fails, show the error and explicitly load the demo. Restore the rerouting demo before presenting.

## Known limitations

- Prototype only, not certified emergency dispatch or clinical software; reports require human judgment.
- No new avoidance geometry generation. Rerouting selects existing candidates; all blocked means dispatcher review.
- Public OSRM/tiles require internet and can fail. Demo routes are labelled snapshots with provenance in `backend/data/demoScenario.json`; local scoring works without live routing, and tile failure has a retry warning.
- No live traffic, fleet GPS, emergency saving or hospital-routing workflow. Provider ETA is ordinary driving duration to the patient.
- Polling introduces a short delay; disconnection may leave a visible stale snapshot. Refresh convenience is tab-scoped; SQLite data survives independently.
- Analytics history begins with Stage 6. Missing historical decisions are not reconstructed; repeated demo runs retain history.

## Potential Phase 2 improvements — not implemented

Provider-supported closure avoidance, validated traffic feeds, secure dispatcher roles and verification audit, emergency/fleet/GPS workflows, hospital capability/availability integration, calibrated risk coefficients, push synchronization and broader device/accessibility testing.

import { useState } from 'react';
import { FlaskConical, RefreshCw, ShieldAlert } from 'lucide-react';
import { EmergencyForm } from '../components/EmergencyForm.jsx';
import { MapContainer } from '../components/MapContainer.jsx';
import { Recommendation, RouteComparison } from '../components/RouteComparison.jsx';
import { useNow } from '../hooks/useNow.js';
import { JourneyProgress } from '../components/JourneyProgress.jsx';

export function Dashboard({ draft, routing: state, hazards, hospitals }) {
  const now = useNow();
  const [confirmClear, setConfirmClear] = useState(false);
  const evaluations=state.data?.trip?Object.values(state.data.trip.legs):state.data?[state.data]:[];
  const stale = Boolean(state.data && (state.status !== 'success' || evaluations.some((evaluation)=>(hazards.revision !== null && hazards.revision > evaluation.hazardRevision)
    || (evaluation.nextHazardExpiration && Date.parse(evaluation.nextHazardExpiration) <= now))));
  const routing = { ...state, stale };
  const busy = routing.status === 'loading' || routing.demoAction.busy || hazards.busy;
  const dedicatedDemo = routing.data?.scenarioId === 'stage5-rerouting';
  const demoBlockage = hazards.reports.find((report) => report.id === routing.data?.demoBlockageId);
  return <>
    <details className={`demo-scenario ${routing.mode}`}>
      <summary><FlaskConical size={17} /><strong>Demo scenario</strong><span>{routing.mode === 'demo' ? 'Prepared routes · simulated estimates' : 'Separate from trip planning · loads prepared locations and routes'}</span></summary>
      <div className="demo-scenario-body">
        <p>Demo routes include flooding on A, a reported blockage on B and potholes on C. Verify B to see automatic rerouting. Loading the demo replaces the current trip locations and routes.</p>
        <div className="demo-actions">
          {!dedicatedDemo && <button className="secondary-button" disabled={busy} onClick={routing.loadReroutingDemo}>Load rerouting demo</button>}
          {routing.mode === 'demo' && <button className="secondary-button" disabled={busy} onClick={() => { setConfirmClear(false); routing.loadDemo(); }}>Reset demo routes</button>}
          {dedicatedDemo && <button className="secondary-button demo-verify" disabled={busy || !demoBlockage || demoBlockage.verification_status === 'Verified'} onClick={() => hazards.update(routing.data.demoBlockageId, { verification_status: 'Verified' })}>Verify demo blockage on B</button>}
          {routing.mode === 'demo' && <button className="text-button" disabled={busy} onClick={routing.useLive}>Return to trip planning</button>}
          {dedicatedDemo && <button className="text-button danger-action" disabled={busy} onClick={() => setConfirmClear(!confirmClear)}>Clear Demo Hazards</button>}
        </div>
        {confirmClear && dedicatedDemo && <div className="delete-confirm">Clear this demo’s reports? Other reports are unchanged. Reset restores the demo hazards.<div><button disabled={busy} onClick={async () => { await routing.clearDemoHazards(); setConfirmClear(false); hazards.refresh({ silent: true }); }}>Clear demo hazards</button><button disabled={busy} onClick={() => setConfirmClear(false)}>Cancel</button></div></div>}
      </div>
    </details>
    {routing.demoAction.message && <p className="save-notice" role="status">{routing.demoAction.message}</p>}
    {routing.demoAction.error && <p className="routing-error" role="alert">{routing.demoAction.error}</p>}
    {hazards.actionError && <p className="routing-error" role="alert">{hazards.actionError}</p>}
    {hazards.error && <p className="routing-error" role="alert">Hazard information could not be updated. {hazards.error}</p>}
    <JourneyProgress routing={routing} />
    <div className={`workspace-tools ${stale ? 'outdated' : ''}`}>
      <span role="status">{stale ? 'Updating routes… Showing the last results.' : routing.status === 'loading' ? 'Loading routes…' : routing.data ? 'Route recommendations update when hazard reports change.' : 'Enter all three locations to plan the trip.'}</span>
      <div><button className="text-button" disabled={!routing.data?.calculationId || busy} onClick={routing.recalculate}><RefreshCw size={13} />Recalculate routes</button><a href="#hazards" className="text-button"><ShieldAlert size={14} />Road hazards</a></div>
    </div>
    <div className="dashboard-grid">
      <EmergencyForm draft={draft} setDraft={routing.changeDraft} routing={routing} hospitals={hospitals} />
      <div className="operations-column"><Recommendation routing={routing} /><MapContainer draft={draft} routing={routing} hazards={hazards} /><RouteComparison routing={routing} /></div>
    </div>
  </>;
}

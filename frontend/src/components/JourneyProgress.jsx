import { useJourney } from '../hooks/useJourney.js';

const steps=[
  ['planned','Planned'],['en_route_to_patient','En route to patient'],['arrived_at_patient','Arrived at patient'],['patient_picked_up','Patient picked up'],
  ['en_route_to_hospital','En route to hospital'],['arrived_at_hospital','Arrived at hospital'],['handover_completed','Handover completed'],
];
const capabilityLabels={emergency:'Emergency department',trauma:'Trauma care',cardiac:'Cardiac care',pediatric:'Pediatric emergency',icu:'ICU',surgery:'Surgery',burn:'Burn care'};
const statusLabels={accepting:'Accepting ambulances',limited:'Limited',diverting:'Diverting / not accepting',unknown:'Unknown / stale'};
const nextAction={planned:['en_route_to_patient','Start ambulance to patient'],en_route_to_patient:['arrived_at_patient','Mark arrived at patient'],arrived_at_patient:['patient_picked_up','Confirm patient pickup'],en_route_to_hospital:['arrived_at_hospital','Mark arrived at hospital'],arrived_at_hospital:['handover_completed','Complete patient handover']};
function time(value){return value?new Date(value).toLocaleString():'—';}

export function JourneyProgress({routing}){
  const journey=useJourney(routing.journeyId,routing);
  if(!routing.trip||!routing.journeyId)return null;
  const currentStep=steps.findIndex(([id])=>id===journey.journey?.status);
  return <section className="panel journey-panel" aria-labelledby="journey-heading" aria-busy={journey.status==='loading'||journey.busy}>
    <div className="panel-heading"><h2 id="journey-heading">Ambulance journey</h2><span className="subtle-tag">{journey.journey?steps.find(([id])=>id===journey.journey.status)?.[1]||'Status unavailable':'Loading status'}</span></div>
    {journey.error&&<p className="routing-error" role="alert">{journey.error}</p>}
    {journey.journey&&<>
      <ol className="journey-steps" aria-label="Journey progress">{steps.map(([id,label],index)=><li key={id} className={index<currentStep?'complete':index===currentStep?'current':''}><span>{index<currentStep?'✓':index+1}</span><div><strong>{label}</strong><small>{time(journey.journey.timestamps[id])}</small></div></li>)}</ol>
      {journey.journey.hospital&&<div className="journey-selected-hospital"><strong>{journey.journey.hospitalId?'Selected hospital':'Current destination'}: {journey.journey.hospital.name}</strong><span>{journey.journey.hospital.address}</span><span className={`hospital-status-badge ${journey.journey.hospital.availability.status}`}>{statusLabels[journey.journey.hospital.availability.status]}</span><small>{journey.journey.hospital.availability.sourceLabel} · {journey.journey.hospital.availability.lastUpdatedAt?time(journey.journey.hospital.availability.lastUpdatedAt):'no update recorded'}</small>{journey.journey.hospital.availability.status!=='accepting'&&<p className="hospital-contact-warning">Contact the hospital to confirm ambulance acceptance.</p>}</div>}
      {journey.journey.status==='patient_picked_up'&&!journey.journey.hospitalId&&!journey.journey.hospitalConfirmedAt&&<button className="secondary-button journey-action" disabled={journey.busy||!journey.journey.hospital} onClick={journey.confirmCurrentDestination}>Confirm current destination</button>}
      {journey.journey.hospitalConfirmedAt&&!journey.journey.patientToHospitalEligible&&<p className="no-route-warning" role="alert">No eligible route to the selected hospital. Dispatcher review is required.</p>}
      {nextAction[journey.journey.status]&&<button className="primary-button journey-action" disabled={journey.busy||journey.status==='loading'} onClick={()=>journey.advance(nextAction[journey.journey.status][0])}>{journey.busy?'Saving…':nextAction[journey.journey.status][1]}</button>}
      {journey.journey.status==='patient_picked_up'&&<HospitalRecommendations state={journey} onSelect={journey.selectHospital}/>}
      {journey.journey.status==='handover_completed'&&<div className="save-notice journey-complete" role="status">Patient handover recorded at {time(journey.journey.timestamps.handover_completed)}. {journey.journey.ambulanceUpdateNote}</div>}
    </>}
  </section>;
}

function HospitalRecommendations({state,onSelect}){
  const journey=state.journey;const options=journey.recommendations||[];
  return <section className="hospital-recommendations" aria-labelledby="hospital-recommendations-heading">
    <div className="hospital-recommendations-heading"><div><h3 id="hospital-recommendations-heading">Hospital recommendations</h3><p>Compare routes and recorded acceptance status, then confirm a destination.</p></div><button className="text-button" disabled={state.recommendationBusy} onClick={state.refreshRecommendations}>{state.recommendationBusy?'Refreshing…':'Refresh options'}</button></div>
    <p className="hospital-score-method">Comparison score: 70% relative route cost, 30% recorded acceptance status. Facility capabilities are shown for review; patient-specific treatment needs are not recorded.</p>
    {state.recommendationBusy&&<p className="routing-message" role="status">Calculating routes to directory hospitals…</p>}
    {journey.recommendationsGeneratedAt&&<p className="hospital-recommendation-updated">Routes assessed {time(journey.recommendationsGeneratedAt)}. Acceptance status is refreshed from the directory.</p>}
    {!state.recommendationBusy&&options.length===0&&<p className="routing-message">No active hospitals are in the directory. Add facilities in <a href="#hospitals" className="text-button">Hospital availability</a>.</p>}
    <div className="hospital-recommendation-list">{options.map((option)=>{
      const hospital=option.hospital,route=option.bestRoute;
      return <article key={hospital.id} className={`hospital-recommendation-card ${option.rank===1?'top-ranked':''}`}>
        <div className="hospital-recommendation-card-heading"><div><h4>{hospital.name}</h4><p>{hospital.address}</p></div>{option.rank&&<span className="hospital-rank">Rank {option.rank} · {option.score}/100</span>}</div>
        <div className={`hospital-status-line ${hospital.availability.status}`}><strong>{statusLabels[hospital.availability.status]}</strong><span>{hospital.availability.sourceLabel} · {hospital.availability.lastUpdatedAt?time(hospital.availability.lastUpdatedAt):'no update recorded'}</span></div>
        {hospital.availability.status!=='accepting'&&<p className="hospital-contact-warning">{hospital.availability.status==='diverting'?'This hospital is not accepting ambulances. Contact it before considering this destination.':'Acceptance is limited, unknown or stale. Contact the hospital to confirm.'}</p>}
        {hospital.capabilities.length>0&&<p className="hospital-capabilities-summary">Recorded services: {hospital.capabilities.map((item)=>capabilityLabels[item]||item).join(' · ')}</p>}
        {route?<div className="hospital-route-factors"><span>Distance <strong>{route.distanceKm.toFixed(1)} km</strong></span><span>Estimated travel <strong>{route.durationMinutes.toFixed(1)} min</strong></span><span>Reported risk <strong>{route.riskScore}/100</strong></span><span>Risk-adjusted cost <strong>{route.finalCost.toFixed(2)} min</strong></span><span>Route <strong>{route.isEligible?'Eligible':'Unavailable'}</strong></span></div>:<p className="routing-error">{option.routeError||option.explanation||'No eligible route to this hospital.'}</p>}
        <p className="hospital-rank-explanation">{option.explanation}</p>
        <button className="secondary-button" disabled={state.busy||!route||!hospital.isActive||journey.status!=='patient_picked_up'||journey.hospitalId===hospital.id} onClick={()=>onSelect(hospital.id)}>{journey.hospitalId===hospital.id?'Selected destination':'Select this hospital'}</button>
      </article>;
    })}</div>
      {journey.hospitalConfirmedAt&&<button className="primary-button journey-action" disabled={state.busy||!journey.patientToHospitalCalculationId||!journey.patientToHospitalEligible} onClick={()=>state.advance('en_route_to_hospital')}>{state.busy?'Saving…':'Start transport to hospital'}</button>}
  </section>;
}

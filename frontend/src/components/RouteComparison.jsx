import { Route } from 'lucide-react';

export function RouteComparison({ routing }) {
  if(routing.trip)return <TripComparison routing={routing} />;
  const selected=routing.routes.find((route)=>route.id===routing.selectedId);
  return <section className="panel comparison-panel risk-comparison" aria-labelledby="comparison-heading" aria-busy={routing.status==='loading'}>
    <div className="comparison-main"><div className="panel-heading"><span className="section-icon"><Route size={18} /></span><h2 id="comparison-heading">Route comparison</h2><span className="subtle-tag">{routing.mode==='demo'?'Demo routes':'Live routes'}</span></div>
      {routing.status==='loading'&&<p className="routing-message" role="status">{routing.data?'Updating routes…':'Finding and assessing routes…'}</p>}
      {routing.error&&<p className="routing-error" role="alert">{routing.error}</p>}
      {routing.routes.length>0 ? <>
        <div className="route-rows" role="group" aria-label="Select route">{routing.routes.map((route)=><article key={route.id} className={`risk-route-card ${route.isRecommended?'recommended':''} ${!route.isEligible?'unavailable':''}`}>
          <button className={`route-choice risk-route-choice ${selected?.id===route.id?'selected':''}`} aria-label={`Select ${route.name}`} aria-pressed={selected?.id===route.id} onClick={()=>routing.setSelectedId(route.id)}>
            <span className="route-title"><strong>{route.name}</strong>{route.isRecommended&&<span className="recommended-badge">Recommended{routing.stale?' · outdated':''}</span>}<span>{route.distanceKm.toFixed(2)} km</span></span>
            <span className="route-metrics"><span>Estimated travel to patient<strong>{route.durationMinutes.toFixed(1)} min</strong></span><span>Reported risk<strong>{route.riskScore}/100</strong></span><span>Relevant incidents<strong>{route.relevantHazardCount}</strong></span><span>Risk-adjusted cost<strong>{route.finalCost.toFixed(2)} min</strong></span></span>
            <span className="risk-category">{route.riskCategory}</span><span className={`eligibility-label ${route.isEligible?'':'closed'}`}>{route.eligibilityStatus}</span>{route.matchedHazards.some((hazard)=>hazard.verificationStatus==='Reported')&&<span className="unverified-warning">Unverified hazard reports</span>}
          </button>
          <details className="risk-details"><summary>Risk and cost explanation</summary><p>{route.riskExplanation}</p><p>{route.durationMinutes.toFixed(2)} travel + {route.trafficDelayMinutes.toFixed(2)} traffic + {route.riskTimePenaltyMinutes.toFixed(2)} risk penalty = {route.finalCost.toFixed(2)} equivalent minutes.</p>{route.matchedHazards.map((hazard)=><p key={hazard.id}>{hazard.label} · {hazard.severity} · {hazard.verificationStatus} · {hazard.contribution} points · {hazard.reportIds.length} report(s){hazard.confirmedClosure?' · confirmed complete closure':''}</p>)}</details>
        </article>)}</div>
        <p className="routing-message">{routing.data.notice}</p>{routing.mode==='live'&&routing.routes.length===1&&<button className="text-button" onClick={routing.loadDemo}>Load demo · replaces current trip</button>}
        <details className="risk-details scoring-details"><summary>Risk scoring and route limits</summary><p>Scores reflect hazard type, severity, verification and proximity to the route. Duplicate reports for one incident are counted once. A confirmed complete closure makes the affected route unavailable.</p><p>{routing.data.matchingLimitation}</p><p>{routing.data.reroutingLimitation}</p></details>
      </> : routing.status==='idle'&&<div className="comparison-empty"><Route size={22} /><div><strong>Plan a trip to compare routes</strong><p>Enter locations above or choose them on the map.</p></div></div>}
    </div>
    {selected&&<div className="selected-route-summary"><strong>Selected for review: {selected.name}</strong><p>{selected.eligibilityStatus} · {selected.durationMinutes.toFixed(1)} min to patient. Selection highlights the route but does not change its eligibility or recommendation.</p></div>}
  </section>;
}

function TripLeg({routing,legId,label,leg,travelLabel}) {
  const recommended=leg.routes.find((route)=>route.id===leg.recommendedRouteId);
  return <section className="trip-leg" aria-labelledby={`${legId}-heading`}>
    <div className="trip-leg-heading"><div><span className="eyebrow">{legId==='ambulanceToPatient'?'LEG 1':'LEG 2'}</span><h3 id={`${legId}-heading`}>{label}</h3></div><span className={`eligibility-label ${recommended?'':'closed'}`}>{recommended?`Recommended · ${recommended.name}`:'Dispatcher review required'}</span></div>
    <p className="trip-route-points">{leg.start?.lat.toFixed(5)}, {leg.start?.lng.toFixed(5)} → {leg.destination?.lat.toFixed(5)}, {leg.destination?.lng.toFixed(5)}</p>
    {!recommended&&<p className="no-route-warning" role="alert">{leg.recommendationExplanation||'No eligible existing candidate route. Dispatcher review required.'}</p>}
    <div className="trip-route-list">{leg.routes.map((route,index)=><article key={`${legId}:${route.id}`} className={`risk-route-card ${route.isRecommended?'recommended':''} ${!route.isEligible?'unavailable':''}`}>
      <button className={`route-choice risk-route-choice ${routing.selectedId===`${legId}:${route.id}`?'selected':''}`} aria-label={`Select ${label} ${route.name}`} aria-pressed={routing.selectedId===`${legId}:${route.id}`} onClick={()=>routing.setSelectedId(`${legId}:${route.id}`)}>
        <span className="route-title"><strong>{route.name}</strong>{route.isRecommended&&<span className="recommended-badge">Recommended</span>}<span>{route.distanceKm.toFixed(2)} km</span></span>
        <span className="route-metrics"><span>Estimated travel<strong>{route.durationMinutes.toFixed(1)} min</strong></span><span>Reported risk<strong>{route.riskScore}/100</strong></span><span>Relevant incidents<strong>{route.relevantHazardCount}</strong></span><span>Risk-adjusted cost<strong>{route.finalCost.toFixed(2)} equiv. min</strong></span></span>
        <span className="risk-category">{route.riskCategory}</span><span className={`eligibility-label ${route.isEligible?'':'closed'}`}>{route.eligibilityStatus}</span>{route.matchedHazards.some((hazard)=>hazard.verificationStatus==='Reported')&&<span className="unverified-warning">Unverified hazard reports</span>}
      </button><details className="risk-details"><summary>Risk and cost explanation</summary><p>{route.riskExplanation}</p><p>{travelLabel}: {route.durationMinutes.toFixed(2)} min. Risk-adjusted cost: {route.finalCost.toFixed(2)} equivalent minutes.</p>{route.matchedHazards.map((hazard)=><p key={hazard.id}>{hazard.label} · {hazard.verificationStatus} · {hazard.contribution} points · {hazard.confirmedClosure?'confirmed complete closure':''}</p>)}</details>
    </article>)}</div>
    <p className="routing-message">{leg.notice}</p>
  </section>;
}

export function TripComparison({routing}) {
  if(!routing.trip)return null;
  const {ambulanceToPatient,patientToHospital}=routing.trip.legs;
  return <section className="panel comparison-panel trip-comparison" aria-labelledby="comparison-heading" aria-busy={routing.status==='loading'}>
    <div className="comparison-main"><div className="panel-heading"><span className="section-icon"><Route size={18}/></span><h2 id="comparison-heading">Two-leg route comparison</h2><span className="subtle-tag">Live route options</span></div>
      {routing.status==='loading'&&<p className="routing-message" role="status">Updating both route legs…</p>}{routing.error&&<p className="routing-error" role="alert">{routing.error}</p>}
      <p className="trip-cost-note">Travel time is an estimate. Risk-adjusted cost is a separate route-comparison score.</p>
      <TripLeg routing={routing} legId="ambulanceToPatient" label="Ambulance → patient" leg={ambulanceToPatient} travelLabel="Estimated ambulance travel to patient" />
      <TripLeg routing={routing} legId="patientToHospital" label="Patient → hospital" leg={patientToHospital} travelLabel="Estimated patient transport to hospital" />
      <details className="risk-details scoring-details"><summary>Route limits</summary><p>Hazards are assessed separately for each leg. Only routes returned by the routing service are compared; new detours around closures are not generated.</p><p>{routing.data.tripNotice||routing.data.reroutingLimitation}</p></details>
    </div>
  </section>;
}

export function Recommendation({ routing }) {
  if(routing.trip){const legs=[['Ambulance → patient',routing.trip.legs.ambulanceToPatient],['Patient → hospital',routing.trip.legs.patientToHospital]];return <section className="panel recommendation-panel trip-recommendations" aria-label="Route recommendations"><div className="panel-heading"><span className="recommendation-label">ROUTE RECOMMENDATIONS</span></div><div className="trip-recommendation-grid">{legs.map(([label,leg])=>{const route=leg.routes.find((candidate)=>candidate.id===leg.recommendedRouteId);return <div key={label} className={!route?'critical':''}><span>{label}</span><strong>{route?.name||'Dispatcher review required'}</strong>{route?<p>Estimated travel {route.durationMinutes.toFixed(1)} min · risk-adjusted cost {route.finalCost.toFixed(2)} equiv. min · risk {route.riskScore}/100</p>:<p className="no-route-warning">{leg.recommendationExplanation}</p>}</div>;})}</div><p className="recommendation-caveat">Each leg has its own recommendation.</p></section>;}
  const route = routing.routes.find((candidate) => candidate.id === routing.data?.recommendedRouteId);
  return <section className={`panel recommendation-panel ${routing.data && !route ? 'critical' : ''} ${routing.stale ? 'stale' : ''}`} aria-label="Route recommendation">
    <div className="recommendation-heading"><div><span className="recommendation-label">{routing.stale ? 'LAST ROUTE RESULTS' : 'RECOMMENDED ROUTE'}</span><h2>{route ? route.name : routing.data ? 'Dispatcher review required' : routing.status === 'loading' ? 'Assessing routes…' : 'No route selected'}</h2></div>
      {route && <div className="recommendation-metrics"><span>Estimated travel to patient<strong>{route.durationMinutes.toFixed(1)} <small>min</small></strong></span><span>Risk-adjusted cost<strong>{route.finalCost.toFixed(2)} <small>equiv. min</small></strong></span></div>}
    </div>
    {route ? <><p className="recommendation-reason">Lowest risk-adjusted cost among eligible routes. Reported risk: <strong>{route.riskScore}/100</strong>.</p><details className="recommendation-explanation"><summary>Why this route?</summary><p>{routing.data.recommendationExplanation}</p></details></> : routing.data ? <p className="no-route-warning" role="alert">{routing.data.recommendationExplanation}</p> : <p>Enter all three locations to compare routes.</p>}
    <p className="recommendation-caveat">Risk scores reflect reported hazards only and do not guarantee safe passage.</p>
  </section>;
}

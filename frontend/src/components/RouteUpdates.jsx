import { useState } from 'react';

export function RouteUpdates({routing}) {
  const [dismissed,setDismissed]=useState(null);
  const notifications=routing.data?.notifications||[];
  const latest=notifications.at(-1);
  return <>
    {routing.error&&routing.data&&<p className="routing-error" role="alert">{routing.error} Showing the last route results until connection recovers.</p>}
    {latest&&latest.id!==dismissed&&<section className={`route-update ${latest.newRouteId?'':'no-alternative'}`} role={latest.newRouteId?'status':'alert'} aria-label="Route recommendation updated">
      <div className="route-update-heading"><strong>{latest.newRouteId?'Route Updated':'Dispatcher Review Required'}</strong><button className="text-button" aria-label="Dismiss route update" onClick={()=>setDismissed(latest.id)}>Dismiss</button></div>
      <p>{latest.legLabel&&<strong>{latest.legLabel}: </strong>}{latest.message}</p>
      <div className="update-metrics"><span>Estimated travel time<strong>{latest.previousTravelMinutes===null?'Unavailable':`${latest.previousTravelMinutes.toFixed(2)} min`} → {latest.newTravelMinutes===null?'Unavailable':`${latest.newTravelMinutes.toFixed(2)} min`}</strong></span><span>Risk-adjusted route cost<strong>{latest.previousCostMinutes===null?'Unavailable':`${latest.previousCostMinutes.toFixed(2)} min`} → {latest.newCostMinutes===null?'Unavailable':`${latest.newCostMinutes.toFixed(2)} min`}</strong></span></div>
      <details className="update-footnote"><summary>About this change</summary><p>Travel time is tied to the selected route. Risk penalties are added separately to compare routes. {latest.limitation}</p></details>
    </section>}
    {notifications.length>0&&<details className="route-update-history"><summary>Recommendation changes ({notifications.length})</summary>{[...notifications].reverse().map((event)=><p key={event.id}><time>{new Date(event.occurredAt).toLocaleString()}</time> · {event.message}</p>)}</details>}
  </>;
}

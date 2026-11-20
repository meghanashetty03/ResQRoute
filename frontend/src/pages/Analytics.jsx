import { useEffect, useState } from 'react';
import { routingRequest } from '../services/api.js';

export function Analytics({routing,hazards}) {
  const [mode,setMode]=useState('all');
  const [refresh,setRefresh]=useState(0);
  const [state,setState]=useState({status:'loading',data:null,error:null});
  const selectedId=mode==='all'||mode===routing.mode?routing.data?.calculationId:null;
  useEffect(()=>{
    let stopped=false,inFlight=false,controller;
    async function load(){
      if(inFlight)return;inFlight=true;controller=new AbortController();
      setState((previous)=>({...previous,status:previous.data?.mode===mode?'success':'loading',error:null}));
      try {
        const query=new URLSearchParams({mode});if(selectedId)query.set('calculationId',selectedId);
        const data=await routingRequest(`/analytics?${query}`,{signal:controller.signal});
        if(!stopped)setState({status:'success',data,error:null});
      }catch(error){if(!stopped&&!controller.signal.aborted)setState((previous)=>({...previous,status:'error',error:error.message}));}
      finally{inFlight=false;}
    }
    load();const timer=setInterval(load,5000);
    return()=>{stopped=true;controller?.abort();clearInterval(timer);};
  },[mode,selectedId,routing.data?.evaluationVersion,hazards.revision,refresh]);
  const data=state.data?.mode===mode?state.data:null;
  const current=data?.currentCalculation;
  return <div className="analytics-workspace">
    <div className="module-actions"><div><p>Route assessments and recommendation changes. Demo results are simulated.</p>{data&&<p>Updated {new Date(data.asOf).toLocaleString()}{state.error?' · showing last results':''}</p>}</div><label className="analytics-filter">Records<select aria-label="Analytics scope" value={mode} onChange={(event)=>setMode(event.target.value)}><option value="all">All scopes</option><option value="demo">Demo only</option><option value="live">Live routing only</option></select></label><button className="secondary-button" onClick={()=>setRefresh((value)=>value+1)}>Refresh analytics</button></div>
    {state.status==='loading'&&<p className="routing-message" role="status">Loading route analytics…</p>}
    {state.error&&<p className="routing-error" role="alert">Analytics could not refresh: {state.error}</p>}
    {data&&<>
      <div className="analytics-metrics">{[
        ['Routes evaluated',data.summary.totalRoutesEvaluated,'Across route assessments'],
        ['Active hazards',data.summary.activeHazards,'Current reports'],
        ['Recommendation changes',data.summary.reroutingEvents,'Including loss and recovery of eligibility'],
        ['Route assessments',data.summary.recordedEvaluations,'Recorded in this scope'],
      ].map(([label,value,detail])=><article className="panel analytics-metric" key={label}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>)}</div>
      {data.summary.historyStartedAt&&<p className="analytics-history-note">Recorded history since {new Date(data.summary.historyStartedAt).toLocaleString()}.</p>}
      <section className="panel analytics-panel"><div className="panel-heading"><h2>Risk and estimated travel time comparison</h2><span className="subtle-tag">{current?.mode==='demo'?'DEMO SNAPSHOT':current?'LIVE ROUTING ESTIMATES':'No calculation'}</span></div>
        {current?<><p className="routing-message">{data.currentSource} · evaluated {new Date(current.evaluatedAt).toLocaleString()}. Travel time and risk-adjusted cost are separate measures.</p><div className="table-scroll"><table className="analytics-table"><thead><tr><th>Route</th><th>Distance</th><th>Estimated travel to patient</th><th>Reported risk</th><th>Adjusted cost</th><th>Eligibility</th></tr></thead><tbody>{current.routes.map((route)=><tr key={route.id}><td><strong>{route.name}</strong>{route.isRecommended&&<small className="recommended-badge">Recommended</small>}</td><td>{route.distanceKm.toFixed(2)} km</td><td>{route.durationMinutes.toFixed(1)} min</td><td><strong>{route.riskScore}/100</strong><div className="risk-bar"><span style={{width:`${route.riskScore}%`}} /></div></td><td>{route.finalCost.toFixed(2)} min</td><td>{route.eligibilityStatus}</td></tr>)}</tbody></table></div><p className="routing-message">Stored snapshot. Open the dashboard for current route status.</p></>:<p className="routing-message">No route calculation in this scope. <a className="text-button" href="#dashboard">Plan a trip or open the demo</a>.</p>}
      </section>
      <section className="panel analytics-panel"><div className="panel-heading"><h2>Recent recorded route decisions</h2><span className="subtle-tag">Latest 20 scoring runs</span></div>
        {data.recentDecisions.length?<div className="table-scroll"><table className="analytics-table"><thead><tr><th>Evaluated</th><th>Scope</th><th>Trigger</th><th>Previous recommendation</th><th>Calculated recommendation</th><th>Result</th></tr></thead><tbody>{data.recentDecisions.map((run)=><tr key={run.id}><td>{new Date(run.evaluated_at).toLocaleString()}</td><td>{run.scenario_mode==='demo'?'DEMO':'LIVE'}{run.scenario_id&&<small>Rerouting demo</small>}</td><td>{run.trigger_action.replaceAll('_',' ')}</td><td>{run.previous_route_id?run.routes.find((route)=>route.id===run.previous_route_id)?.name||run.previous_route_id:run.is_reroute?'No eligible route':'Initial / unchanged'}</td><td>{run.recommended_route_id?run.routes.find((route)=>route.id===run.recommended_route_id)?.name||run.recommended_route_id:'None · dispatcher review'}</td><td>{run.is_reroute?'Recommendation changed':'Evaluated'}</td></tr>)}</tbody></table></div>:<p className="routing-message">No route decisions recorded in this scope. Plan a trip or open the demo scenario.</p>}
      </section>
    </>}
  </div>;
}

// Real localhost integration. Only the dedicated reproducible demo is reset.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5000/api';
async function request(path,method='GET',body){
  const response=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(18000)});
  const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
}
const reports=()=>request('/hazards');
const ordinary=(data)=>data.hazards.filter((h)=>h.scenario_id!=='stage5-rerouting').sort((a,b)=>a.id.localeCompare(b.id));
const before=ordinary(await reports());
function initial(data){assert.equal(data.recommendedRouteId,'demo-b');assert.deepEqual(data.routes.map((r)=>r.riskScore),[67.5,15,12]);assert.ok(data.routes.every((r)=>r.isEligible));}
let live='NOT RUN';
try{
  const health=await request('/health');assert.equal(health.database.status,'connected');
  const data=await request('/routes/demo/reset','POST');initial(data);
  const state=()=>request(`/routes/${data.calculationId}/state`);
  await request(`/hazards/${data.demoBlockageId}`,'PATCH',{verification_status:'Verified'});
  const closed=await state();assert.equal(closed.recommendedRouteId,'demo-c');assert.equal(closed.routes.find((r)=>r.id==='demo-b').isEligible,false);
  assert.match(closed.notifications.at(-1).message,/verified complete road closure/);
  const audit=await request(`/analytics?mode=demo&calculationId=${data.calculationId}`);
  assert.equal(audit.currentCalculation.recommendedRouteId,'demo-c');assert.ok(audit.recentDecisions.some((r)=>r.calculation_id===data.calculationId&&r.is_reroute));
  await request(`/hazards/${data.demoBlockageId}`,'PATCH',{is_active:false});assert.equal((await state()).recommendedRouteId,'demo-b');
  for(let i=0;i<3;i++){
    initial(await request('/routes/demo/reset','POST'));
    const seed=(await reports()).hazards.filter((h)=>h.scenario_id==='stage5-rerouting');assert.equal(seed.length,3);
    assert.equal(seed.find((h)=>h.incident_id==='stage5-flood-a').verification_status,'Verified');
    assert.equal(seed.find((h)=>h.incident_id==='stage5-blockage-b').verification_status,'Reported');
    assert.equal(seed.find((h)=>h.incident_id==='stage5-damage-c').verification_status,'Reported');
  }
  const clear=await request('/routes/rerouting-demo/hazards','DELETE');assert.equal(clear.deletedCount,3);assert.deepEqual(ordinary(await reports()),before);
  const response=await fetch(base+'/routes/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'live',start:{lat:12.8709,lng:74.8429},destination:{lat:12.8621,lng:74.8685}}),signal:AbortSignal.timeout(18000)});
  const routed=await response.json();
  if(response.ok){assert.equal(routed.mode,'live');assert.ok(routed.routes.length>0);assert.ok(routed.routes.every((r)=>r.geometry.coordinates.length>1&&r.distanceKm>0&&r.durationMinutes>0));live=`PASS (${routed.routes.length} genuine candidates)`;}
  else{assert.ok([422,502,503,504].includes(response.status),JSON.stringify(routed));assert.ok(routed.error);live=`UNAVAILABLE: HTTP ${response.status} ${routed.error}`;}
  console.log(JSON.stringify({health:'PASS',automaticClosure:'PASS',recovery:'PASS',repeatedReset:'PASS',exactSeedHazards:'PASS',realAnalytics:'PASS',explicitClear:'PASS',ordinaryReportsPreserved:'PASS',liveRouting:live}));
}finally{initial(await request('/routes/demo/reset','POST'));assert.deepEqual(ordinary(await reports()),before);}

// Local integration probe. Resets only the dedicated rerouting demo's reports.
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5000/api';
async function request(path,method='GET',body) {
  const response=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;
}
const before=await request('/hazards');
const outside=before.hazards.filter((report)=>report.scenario_id!=='stage5-rerouting').map((report)=>report.id).sort();
const initial=await request('/routes/rerouting-demo/reset','POST');
const statePath=`/routes/${initial.calculationId}/state`;
const extras=[];
try {
  assert.equal(initial.recommendedRouteId,'demo-b');
  await request(`/hazards/${initial.demoBlockageId}`,'PATCH',{verification_status:'Verified'});
  const closed=await request(statePath);
  assert.equal(closed.recommendedRouteId,'demo-c');
  assert.equal(closed.routes.find((route)=>route.id==='demo-b').isEligible,false);
  assert.equal(closed.notifications.at(-1).trigger.action,'verified');
  for(let i=0;i<3;i++){assert.deepEqual(closed.routes[i].geometry,initial.routes[i].geometry);assert.equal(closed.routes[i].durationMinutes,initial.routes[i].durationMinutes);}
  await request(`/hazards/${initial.demoBlockageId}`,'PATCH',{is_active:false});
  assert.equal((await request(statePath)).recommendedRouteId,'demo-b');
  const {segments}=await request('/hazards');
  function input(id,extra={}){const segment=segments.find((item)=>item.id===id);const [longitude,latitude]=segment.geometry.coordinates[0];return {type:'road_blockage',severity:'Low',latitude,longitude,description:'Disposable Stage 5 integration probe',scenario_mode:'demo',scenario_id:'stage5-rerouting',affected_segment_id:id,segment_confirmed:true,...extra};}
  const {hazard:shared}=await request('/hazards','POST',input('demo-shared-start',{is_complete_closure:true}));extras.push(shared.id);
  await request(`/hazards/${shared.id}`,'PATCH',{verification_status:'Verified'});
  const blocked=await request(statePath);assert.equal(blocked.recommendedRouteId,null);assert.ok(blocked.routes.every((route)=>!route.isEligible));assert.match(blocked.notifications.at(-1).message,/Dispatcher review required/);
  await request(`/hazards/${shared.id}`,'DELETE');extras.splice(extras.indexOf(shared.id),1);
  assert.equal((await request(statePath)).recommendedRouteId,'demo-b');
  const {hazard:expiring}=await request('/hazards','POST',input('demo-b-road',{type:'flooding',severity:'High',expires_at:new Date(Date.now()+3500).toISOString()}));extras.push(expiring.id);
  assert.equal((await request(statePath)).recommendedRouteId,'demo-c');
  let expired;
  const deadline=Date.now()+8000;
  do{await new Promise((resolve)=>setTimeout(resolve,250));expired=await request(statePath);}while(expired.recommendedRouteId!=='demo-b'&&Date.now()<deadline);
  assert.equal(expired.recommendedRouteId,'demo-b');assert.equal(expired.notifications.at(-1).trigger.action,'expired');
  const after=await request('/hazards');assert.deepEqual(after.hazards.filter((report)=>report.scenario_id!=='stage5-rerouting').map((report)=>report.id).sort(),outside);
  console.log(JSON.stringify({demo:'PASS',automaticVerification:'PASS',recovery:'PASS',allBlocked:'PASS',realTimeExpiration:'PASS',notifications:'PASS',unchangedCandidateGeometryAndETA:'PASS',ordinaryReportsPreserved:'PASS'}));
} finally {
  for(const id of extras)await request(`/hazards/${id}`,'DELETE');
  await request('/routes/rerouting-demo/reset','POST');
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../database/index.js';
import { createApp } from '../app.js';
import { demoSegments } from '../data/segments.js';
import { getDemoScenario } from '../services/routingService.js';

async function fixture(t,options={}) {
  const database=openDatabase(':memory:');
  const server=createApp(database,{...options,fetchImpl:async()=>{throw new Error('Automatic rerouting must not contact a provider');},logger:{error(){}}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{await new Promise((resolve)=>server.close(resolve));database.close();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function request(path,method='GET',body){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data;}
  const scenario=getDemoScenario();
  return {database,request,calculate:()=>request('/routes/calculate','POST',{mode:'demo',start:scenario.start,destination:scenario.destination})};
}
function hazardOn(edge,overrides={}) {
  const segment=demoSegments.find((item)=>item.id===edge);
  const [longitude,latitude]=segment.geometry.coordinates[0];
  return {type:'road_damage',longitude,latitude,severity:'Medium',description:'Disposable automated rerouting report',scenario_mode:'demo',affected_segment_id:segment.id,...overrides};
}
const statePath=(evaluation)=>`/routes/${evaluation.calculationId}/state`;

test('hazard creation automatically evaluates active candidates before the next client read',async(t)=>{
  const {request,calculate,database}=await fixture(t);
  const initial=await calculate();
  const {hazard}=await request('/hazards','POST',hazardOn('demo-a-road'));
  // Inspect persisted runtime before any state GET or manual recalculate request.
  const stored=JSON.parse(database.prepare('SELECT evaluation_json FROM route_runtime WHERE calculation_id=?').get(initial.calculationId).evaluation_json);
  assert.equal(stored.routes[0].riskScore,12);
  assert.equal(stored.recommendedRouteId,'demo-b');
  const updated=await request(statePath(initial));
  assert.ok(updated.evaluationVersion>initial.evaluationVersion);
  assert.equal(updated.notifications.length,1);
  assert.equal(updated.notifications[0].trigger.action,'created');
  assert.equal(updated.notifications[0].trigger.hazardId,hazard.id);
  assert.equal(updated.routes[1].riskScore,0);
});

test('verification excludes a complete closure, changes recommendation and emits accurate travel/cost notification',async(t)=>{
  const {request}=await fixture(t);
  const initial=await request('/routes/rerouting-demo/reset','POST');
  assert.equal(initial.recommendedRouteId,'demo-b');
  const before=initial.routes.find((route)=>route.id==='demo-b');
  assert.equal(before.isEligible,true);
  await request(`/hazards/${initial.demoBlockageId}`,'PATCH',{verification_status:'Verified'});
  const updated=await request(statePath(initial));
  assert.equal(updated.routes.find((route)=>route.id==='demo-b').isEligible,false);
  assert.equal(updated.recommendedRouteId,'demo-c');
  const after=updated.routes.find((route)=>route.id==='demo-c');
  const event=updated.notifications.at(-1);
  assert.equal(event.previousRouteId,'demo-b');assert.equal(event.newRouteId,'demo-c');
  assert.equal(event.trigger.action,'verified');assert.match(event.reason,/verified complete road closure/);
  assert.ok(event.message.includes(initial.demoBlockageId));
  assert.equal(event.previousTravelMinutes,before.durationMinutes);assert.equal(event.newTravelMinutes,after.durationMinutes);
  assert.equal(event.previousCostMinutes,before.finalCost);assert.equal(event.newCostMinutes,after.finalCost);
  assert.equal(event.travelEstimateChangeMinutes,Number((after.durationMinutes-before.durationMinutes).toFixed(4)));
  assert.equal(event.riskAdjustedCostChangeMinutes,Number((after.finalCost-before.finalCost).toFixed(4)));
  assert.equal(event.providerEstimatesChanged,false);
  for(let i=0;i<3;i++){assert.deepEqual(updated.routes[i].geometry,initial.routes[i].geometry);assert.equal(updated.routes[i].durationMinutes,initial.routes[i].durationMinutes);}
  const again=await request(statePath(initial));
  assert.deepEqual(again.notifications,updated.notifications); // No duplicate notification on polling.
});

test('editing, rejection, activation/deactivation and deletion automatically refresh scores and restore eligibility',async(t)=>{
  const {request,calculate}=await fixture(t);
  const initial=await calculate();
  const {hazard}=await request('/hazards','POST',hazardOn('demo-a-road',{is_complete_closure:true,segment_confirmed:true}));
  await request(`/hazards/${hazard.id}`,'PATCH',{verification_status:'Verified'});
  assert.equal((await request(statePath(initial))).routes[0].isEligible,false);
  await request(`/hazards/${hazard.id}`,'PATCH',{verification_status:'Rejected'});
  let state=await request(statePath(initial));assert.equal(state.routes[0].isEligible,true);assert.equal(state.routes[0].riskScore,0);
  await request(`/hazards/${hazard.id}`,'PATCH',{verification_status:'Verified',severity:'High',is_complete_closure:false});
  state=await request(statePath(initial));assert.equal(state.routes[0].riskScore,30);assert.equal(state.routes[0].isEligible,true);
  await request(`/hazards/${hazard.id}`,'PATCH',{is_active:false});
  state=await request(statePath(initial));assert.equal(state.routes[0].riskScore,0);
  await request(`/hazards/${hazard.id}`,'PATCH',{is_active:true,is_complete_closure:true});
  assert.equal((await request(statePath(initial))).routes[0].isEligible,false);
  await request(`/hazards/${hazard.id}`,'DELETE');
  state=await request(statePath(initial));assert.equal(state.routes[0].isEligible,true);assert.equal(state.recommendedRouteId,'demo-a');assert.equal(state.notifications.at(-1).trigger.action,'deleted');
});

test('no eligible route remaining produces a real warning and no invented alternative',async(t)=>{
  const {request,calculate}=await fixture(t);const initial=await calculate();
  const {hazard}=await request('/hazards','POST',hazardOn('demo-shared-start',{is_complete_closure:true,segment_confirmed:true,type:'road_blockage'}));
  await request(`/hazards/${hazard.id}`,'PATCH',{verification_status:'Verified'});
  const state=await request(statePath(initial));
  assert.equal(state.recommendedRouteId,null);assert.equal(state.routes.length,3);assert.ok(state.routes.every((route)=>!route.isEligible));
  const event=state.notifications.at(-1);assert.equal(event.newRouteId,null);assert.equal(event.newTravelMinutes,null);assert.match(event.message,/Dispatcher review required/);
});

test('backend expiration worker reevaluates without a client read or hazard revision change',async(t)=>{
  let now=Date.now();const {request,calculate,database}=await fixture(t,{clock:()=>now});const initial=await calculate();
  await request('/hazards','POST',hazardOn('demo-a-road',{expires_at:new Date(now+60000).toISOString()}));
  const affected=await request(statePath(initial));assert.equal(affected.recommendedRouteId,'demo-b');
  now+=59999;
  // The active lease still holds, while the report's expiration has passed.
  database.prepare('UPDATE route_runtime SET active_until=? WHERE calculation_id=?').run(now+60000,initial.calculationId);
  now+=2;
  await new Promise((resolve)=>setTimeout(resolve,1200));
  const runtime=database.prepare('SELECT evaluation_json FROM route_runtime WHERE calculation_id=?').get(initial.calculationId);
  assert.equal(JSON.parse(runtime.evaluation_json).recommendedRouteId,'demo-a');
  const expired=await request(statePath(initial));assert.equal(expired.routes[0].riskScore,0);assert.equal(expired.recommendedRouteId,'demo-a');
  assert.equal(expired.hazardRevision,affected.hazardRevision);assert.equal(expired.notifications.at(-1).trigger.action,'expired');
});

test('unrelated changes do not produce false recommendation alerts; reset is deterministic and preserves ordinary hazards',async(t)=>{
  const {request,calculate}=await fixture(t);const ordinary=await request('/hazards','POST',hazardOn('demo-c-road'));
  const initial=await calculate();
  await request('/hazards','POST',{type:'flooding',longitude:75,latitude:14,severity:'High',description:'Far away',scenario_mode:'demo'});
  assert.equal((await request(statePath(initial))).notifications.length,0);
  const first=await request('/routes/rerouting-demo/reset','POST');
  await request(`/hazards/${first.demoBlockageId}`,'PATCH',{verification_status:'Verified'});
  assert.equal((await request(statePath(first))).recommendedRouteId,'demo-c');
  const reset=await request('/routes/rerouting-demo/reset','POST');
  assert.equal(reset.recommendedRouteId,'demo-b');assert.equal(reset.notifications.length,0);
  const comparable=(routes)=>routes.map(({matchedHazards,...route})=>({...route,matchedHazards:matchedHazards.map(({id,reportIds,...hazard})=>hazard)}));
  assert.deepEqual(comparable(reset.routes),comparable(first.routes)); // New report IDs/timestamps are intentionally generated on reset.
  const {hazards}=await request('/hazards');assert.ok(hazards.some((hazard)=>hazard.id===ordinary.hazard.id));
  assert.equal(hazards.filter((hazard)=>hazard.scenario_id==='stage5-rerouting').length,3);
  const existingViewer=await request(statePath(first));
  assert.equal(existingViewer.demoBlockageId,reset.demoBlockageId);
  assert.equal(existingViewer.recommendedRouteId,'demo-b');
});

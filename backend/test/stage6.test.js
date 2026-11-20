import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { openDatabase } from '../database/index.js';
import { createApp } from '../app.js';
import { createHazard } from '../services/hazardService.js';
import { readSession,writeSession } from '../../frontend/src/services/session.js';

async function listen(database,options={}) {
  const app=createApp(database,{logger:{error(){}},...options});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  async function request(endpoint,method='GET',body) {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api${endpoint}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }
  return {request,close:()=>new Promise((resolve)=>server.close(resolve))};
}
async function fixture(t,options={}){const database=openDatabase(':memory:');const api=await listen(database,options);t.after(async()=>{await api.close();if(database.isOpen)database.close();});return {...api,database};}
const metrics=(data)=>data.routes.map(({id,riskScore,finalCost,durationMinutes,isEligible,isRecommended})=>({id,riskScore,finalCost,durationMinutes,isEligible,isRecommended}));

test('complete B → C → B workflow and repeated primary resets restore exact hazards and scoring',async(t)=>{
  const {request,database}=await fixture(t);
  const ordinary=createHazard(database,{type:'road_damage',latitude:12.87,longitude:74.85,severity:'Low',description:'Preserve this ordinary report'});
  const initial=(await request('/routes/demo/reset','POST')).data;
  assert.equal(initial.recommendedRouteId,'demo-b');assert.deepEqual(initial.routes.map((route)=>route.riskScore),[67.5,15,12]);
  const state=`/routes/${initial.calculationId}/state`;
  await request(`/hazards/${initial.demoBlockageId}`,'PATCH',{verification_status:'Verified'});
  const blocked=(await request(state)).data;
  assert.equal(blocked.routes[1].isEligible,false);assert.equal(blocked.recommendedRouteId,'demo-c');
  await request(`/hazards/${initial.demoBlockageId}`,'PATCH',{is_active:false});
  const recovered=(await request(state)).data;
  assert.equal(recovered.routes[1].isEligible,true);assert.equal(recovered.recommendedRouteId,'demo-b');
  for(let index=0;index<3;index++) {
    const reset=(await request('/routes/demo/reset','POST')).data;
    assert.deepEqual(metrics(reset),metrics(initial));
    const {hazards}=(await request('/hazards')).data;
    const seeds=hazards.filter((report)=>report.scenario_id==='stage5-rerouting');
    assert.equal(seeds.length,3);assert.ok(seeds.every((report)=>report.is_active));
    assert.equal(seeds.find((report)=>report.type==='flooding').verification_status,'Verified');
    assert.equal(seeds.find((report)=>report.type==='road_blockage').verification_status,'Reported');
    assert.equal(seeds.find((report)=>report.type==='road_damage').verification_status,'Reported');
    assert.ok(hazards.some((report)=>report.id===ordinary.id));
  }
});

test('explicit clear removes only dedicated demo hazards; reset restores reports without clearing history',async(t)=>{
  const {request,database}=await fixture(t);
  const ordinary=createHazard(database,{type:'traffic',latitude:12.87,longitude:74.85,severity:'Low',description:'Ordinary report survives clear'});
  const initial=(await request('/routes/demo/reset','POST')).data;
  const cleared=await request('/routes/rerouting-demo/hazards','DELETE');assert.equal(cleared.status,200);assert.equal(cleared.data.deletedCount,3);
  const state=(await request(`/routes/${initial.calculationId}/state`)).data;
  assert.equal(state.recommendedRouteId,'demo-a');assert.ok(state.routes.every((route)=>route.riskScore===0));
  assert.ok((await request('/hazards')).data.hazards.some((report)=>report.id===ordinary.id));
  const before=(await request('/analytics')).data.summary.recordedEvaluations;
  const reset=(await request('/routes/demo/reset','POST')).data;assert.equal(reset.recommendedRouteId,'demo-b');
  assert.ok((await request('/analytics')).data.summary.recordedEvaluations>before);
});

test('analytics use real evaluation records, distinguish modes and do not count unchanged polling as scoring',async(t)=>{
  const {request}=await fixture(t);
  const empty=(await request('/analytics')).data;assert.equal(empty.summary.recordedEvaluations,0);assert.equal(empty.currentCalculation,null);
  const initial=(await request('/routes/demo/reset','POST')).data;
  const first=(await request(`/analytics?mode=demo&calculationId=${initial.calculationId}`)).data;
  assert.equal(first.summary.recordedEvaluations,1);assert.equal(first.summary.totalRoutesEvaluated,3);assert.equal(first.summary.activeHazards,3);assert.equal(first.summary.reroutingEvents,0);
  assert.deepEqual(first.currentCalculation.routes,initial.routes);
  await request(`/routes/${initial.calculationId}/state`);
  assert.equal((await request('/analytics')).data.summary.recordedEvaluations,1);
  await request(`/hazards/${initial.demoBlockageId}`,'PATCH',{verification_status:'Verified'});
  const changed=(await request('/analytics')).data;
  assert.equal(changed.summary.recordedEvaluations,2);assert.equal(changed.summary.totalRoutesEvaluated,6);assert.equal(changed.summary.reroutingEvents,1);
  assert.equal(changed.recentDecisions[0].trigger_action,'verified');assert.equal(changed.recentDecisions[0].recommended_route_id,'demo-c');
  assert.equal((await request('/analytics?mode=live')).data.summary.recordedEvaluations,0);
  assert.equal((await request('/analytics?mode=invalid')).status,400);
  assert.equal((await request('/analytics?calculationId=missing')).status,404);
});

test('saved backend calculation, hazard changes and analytics survive a real HTTP server/database restart',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'resqroute-stage6-'));
  assert.equal(path.dirname(directory),path.resolve(tmpdir()));
  const filename=path.join(directory,'restart.sqlite');
  let database,api;
  try {
    database=openDatabase(filename);api=await listen(database);
    const initial=(await api.request('/routes/demo/reset','POST')).data;
    await api.request(`/hazards/${initial.demoBlockageId}`,'PATCH',{verification_status:'Verified'});
    const before=(await api.request('/analytics')).data;
    await api.close();api=null;database.close();database=null;
    database=openDatabase(filename);api=await listen(database);
    const restored=(await api.request(`/routes/${initial.calculationId}/state`)).data;
    assert.equal(restored.recommendedRouteId,'demo-c');assert.equal(restored.calculationId,initial.calculationId);
    assert.equal((await api.request(`/hazards/${initial.demoBlockageId}`)).data.hazard.verification_status,'Verified');
    assert.equal((await api.request('/analytics')).data.summary.recordedEvaluations,before.summary.recordedEvaluations);
  }finally{if(api)await api.close();if(database?.isOpen)database.close();rmSync(directory,{recursive:true,force:true});}
});

test('database failures return errors rather than fabricated hazard saves or analytics',async(t)=>{
  const {request,database}=await fixture(t);database.close();
  assert.equal((await request('/analytics')).status,500);
  assert.equal((await request('/hazards','POST',{type:'traffic',latitude:12,longitude:74,severity:'Low',description:'Must not save'})).status,500);
  assert.equal((await request('/health')).status,503);
});

test('session persistence stores identifiers/drafts but never risk scores; corrupted or unavailable storage is safe',()=>{
  let text=null;const storage={getItem(){return text;},setItem(_key,value){text=value;}};
  const calculationId='11111111-1111-4111-8111-111111111111';
  const hospitalCalculationId='22222222-2222-4222-8222-222222222222';
  const draft={type:'Road accident',start_lat:'12.87',start_lng:'74.85',pickup_lat:'12.86',pickup_lng:'74.86',hospital_id:'HOSP-11111111-1111-4111-8111-111111111111'};
  const tripCalculationIds=[calculationId,hospitalCalculationId];
  writeSession({draft,mode:'live',calculationId:null,tripCalculationIds,riskScore:99},storage);
  assert.equal(JSON.parse(text).riskScore,undefined);assert.equal(readSession(storage).calculationId,null);assert.equal(readSession(storage).draft.start_lat,'12.87');
  assert.deepEqual(readSession(storage).tripCalculationIds,tripCalculationIds);
  assert.equal(readSession(storage).draft.hospital_id,draft.hospital_id);
  text='{bad json';assert.equal(readSession(storage).calculationId,null);
  text=JSON.stringify({version:1,draft:{start_lat:123},mode:'cloud',calculationId:'invalid'});assert.equal(readSession(storage).mode,'live');assert.equal(readSession(storage).draft.start_lat,'');assert.equal(readSession(storage).calculationId,null);
  const blocked={getItem(){throw new Error('Storage blocked');},setItem(){throw new Error('Storage blocked');}};
  assert.equal(readSession(blocked).calculationId,null);assert.doesNotThrow(()=>writeSession({draft,mode:'live',calculationId},blocked));
});

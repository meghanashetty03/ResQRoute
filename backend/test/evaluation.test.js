import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { openDatabase } from '../database/index.js';
import { createApp } from '../app.js';
import { getDemoScenario } from '../services/routingService.js';
import { demoSegments } from '../data/segments.js';

test('end-to-end stored hazards affect manual recalculation, rejection, closure and ranking without changing routes',async(t)=>{
  const database=openDatabase(':memory:');
  let providerCalls=0;
  const server=createApp(database,{fetchImpl:async()=>{providerCalls++;throw new Error('offline');},logger:{error(){}}}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{await new Promise((resolve)=>server.close(resolve));database.close();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function request(path,method='GET',body){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json();}
  const demo=getDemoScenario();
  const original=await request('/routes/calculate','POST',{mode:'demo',start:demo.start,destination:demo.destination});
  assert.equal(original.recommendedRouteId,'demo-a');
  const segment=demoSegments.find((item)=>item.id==='demo-a-road');
  const [longitude,latitude]=segment.geometry.coordinates[0];
  const {hazard}=await request('/hazards','POST',{type:'road_damage',latitude,longitude,severity:'Medium',description:'Synthetic integration report',scenario_mode:'demo',affected_segment_id:segment.id});
  const reported=await request('/routes/recalculate','POST',{calculationId:original.calculationId});
  assert.equal(reported.routes[0].riskScore,12);
  assert.equal(original.routes[0].riskScore,0); // Existing UI snapshot is not silently rewritten.
  await request(`/hazards/${hazard.id}`,'PATCH',{verification_status:'Verified'});
  const verified=await request('/routes/recalculate','POST',{calculationId:original.calculationId});
  assert.equal(verified.routes[0].riskScore,20);
  assert.equal(verified.routes[1].riskScore,0);
  assert.equal(verified.recommendedRouteId,'demo-b');
  await request('/hazards','POST',{type:'flooding',latitude:14,longitude:75,severity:'High',description:'Far away test report',scenario_mode:'demo'});
  const far=await request('/routes/recalculate','POST',{calculationId:original.calculationId});
  assert.deepEqual(far.routes,verified.routes);
  await request(`/hazards/${hazard.id}`,'PATCH',{verification_status:'Rejected'});
  const rejected=await request('/routes/recalculate','POST',{calculationId:original.calculationId});
  assert.equal(rejected.routes[0].riskScore,0);
  await request(`/hazards/${hazard.id}`,'PATCH',{verification_status:'Verified',type:'road_blockage',is_complete_closure:true,segment_confirmed:true});
  const blocked=await request('/routes/recalculate','POST',{calculationId:original.calculationId});
  assert.equal(blocked.routes[0].isEligible,false);
  assert.equal(blocked.recommendedRouteId,'demo-b');
  assert.match(blocked.routes[0].eligibilityStatus,/Verified Road Closure/);
  for(let index=0;index<3;index++){
    assert.deepEqual(blocked.routes[index].geometry,original.routes[index].geometry);
    assert.equal(blocked.routes[index].durationMinutes,original.routes[index].durationMinutes);
  }
  await request(`/hazards/${hazard.id}`,'PATCH',{is_active:false});
  const inactive=await request('/routes/recalculate','POST',{calculationId:original.calculationId});
  assert.equal(inactive.routes[0].riskScore,0);assert.equal(inactive.routes[0].isEligible,true);
  assert.equal(providerCalls,0);
  assert.equal((await fetch(base+'/routes/recalculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({calculationId:'missing'})})).status,404);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { openDatabase } from '../database/index.js';

const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
function provider(){
  const calls=[];
  const fetchImpl=async(url)=>{
    calls.push(url);
    const points=url.pathname.split('/').at(-1).split(';').map((pair)=>pair.split(',').map(Number));
    const [from,to]=points,mid=[(from[0]+to[0])/2,(from[1]+to[1])/2];
    const detour=[mid[0]+0.004,mid[1]+0.003];
    const distance=Math.max(1500,Math.hypot(to[0]-from[0],to[1]-from[1])*100000);
    return response({code:'Ok',routes:[
      {geometry:{type:'LineString',coordinates:[from,mid,to]},distance,duration:Math.max(180,distance/8)},
      {geometry:{type:'LineString',coordinates:[from,detour,to]},distance:distance*1.22,duration:Math.max(240,distance/8*1.6)},
    ]});
  };
  return {fetchImpl,calls};
}
async function fixture(t,{clock=()=>Date.now(),fetchImpl=provider().fetchImpl}={}){
  const database=openDatabase(':memory:');const server=createApp(database,{fetchImpl,clock,logger:{error(){}}}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise((resolve)=>server.close(resolve));database.close();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function request(path,method='GET',body){const result=await fetch(`${base}${path}`,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:result.status,data:await result.json()};}
  async function addHospital(name,latitude,longitude){const result=await request('/hospitals','POST',{name,latitude,longitude,address:`${name} address`,phone:'0824123456',capabilities:['emergency','trauma']});assert.equal(result.status,201);return result.data.hospital;}
  async function trip(hospitalId){const result=await request('/routes/trip/calculate','POST',{mode:'live',start:{lat:12.86,lng:74.83},patient:{lat:12.87,lng:74.85},hospital:{lat:12.88,lng:74.87},hospitalName:'Manual Hospital Entry',hospitalAddress:'Dispatcher-entered destination',...(hospitalId?{hospitalId}:{})});assert.equal(result.status,200,JSON.stringify(result.data));return result.data;}
  return {database,base,request,addHospital,trip};
}
async function pickup(request,id){
  for(const status of ['en_route_to_patient','arrived_at_patient','patient_picked_up']){const result=await request(`/journeys/${id}/status`,'PATCH',{status});assert.equal(result.status,200,JSON.stringify(result.data));}
}

test('trip planning stores a journey, timestamps valid transitions, and rejects skips or repeats',async(t)=>{
  let now=Date.parse('2026-11-20T10:00:00Z');const {database,request,trip}=await fixture(t,{clock:()=>now});const planned=await trip();const id=planned.tripId;
  const initial=await request(`/journeys/${id}`);assert.equal(initial.status,200);assert.equal(initial.data.status,'planned');assert.equal(initial.data.timestamps.planned,'2026-11-20T10:00:00.000Z');
  assert.equal((await request(`/journeys/${id}/status`,'PATCH',{status:'arrived_at_patient'})).status,409);
  for(const [status,timestamp] of [['en_route_to_patient','en_route_to_patient'],['arrived_at_patient','arrived_at_patient'],['patient_picked_up','patient_picked_up']]){
    now+=60_000;const result=await request(`/journeys/${id}/status`,'PATCH',{status});assert.equal(result.status,200);assert.equal(result.data.status,status);assert.equal(result.data.timestamps[timestamp],new Date(now).toISOString());
  }
  assert.equal((await request(`/journeys/${id}/status`,'PATCH',{status:'patient_picked_up'})).status,409);
  const options=await request(`/journeys/${id}/hospital-recommendations`,'POST',{});assert.equal(options.status,200);assert.equal(options.data.recommendations.length,0);
  const manual=await request(`/journeys/${id}/hospital`,'POST',{keepCurrent:true});assert.equal(manual.status,200);assert.equal(manual.data.journey.hospital.name,'Manual Hospital Entry');assert.equal(manual.data.journey.hospital.availability.status,'unknown');assert.ok(manual.data.journey.hospitalConfirmedAt);
  assert.equal((await request(`/journeys/${id}/status`,'PATCH',{status:'en_route_to_hospital'})).status,200);
  const refreshed=await request(`/journeys/${id}`);assert.equal(refreshed.data.ambulanceToPatientCalculationId,planned.legs.ambulanceToPatient.calculationId);assert.equal(refreshed.data.patientToHospitalCalculationId,manual.data.leg.calculationId);assert.notEqual(refreshed.data.patientToHospitalCalculationId,planned.legs.patientToHospital.calculationId);
  const legacy=await trip();database.prepare('DELETE FROM journeys WHERE id=?').run(legacy.tripId);
  const recovered=await request(`/journeys/${legacy.tripId}/recover`,'POST',{calculationIds:[legacy.legs.ambulanceToPatient.calculationId,legacy.legs.patientToHospital.calculationId]});
  assert.equal(recovered.status,201);assert.equal(recovered.data.status,'planned');assert.equal(recovered.data.patient.lat,legacy.patient.lat);
});

test('hospital options use actual route evaluations, acceptance freshness and a visible explainable score',async(t)=>{
  let now=Date.parse('2026-11-20T10:00:00Z');const {request,addHospital,trip}=await fixture(t,{clock:()=>now});const accepting=await addHospital('Central Hospital',12.89,74.88);const unknown=await addHospital('Coastal Hospital',12.89,74.88);const diverting=await addHospital('Diverting Hospital',12.90,74.89);
  for(const [hospital,status] of [[accepting,'accepting'],[diverting,'diverting']]){const update=await request(`/hospitals/${hospital.id}/availability`,'POST',{status,updatedBy:'Staff member',updaterRole:'hospital_staff'});assert.equal(update.status,201);}
  const planned=await trip();await pickup(request,planned.tripId);
  const tooEarly=await request(`/journeys/${planned.tripId}/status`,'PATCH',{status:'en_route_to_hospital'});assert.equal(tooEarly.status,409);
  const generated=await request(`/journeys/${planned.tripId}/hospital-recommendations`,'POST',{});assert.equal(generated.status,200);
  const rows=generated.data.recommendations;assert.equal(rows.length,3);
  const first=rows.find((item)=>item.hospital.id===accepting.id),second=rows.find((item)=>item.hospital.id===unknown.id),third=rows.find((item)=>item.hospital.id===diverting.id);
  assert.ok(first.calculationId);assert.equal(first.hospital.availability.status,'accepting');assert.ok(first.routes.length>0);assert.equal(first.recommendable,true);
  assert.equal(second.hospital.availability.status,'unknown');assert.equal(second.hospital.availability.sourceLabel,'No status reported');assert.equal(second.hospital.availability.lastUpdatedAt,null);
  assert.match(second.explanation,/unknown or stale/);assert.match(second.explanation,/patient-specific treatment needs are not recorded/);
  assert.equal(third.recommendable,false);assert.equal(third.rank,null);assert.match(third.explanation,/diverting ambulances/);
  assert.equal(first.rank,1);assert.ok(Number.isFinite(first.score));assert.ok(first.score>=0&&first.score<=100);
  now+=31*60_000;const stale=await request(`/journeys/${planned.tripId}`);const staleAccepting=stale.data.recommendations.find((item)=>item.hospital.id===accepting.id);assert.equal(staleAccepting.hospital.availability.status,'unknown');assert.equal(staleAccepting.hospital.availability.stale,true);
});

test('hospital selection is manual, recalculates only the hospital leg, and a verified closure affects that leg',async(t)=>{
  const {base,request,addHospital,trip}=await fixture(t);const destination=await addHospital('Pickup Destination',12.895,74.89);const planned=await trip();await pickup(request,planned.tripId);
  await request(`/journeys/${planned.tripId}/hospital-recommendations`,'POST',{});
  const firstCalculationId=planned.legs.ambulanceToPatient.calculationId;
  const selected=await request(`/journeys/${planned.tripId}/hospital`,'POST',{hospitalId:destination.id});
  assert.equal(selected.status,200,JSON.stringify(selected.data));assert.equal(selected.data.journey.hospitalId,destination.id);
  assert.notEqual(selected.data.leg.calculationId,planned.legs.patientToHospital.calculationId);
  assert.equal(selected.data.leg.start.lat,planned.patient.lat);assert.equal(selected.data.leg.destination.lat,destination.latitude);
  const invalidHospital=await request(`/journeys/${planned.tripId}/hospital`,'POST',{hospitalId:'missing'});assert.equal(invalidHospital.status,404);
  const startTransport=await request(`/journeys/${planned.tripId}/status`,'PATCH',{status:'en_route_to_hospital'});assert.equal(startTransport.status,200);

  const candidates=selected.data.leg.routes;const coordinates=candidates[0].geometry.coordinates;const segmentList=await request('/hazards');
  const segment=segmentList.data.segments.find((item)=>item.mode==='live'&&item.geometry.coordinates[0][0]===coordinates[0][0]&&item.geometry.coordinates[0][1]===coordinates[0][1]&&item.geometry.coordinates[1][0]===coordinates[1][0]&&item.geometry.coordinates[1][1]===coordinates[1][1]);assert.ok(segment);
  const [a,b]=segment.geometry.coordinates;const closure=await request('/hazards','POST',{type:'road_blockage',latitude:(a[1]+b[1])/2,longitude:(a[0]+b[0])/2,severity:'High',description:'Journey leg verification closure',is_complete_closure:true,segment_confirmed:true,affected_segment_id:segment.id});assert.equal(closure.status,201,JSON.stringify(closure.data));
  await request(`/hazards/${closure.data.hazard.id}`,'PATCH',{verification_status:'Verified'});
  const hospitalState=await request(`/routes/${selected.data.leg.calculationId}/state`);assert.equal(hospitalState.data.routes[0].isEligible,false);assert.ok(hospitalState.data.recommendedRouteId);
  const patientState=await request(`/routes/${firstCalculationId}/state`);assert.equal(patientState.data.routes.every((route)=>route.riskScore===0),true);
  const noAutoChange=await request(`/journeys/${planned.tripId}`);assert.equal(noAutoChange.data.hospitalId,destination.id);
  assert.ok(base.startsWith('http://127.0.0.1:'));
});

test('arrival and handover require the correct order and do not fabricate an ambulance fleet update',async(t)=>{
  const {request,addHospital,trip}=await fixture(t);const hospital=await addHospital('Handover Hospital',12.89,74.88);const planned=await trip();await pickup(request,planned.tripId);
  const recs=await request(`/journeys/${planned.tripId}/hospital-recommendations`,'POST',{});assert.equal(recs.status,200);
  const selected=await request(`/journeys/${planned.tripId}/hospital`,'POST',{hospitalId:hospital.id});assert.equal(selected.status,200);
  assert.equal((await request(`/journeys/${planned.tripId}/status`,'PATCH',{status:'handover_completed'})).status,409);
  await request(`/journeys/${planned.tripId}/status`,'PATCH',{status:'en_route_to_hospital'});
  const arrived=await request(`/journeys/${planned.tripId}/status`,'PATCH',{status:'arrived_at_hospital'});assert.equal(arrived.status,200);assert.ok(arrived.data.timestamps.arrived_at_hospital);
  const complete=await request(`/journeys/${planned.tripId}/status`,'PATCH',{status:'handover_completed'});assert.equal(complete.status,200);assert.ok(complete.data.timestamps.handover_completed);assert.equal(complete.data.ambulanceUpdated,false);assert.match(complete.data.ambulanceUpdateNote,/No ambulance is linked/);
  const ambulances=complete.status===200?await request('/health'):null;assert.equal(ambulances.status,200);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { openDatabase } from '../database/index.js';

const hospitalInput={name:'Harbor Medical Centre',latitude:12.87,longitude:74.85,address:'Harbor Road, Mangalore',phone:'+91 824 000 0000',email:'contact@example.org',capabilities:['emergency','trauma','icu']};
async function fixture(t,{clock=Date.now,adapter=null,fetchImpl=async(url)=>{
  const coordinates=url.pathname.split('/').at(-1).split(';').map((pair)=>pair.split(',').map(Number));
  return new Response(JSON.stringify({code:'Ok',routes:[{geometry:{type:'LineString',coordinates},distance:3000,duration:360}]}));
}}={}){
  const database=openDatabase(':memory:');const server=createApp(database,{clock,hospitalAvailabilityAdapter:adapter,fetchImpl,logger:{error(){}}}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise((resolve)=>server.close(resolve));database.close();});
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function request(path,method='GET',body){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();return {status:response.status,data};}
  return {database,base,request};
}

test('hospital directory supports create, edit, duplicate protection and retained deactivation',async(t)=>{
  const {request}=await fixture(t);const created=await request('/hospitals','POST',hospitalInput);
  assert.equal(created.status,201);const hospital=created.data.hospital;assert.match(hospital.id,/^HOSP-/);assert.equal(hospital.isActive,true);
  assert.deepEqual(hospital.capabilities,hospitalInput.capabilities);assert.equal(hospital.availability.status,'unknown');assert.equal(hospital.availability.neverReported,true);
  assert.equal((await request('/hospitals','POST',hospitalInput)).status,409);
  const edited=await request(`/hospitals/${hospital.id}`,'PATCH',{name:'Harbor General'});assert.equal(edited.status,200);assert.equal(edited.data.hospital.name,'Harbor General');
  const deactivated=await request(`/hospitals/${hospital.id}`,'DELETE');assert.equal(deactivated.status,200);assert.equal(deactivated.data.hospital.isActive,false);
  assert.equal((await request('/hospitals')).data.hospitals.length,0);
  assert.equal((await request('/hospitals?includeInactive=1')).data.hospitals[0].isActive,false);
  assert.equal((await request(`/hospitals/${hospital.id}`)).data.hospital.name,'Harbor General');
});

test('hospital status updates are audited, source-labelled and automatically become Unknown when stale',async(t)=>{
  let now=Date.parse('2026-11-19T10:00:00.000Z');const {request}=await fixture(t,{clock:()=>now});
  const hospital=(await request('/hospitals','POST',hospitalInput)).data.hospital;
  const update=await request(`/hospitals/${hospital.id}/availability`,'POST',{status:'accepting',updatedBy:'Asha Rao',updaterRole:'hospital_staff',notes:'Emergency team available'});
  assert.equal(update.status,201);assert.equal(update.data.hospital.availability.status,'accepting');assert.equal(update.data.hospital.availability.sourceLabel,'Staff-entered');
  assert.equal(update.data.hospital.availability.updatedBy,'Asha Rao');assert.equal(update.data.hospital.availability.history.length,1);
  await request(`/hospitals/${hospital.id}/availability`,'POST',{status:'limited',updatedBy:'Asha Rao',updaterRole:'hospital_staff',notes:'Limited intake'});
  const fresh=(await request(`/hospitals/${hospital.id}`)).data.hospital;assert.equal(fresh.availability.status,'limited');assert.equal(fresh.availability.history.length,2);
  now+=30*60*1000+1;const stale=(await request(`/hospitals/${hospital.id}`)).data.hospital;
  assert.equal(stale.availability.status,'unknown');assert.equal(stale.availability.stale,true);assert.equal(stale.availability.lastKnownStatus,'limited');assert.equal(stale.availability.sourceLabel,'Staff-entered');
});

test('hospital directory and availability reject invalid coordinates, contacts, statuses, updater and inactive updates',async(t)=>{
  const {request}=await fixture(t);
  for(const body of [{...hospitalInput,latitude:92},{...hospitalInput,phone:'',email:''},{...hospitalInput,email:'bad-email'},{...hospitalInput,capabilities:['invented']},{...hospitalInput,untrusted:'x'}])assert.equal((await request('/hospitals','POST',body)).status,400);
  const hospital=(await request('/hospitals','POST',hospitalInput)).data.hospital;
  for(const body of [{status:'unknown',updatedBy:'Staff',updaterRole:'hospital_staff'},{status:'accepting',updatedBy:'',updaterRole:'hospital_staff'},{status:'accepting',updatedBy:'Staff',updaterRole:'unknown'},{status:'accepting',updatedBy:'Staff',updaterRole:'hospital_staff',sourceKind:'integration'}])assert.equal((await request(`/hospitals/${hospital.id}/availability`,'POST',body)).status,400);
  assert.equal((await request('/hospitals/HOSP-missing')).status,404);assert.equal((await request('/hospitals/HOSP-missing/availability','POST',{status:'accepting',updatedBy:'Staff',updaterRole:'hospital_staff'})).status,404);
  await request(`/hospitals/${hospital.id}`,'DELETE');assert.equal((await request(`/hospitals/${hospital.id}/availability`,'POST',{status:'accepting',updatedBy:'Staff',updaterRole:'hospital_staff'})).status,409);
});

test('future feed boundary reports unconfigured or failed feeds without overwriting status, and labels injected feed updates',async(t)=>{
  const local=await fixture(t);const hospital=(await local.request('/hospitals','POST',hospitalInput)).data.hospital;
  const absent=await local.request(`/hospitals/${hospital.id}/availability/refresh`,'POST',{});assert.equal(absent.status,503);assert.equal(absent.data.error.includes('No authorized'),true);
  assert.equal((await local.request(`/hospitals/${hospital.id}`)).data.hospital.availability.status,'unknown');
  const configured=await fixture(t,{adapter:{async fetchAvailability(){return {status:'limited',notes:'Provider-confirmed operational limit'};}}});
  const other=(await configured.request('/hospitals','POST',hospitalInput)).data.hospital;
  const result=await configured.request(`/hospitals/${other.id}/availability/refresh`,'POST',{});
  assert.equal(result.status,200);assert.equal(result.data.hospital.availability.status,'limited');assert.equal(result.data.hospital.availability.sourceKind,'integration');assert.equal(result.data.hospital.availability.sourceLabel,'Authorized system feed');
  const failed=await fixture(t,{adapter:{async fetchAvailability(){throw new Error('provider unavailable');}}});
  const third=(await failed.request('/hospitals','POST',hospitalInput)).data.hospital;
  assert.equal((await failed.request(`/hospitals/${third.id}/availability/refresh`,'POST',{})).status,502);
  assert.equal((await failed.request(`/hospitals/${third.id}`)).data.hospital.availability.status,'unknown');
});

test('directory-selected hospital coordinates are authoritative for patient-to-hospital routing',async(t)=>{
  const {request}=await fixture(t);const hospital=(await request('/hospitals','POST',hospitalInput)).data.hospital;
  const trip=await request('/routes/trip/calculate','POST',{mode:'live',start:{lat:12.86,lng:74.83},patient:{lat:12.87,lng:74.84},hospital:{lat:0,lng:0},hospitalId:hospital.id});
  assert.equal(trip.status,200);assert.equal(trip.data.hospitalId,hospital.id);assert.deepEqual(trip.data.hospital,{lat:hospital.latitude,lng:hospital.longitude});
  const inactive=await request(`/hospitals/${hospital.id}`,'DELETE');assert.equal(inactive.status,200);
  const invalidTrip=await request('/routes/trip/calculate','POST',{mode:'live',start:{lat:12.86,lng:74.83},patient:{lat:12.87,lng:74.84},hospital:{lat:12.85,lng:74.86},hospitalId:hospital.id});
  assert.equal(invalidTrip.status,409);
});

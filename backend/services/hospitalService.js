import { randomUUID } from 'node:crypto';
import { RoutingError, validatePoint } from '../utils/routingValidation.js';

export const hospitalCapabilities=['emergency','trauma','cardiac','pediatric','icu','surgery','burn'];
export const availabilityStatuses=['accepting','limited','diverting'];
export const updaterRoles=['hospital_staff','dispatcher','administrator'];
const hospitalFields=['name','latitude','longitude','address','phone','email','capabilities'];
const maxText={name:140,address:300,phone:40,email:254};
const text=(value,max,label,{required=false}={})=>{
  if(typeof value!=='string'||value.length>max||required&&!value.trim())throw new RoutingError(`${label} must be ${required?'a non-empty ':''}text of at most ${max} characters.`);
  return value.trim();
};
function validateHospital(input,existing={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.keys(input).some((key)=>!hospitalFields.includes(key)))throw new RoutingError('Provide supported hospital fields only.');
  const value={...existing,...input};
  validatePoint({lat:value.latitude,lng:value.longitude},'Hospital location');
  const name=text(value.name,maxText.name,'Hospital name',{required:true});
  const address=text(value.address,maxText.address,'Hospital address',{required:true});
  const phone=text(value.phone||'',maxText.phone,'Hospital phone');
  const email=text(value.email||'',maxText.email,'Hospital email');
  if(!phone&&!email)throw new RoutingError('Provide a hospital phone number or email address.');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new RoutingError('Hospital email address is invalid.');
  if(!Array.isArray(value.capabilities)||value.capabilities.length>hospitalCapabilities.length||value.capabilities.some((item)=>!hospitalCapabilities.includes(item)))throw new RoutingError('Choose supported emergency-service capabilities.');
  return {name,latitude:value.latitude,longitude:value.longitude,address,phone,email,capabilities:[...new Set(value.capabilities)]};
}
function freshness(database,hospitalId,now,staleMinutes){
  const rows=database.prepare('SELECT id,status,source_kind,updated_by,updater_role,notes,updated_at,stale_after_seconds FROM hospital_availability_events WHERE hospital_id=? ORDER BY rowid DESC LIMIT 20').all(hospitalId);
  const latest=rows[0]||null;
  const stale=Boolean(latest&&now-Date.parse(latest.updated_at)>=latest.stale_after_seconds*1000);
  const unknown=!latest||stale;
  return {status:unknown?'unknown':latest.status,stale,neverReported:!latest,lastKnownStatus:stale?latest.status:null,
    sourceKind:latest?.source_kind||null,sourceLabel:!latest?'No status reported':latest.source_kind==='integration'?'Authorized system feed':'Staff-entered',
    updatedBy:latest?.updated_by||null,updaterRole:latest?.updater_role||null,notes:latest?.notes||'',lastUpdatedAt:latest?.updated_at||null,
    staleAt:latest?new Date(Date.parse(latest.updated_at)+latest.stale_after_seconds*1000).toISOString():null,
    staleAfterMinutes:latest?Math.round(latest.stale_after_seconds/60):staleMinutes,
    history:rows.map(({id,status,source_kind,updated_by,updater_role,notes,updated_at,stale_after_seconds})=>({id,status,sourceKind:source_kind,sourceLabel:source_kind==='integration'?'Authorized system feed':'Staff-entered',updatedBy:updated_by,updaterRole:updater_role,notes,updatedAt:updated_at,staleAfterMinutes:Math.round(stale_after_seconds/60)}))};
}
function serialize(database,row,now,staleMinutes){
  return {id:row.id,name:row.name,latitude:row.latitude,longitude:row.longitude,address:row.address,phone:row.phone,email:row.email,
    capabilities:JSON.parse(row.capabilities_json),isActive:Boolean(row.is_active),createdAt:row.created_at,updatedAt:row.updated_at,
    availability:freshness(database,row.id,now,staleMinutes)};
}
export function listHospitals(database,{now=Date.now(),staleMinutes=30,includeInactive=false}={}){
  const rows=database.prepare(`SELECT * FROM hospitals ${includeInactive?'':'WHERE is_active=1'} ORDER BY name COLLATE NOCASE,id`).all();
  return rows.map((row)=>serialize(database,row,now,staleMinutes));
}
export function getHospital(database,id,{now=Date.now(),staleMinutes=30}={}){
  const row=database.prepare('SELECT * FROM hospitals WHERE id=?').get(id);
  if(!row)throw new RoutingError('Hospital not found.',404);
  return serialize(database,row,now,staleMinutes);
}
export function createHospital(database,input,{now=Date.now(),staleMinutes=30}={}){
  const value=validateHospital(input);
  const duplicate=database.prepare('SELECT id FROM hospitals WHERE lower(name)=lower(?) AND abs(latitude-?)<0.000001 AND abs(longitude-?)<0.000001').get(value.name,value.latitude,value.longitude);
  if(duplicate)throw new RoutingError('This hospital is already in the directory.',409);
  const id=`HOSP-${randomUUID()}`,timestamp=new Date(now).toISOString();
  database.prepare('INSERT INTO hospitals (id,name,latitude,longitude,address,phone,email,capabilities_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
    .run(id,value.name,value.latitude,value.longitude,value.address,value.phone,value.email,JSON.stringify(value.capabilities),timestamp,timestamp);
  return getHospital(database,id,{now,staleMinutes});
}
export function updateHospital(database,id,input,{now=Date.now(),staleMinutes=30}={}){
  const current=getHospital(database,id,{now,staleMinutes});
  if(!current.isActive)throw new RoutingError('Inactive hospitals cannot be edited.',409);
  const value=validateHospital(input,{...current});
  const duplicate=database.prepare('SELECT id FROM hospitals WHERE lower(name)=lower(?) AND abs(latitude-?)<0.000001 AND abs(longitude-?)<0.000001 AND id<>?').get(value.name,value.latitude,value.longitude,id);
  if(duplicate)throw new RoutingError('This hospital is already in the directory.',409);
  database.prepare('UPDATE hospitals SET name=?,latitude=?,longitude=?,address=?,phone=?,email=?,capabilities_json=?,updated_at=? WHERE id=?')
    .run(value.name,value.latitude,value.longitude,value.address,value.phone,value.email,JSON.stringify(value.capabilities),new Date(now).toISOString(),id);
  return getHospital(database,id,{now,staleMinutes});
}
export function deactivateHospital(database,id,{now=Date.now(),staleMinutes=30}={}){
  const hospital=getHospital(database,id,{now,staleMinutes});
  if(hospital.isActive)database.prepare('UPDATE hospitals SET is_active=0,updated_at=? WHERE id=?').run(new Date(now).toISOString(),id);
  return getHospital(database,id,{now,staleMinutes});
}
function validateUpdate(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some((key)=>!['status','updatedBy','updaterRole','notes'].includes(key)))throw new RoutingError('Provide a status, updater name, updater role and optional notes.');
  if(!availabilityStatuses.includes(input.status))throw new RoutingError('Status must be Accepting ambulances, Limited or Diverting / not accepting. Unknown is assigned automatically when no current status is available.');
  const updatedBy=text(input.updatedBy,100,'Updater identity',{required:true});
  if(!updaterRoles.includes(input.updaterRole))throw new RoutingError('Updater role must be Hospital staff, Dispatcher or Administrator.');
  const notes=text(input.notes||'',500,'Status notes');
  return {status:input.status,updatedBy,updaterRole:input.updaterRole,notes};
}
function storeAvailability(database,id,value,{now,staleMinutes,sourceKind}){
  const hospital=getHospital(database,id,{now,staleMinutes});
  if(!hospital.isActive)throw new RoutingError('Availability cannot be updated for an inactive hospital.',409);
  const updatedAt=new Date(now).toISOString();
  database.prepare('INSERT INTO hospital_availability_events (id,hospital_id,status,source_kind,updated_by,updater_role,notes,updated_at,stale_after_seconds) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(randomUUID(),id,value.status,sourceKind,value.updatedBy,value.updaterRole,value.notes,updatedAt,staleMinutes*60);
  return getHospital(database,id,{now,staleMinutes});
}
export function recordStaffAvailability(database,id,input,{now=Date.now(),staleMinutes=30}={}){
  return storeAvailability(database,id,validateUpdate(input),{now,staleMinutes,sourceKind:'staff'});
}
export async function refreshFromAuthorizedFeed(database,id,adapter,{now=Date.now(),staleMinutes=30}={}){
  const hospital=getHospital(database,id,{now,staleMinutes});
  if(!hospital.isActive)throw new RoutingError('Availability cannot be refreshed for an inactive hospital.',409);
  if(!adapter||typeof adapter.fetchAvailability!=='function')throw new RoutingError('No authorized hospital availability feed is configured. Status was not changed.',503);
  let result;
  try{result=await adapter.fetchAvailability({id:hospital.id,name:hospital.name,latitude:hospital.latitude,longitude:hospital.longitude});}
  catch{throw new RoutingError('The authorized hospital feed is unavailable. The last stored status was not changed.',502);}
  let value;
  try{value=validateUpdate({...result,updatedBy:result?.updatedBy||'Authorized hospital integration',updaterRole:result?.updaterRole||'administrator'});}
  catch{throw new RoutingError('The authorized hospital feed returned an invalid status. The last stored status was not changed.',502);}
  return storeAvailability(database,id,value,{now,staleMinutes,sourceKind:'integration'});
}

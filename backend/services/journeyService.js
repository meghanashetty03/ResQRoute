import { RoutingError } from '../utils/routingValidation.js';
import { getHospital } from './hospitalService.js';

export const journeyStatuses=['planned','en_route_to_patient','arrived_at_patient','patient_picked_up','en_route_to_hospital','arrived_at_hospital','handover_completed'];
const nextStatus={planned:'en_route_to_patient',en_route_to_patient:'arrived_at_patient',arrived_at_patient:'patient_picked_up',patient_picked_up:'en_route_to_hospital',en_route_to_hospital:'arrived_at_hospital',arrived_at_hospital:'handover_completed'};
const timestampColumn={planned:'planned_at',en_route_to_patient:'en_route_to_patient_at',arrived_at_patient:'arrived_at_patient_at',patient_picked_up:'patient_picked_up_at',en_route_to_hospital:'en_route_to_hospital_at',arrived_at_hospital:'arrived_at_hospital_at',handover_completed:'handover_completed_at'};
const round=(value)=>Number(value.toFixed(2));

function rowFor(database,id){
  if(typeof id!=='string'||!id)throw new RoutingError('A journey ID is required.');
  const row=database.prepare('SELECT * FROM journeys WHERE id=?').get(id);
  if(!row)throw new RoutingError('Journey not found. Plan a trip before updating journey status.',404);
  return row;
}
export function createJourney(database,{id,start,patient,hospital,hospitalId,hospitalName='',hospitalAddress='',calculationIds,now=Date.now()}){
  const timestamp=new Date(now).toISOString();
  database.prepare(`INSERT INTO journeys (id,status,start_lat,start_lng,patient_lat,patient_lng,hospital_id,hospital_lat,hospital_lng,hospital_name,hospital_address,hospital_confirmed_at,
    ambulance_to_patient_calculation_id,patient_to_hospital_calculation_id,recommendations_json,recommendations_generated_at,created_at,updated_at,planned_at)
    VALUES (?,'planned',?,?,?,?,?,?,?,?,?,NULL,?,?,'[]',NULL,?,?,?)`).run(id,start.lat,start.lng,patient.lat,patient.lng,hospitalId||null,hospital.lat,hospital.lng,hospitalName,hospitalAddress,calculationIds[0],calculationIds[1],timestamp,timestamp,timestamp);
  return rowFor(database,id);
}
export function recoverJourney(database,id,calculationIds,{now=Date.now()}={}){
  const existing=database.prepare('SELECT id FROM journeys WHERE id=?').get(id);
  if(existing)return rowFor(database,id);
  if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)||!Array.isArray(calculationIds)||calculationIds.length!==2||calculationIds.some((value)=>typeof value!=='string'))throw new RoutingError('Saved trip details are invalid. Plan the trip again to enable journey tracking.');
  const first=database.prepare('SELECT candidates_json FROM route_calculations WHERE id=?').get(calculationIds[0]);
  const second=database.prepare('SELECT candidates_json FROM route_calculations WHERE id=?').get(calculationIds[1]);
  if(!first||!second)throw new RoutingError('Saved trip routes are no longer available. Plan the trip again to enable journey tracking.',404);
  const one=JSON.parse(first.candidates_json),two=JSON.parse(second.candidates_json);
  const same=(a,b)=>a&&b&&Math.abs(a.lat-b.lat)<0.000001&&Math.abs(a.lng-b.lng)<0.000001;
  if(one.mode!=='live'||two.mode!=='live'||!same(one.destination,two.start))throw new RoutingError('Saved routes do not form a valid two-leg trip. Plan the trip again to enable journey tracking.',409);
  const start=one.start,patient=one.destination,hospital=two.destination;
  const match=database.prepare('SELECT id FROM hospitals WHERE abs(latitude-?)<0.000001 AND abs(longitude-?)<0.000001 ORDER BY is_active DESC LIMIT 1').get(hospital.lat,hospital.lng);
  return createJourney(database,{id,start,patient,hospital,hospitalId:match?.id||null,hospitalName:match?.id?database.prepare('SELECT name FROM hospitals WHERE id=?').get(match.id)?.name||'':'',calculationIds,now});
}
export function transitionJourney(database,id,target,{now=Date.now()}={}){
  const row=rowFor(database,id);
  if(!journeyStatuses.includes(target))throw new RoutingError('Choose a supported journey status.');
  if(target!==nextStatus[row.status])throw new RoutingError(`Journey status cannot move from ${row.status.replaceAll('_',' ')} to ${target.replaceAll('_',' ')}.`,409);
  if(target==='en_route_to_hospital'&&(!row.hospital_confirmed_at||!row.patient_to_hospital_calculation_id))throw new RoutingError('Confirm a hospital destination and route before starting transport.',409);
  if(target==='en_route_to_hospital'){
    const runtime=database.prepare('SELECT evaluation_json FROM route_runtime WHERE calculation_id=?').get(row.patient_to_hospital_calculation_id);
    if(!runtime||!JSON.parse(runtime.evaluation_json).recommendedRouteId)throw new RoutingError('No eligible hospital route is available. Dispatcher review is required.',409);
  }
  const updatedAt=new Date(now).toISOString();
  const result=database.prepare(`UPDATE journeys SET status=?,${timestampColumn[target]}=?,updated_at=? WHERE id=? AND status=?`).run(target,updatedAt,updatedAt,id,row.status);
  if(!result.changes)throw new RoutingError('Journey status changed elsewhere. Refresh and try again.',409);
  return rowFor(database,id);
}
export function saveHospitalRecommendations(database,id,options,{now=Date.now()}={}){
  const row=rowFor(database,id);
  if(row.status!=='patient_picked_up')throw new RoutingError('Hospital recommendations are available after patient pickup.',409);
  const generatedAt=new Date(now).toISOString();
  database.prepare('UPDATE journeys SET recommendations_json=?,recommendations_generated_at=?,updated_at=? WHERE id=?')
    .run(JSON.stringify(options),generatedAt,generatedAt,id);
  return rowFor(database,id);
}
export function saveJourneyHospital(database,id,{hospital,calculationId},{now=Date.now()}={}){
  const row=rowFor(database,id);
  if(row.status!=='patient_picked_up')throw new RoutingError('Confirm a hospital after patient pickup and before starting transport.',409);
  const updatedAt=new Date(now).toISOString();
  database.prepare(`UPDATE journeys SET hospital_id=?,hospital_lat=?,hospital_lng=?,hospital_name=?,hospital_address=?,hospital_confirmed_at=?,patient_to_hospital_calculation_id=?,updated_at=? WHERE id=? AND status='patient_picked_up'`)
    .run(hospital.id||null,hospital.latitude,hospital.longitude,hospital.name||'',hospital.address||'',updatedAt,calculationId,updatedAt,id);
  return rowFor(database,id);
}

function scoreHospitals(options){
  const eligible=options.filter((option)=>option.bestRoute&&option.hospital.isActive&&option.hospital.availability.status!=='diverting');
  const costs=eligible.map((option)=>option.bestRoute.finalCost);
  const lowest=Math.min(...costs);
  const statusPoints={accepting:100,limited:60,unknown:20,diverting:0};
  for(const option of options){
    const route=option.bestRoute;const availability=option.hospital.availability.status;
    option.recommendable=Boolean(route&&option.hospital.isActive&&availability!=='diverting');
    if(route){
      const routeScore=route.finalCost>0?Math.min(100,100*lowest/route.finalCost):100;
      option.score=round(0.7*routeScore+0.3*statusPoints[availability]);
      option.explanation=`Route time ${route.durationMinutes.toFixed(1)} min; risk-adjusted cost ${route.finalCost.toFixed(2)} equivalent min; ${availability==='unknown'?'availability unknown or stale':`${availability} status`}. Capabilities are shown for dispatcher review; patient-specific treatment needs are not recorded.`;
    }else{
      option.score=null;option.rank=null;
      option.explanation=option.routeError||(!option.hospital.isActive?'Hospital is inactive.':availability==='diverting'?'Hospital is diverting ambulances.':'No eligible route candidate is available.');
    }
    if(availability==='diverting')option.explanation=`Hospital is diverting ambulances; confirm directly before considering it. ${route?'A route exists but this hospital is not recommended.':''}`.trim();
  }
  const ranked=eligible.sort((a,b)=>b.score-a.score||a.bestRoute.finalCost-b.bestRoute.finalCost||a.hospital.name.localeCompare(b.hospital.name));
  ranked.forEach((option,index)=>{option.rank=index+1;});
  options.forEach((option)=>{if(!option.recommendable)option.rank=null;});
  return options.sort((a,b)=>{
    if(a.recommendable!==b.recommendable)return Number(b.recommendable)-Number(a.recommendable);
    if(a.recommendable&&b.recommendable)return a.rank-b.rank;
    return (a.bestRoute?.finalCost??Infinity)-(b.bestRoute?.finalCost??Infinity)||a.hospital.name.localeCompare(b.hospital.name);
  });
}

export function getJourney(database,id,{rerouting,now=Date.now(),staleMinutes=30}={}){
  const row=rowFor(database,id);
  const directoryHospital=row.hospital_id?getHospital(database,row.hospital_id,{now,staleMinutes}):null;
  const hospital=directoryHospital?{id:directoryHospital.id,name:directoryHospital.name,address:directoryHospital.address,latitude:directoryHospital.latitude,longitude:directoryHospital.longitude,isActive:directoryHospital.isActive,phone:directoryHospital.phone,email:directoryHospital.email,availability:directoryHospital.availability,capabilities:directoryHospital.capabilities,source:'Hospital directory'}:
    {id:null,name:row.hospital_name||'Manually selected destination',address:row.hospital_address||'Address not recorded',latitude:row.hospital_lat,longitude:row.hospital_lng,isActive:true,phone:'',email:'',availability:{status:'unknown',stale:true,neverReported:true,sourceLabel:'No directory status',lastUpdatedAt:null},capabilities:[],source:'Current trip destination'};
  let selectedLeg=null;
  try{selectedLeg=rerouting.read(row.patient_to_hospital_calculation_id);}catch{}
  const raw=JSON.parse(row.recommendations_json||'[]');
  const recommendations=raw.map((saved)=>{
    let currentHospital;
    try{currentHospital=getHospital(database,saved.hospitalId,{now,staleMinutes});}catch{return null;}
    if(saved.error)return {hospital:currentHospital,routes:[],bestRoute:null,routeError:saved.error,score:null,rank:null,recommendable:false,explanation:saved.error};
    try{
      const evaluation=rerouting.read(saved.calculationId);
      const routes=evaluation.routes;
      return {hospital:currentHospital,routes,bestRoute:routes.find((route)=>route.id===evaluation.recommendedRouteId)||null,
        calculationId:evaluation.calculationId,routeError:null,score:null,rank:null,recommendable:false,explanation:''};
    }catch(error){return {hospital:currentHospital,routes:[],bestRoute:null,routeError:`Route results are unavailable: ${error.message}`,score:null,rank:null,recommendable:false,explanation:`Route results are unavailable: ${error.message}`};}
  }).filter(Boolean);
  return {id:row.id,status:row.status,start:{lat:row.start_lat,lng:row.start_lng},patient:{lat:row.patient_lat,lng:row.patient_lng},hospital,
    hospitalId:row.hospital_id,hospitalConfirmedAt:row.hospital_confirmed_at,patientToHospitalCalculationId:row.patient_to_hospital_calculation_id,patientToHospitalEligible:Boolean(selectedLeg?.recommendedRouteId),patientToHospitalRecommendation: selectedLeg?.recommendedRouteId||null,ambulanceToPatientCalculationId:row.ambulance_to_patient_calculation_id,
    recommendationsGeneratedAt:row.recommendations_generated_at,recommendations:scoreHospitals(recommendations),
    timestamps:{planned:row.planned_at,en_route_to_patient:row.en_route_to_patient_at,arrived_at_patient:row.arrived_at_patient_at,patient_picked_up:row.patient_picked_up_at,en_route_to_hospital:row.en_route_to_hospital_at,arrived_at_hospital:row.arrived_at_hospital_at,handover_completed:row.handover_completed_at},
    ambulanceUpdated:false,ambulanceUpdateNote:'No ambulance is linked to this trip; fleet availability was not changed.',updatedAt:row.updated_at};
}

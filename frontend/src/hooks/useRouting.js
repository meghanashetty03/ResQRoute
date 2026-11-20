import { useEffect, useRef, useState } from 'react';
import { routingRequest } from '../services/api.js';
import { pointFromDraft } from '../utils/coordinates.js';
import { readSession,writeSession } from '../services/session.js';

const empty={status:'idle',data:null,error:null};
function savedTripId(){try{return window.sessionStorage.getItem('resqroute.tripId')||null;}catch{return null;}}
function tripView(legs,tripId) {
  const first=legs[0],second=legs[1];
  return {...first,tripId,isTrip:true,trip:{legs:{ambulanceToPatient:first,patientToHospital:second}},
    notifications:[...first.notifications.map((event)=>({...event,legLabel:'Ambulance → patient'})),...second.notifications.map((event)=>({...event,legLabel:'Patient → hospital'}))].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)),
    evaluationVersion:Math.max(first.evaluationVersion||0,second.evaluationVersion||0)};
}
export function useRouting(draft,setDraft) {
  const saved=useRef(readSession());
  const [mode,setMode]=useState(saved.current.mode);
  const [calculationId,setCalculationId]=useState(saved.current.calculationId);
  const [tripCalculationIds,setTripCalculationIds]=useState(saved.current.tripCalculationIds);
  const initialIds=saved.current.tripCalculationIds|| (saved.current.calculationId?[saved.current.calculationId]:[]);
  const [result,setResult]=useState(initialIds.length?{status:'loading',data:null,error:null}:empty);
  const [selectedId,setSelectedId]=useState(null);
  const [target,setTarget]=useState('start');
  const controllerRef=useRef(null),busy=useRef(false),activeKey=useRef(initialIds.join('|'));
  const [demoAction,setDemoAction]=useState({busy:false,message:'',error:''});
  const ids=tripCalculationIds|| (calculationId?[calculationId]:[]);
  const idsKey=ids.join('|');
  useEffect(()=>()=>controllerRef.current?.abort(),[]);
  useEffect(()=>{writeSession({draft,mode,calculationId,tripCalculationIds});},[draft,mode,calculationId,tripCalculationIds]);

  function applyStates(states) {
    const data=states.length===2?tripView(states,tripCalculationIds?undefined:null):states[0];
    if(!data)return;
    if(states.length===2){data.tripId=savedTripId();}
    setResult((previous)=>({status:states.some((item)=>item.synchronizationError)?'error':'success',data,error:states.find((item)=>item.synchronizationError)?.synchronizationError||null}));
    setMode(data.mode);
    const allRouteKeys=states.length===2?states.flatMap((item)=>item.routes.map((route)=>`${item.calculationId===ids[0]?'ambulanceToPatient':'patientToHospital'}:${route.id}`)):data.routes.map((route)=>route.id);
    if(!selectedId||!allRouteKeys.includes(selectedId))setSelectedId(states.length===2?`ambulanceToPatient:${data.recommendedRouteId}`:data.recommendedRouteId||null);
    if(states.length===2){
      const one=states.find((item)=>item.calculationId===ids[0]),two=states.find((item)=>item.calculationId===ids[1]);
      if(one&&two){data.trip= {legs:{ambulanceToPatient:one,patientToHospital:two}};data.notifications=[...one.notifications.map((event)=>({...event,legLabel:'Ambulance → patient'})),...two.notifications.map((event)=>({...event,legLabel:'Patient → hospital'}))].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));}
      const first=data.trip.legs.ambulanceToPatient,second=data.trip.legs.patientToHospital;
      data.tripId=savedTripId();
      data.start=first.start;data.destination=first.destination;data.hospital=second.destination;
    }
    if(saved.current.tripCalculationIds||saved.current.calculationId){
      setDraft((previous)=>({...previous,start_lat:String(data.start.lat),start_lng:String(data.start.lng),pickup_lat:String(data.destination.lat),pickup_lng:String(data.destination.lng),...(data.hospital?{hospital_lat:String(data.hospital.lat),hospital_lng:String(data.hospital.lng)}:{})}));
      saved.current={};setTarget(null);
    }
  }
  useEffect(()=>{
    if(!ids.length)return;
    let stopped=false,inFlight=false,controller;
    async function synchronize(){if(stopped||inFlight||busy.current)return;inFlight=true;controller=new AbortController();try{
      const states=await Promise.all(ids.map((id)=>routingRequest(`/routes/${encodeURIComponent(id)}/state`,{signal:controller.signal})));
      if(stopped||activeKey.current!==idsKey)return;
      applyStates(states);
    }catch(error){if(!stopped&&error.status===404){setResult({status:'error',data:null,error:'The saved route calculation is no longer available. Find routes again or load the demo.'});}
      else if(!stopped&&!controller.signal.aborted)setResult((previous)=>({...previous,status:'error',error:`Automatic route synchronization failed. Retrying: ${error.message}`}));
    }finally{inFlight=false;}}
    synchronize();const interval=setInterval(synchronize,1000);const wake=()=>{if(document.visibilityState==='visible')synchronize();};document.addEventListener('visibilitychange',wake);
    return()=>{stopped=true;controller?.abort();clearInterval(interval);document.removeEventListener('visibilitychange',wake);};
  },[idsKey]);

  function invalidate(){controllerRef.current?.abort();activeKey.current='';busy.current=false;setCalculationId(null);setTripCalculationIds(null);setResult(empty);setSelectedId(null);try{sessionStorage.removeItem('resqroute.tripId');}catch{}}
  function changeDraft(next){
    const coordinatesChanged=['start_lat','start_lng','pickup_lat','pickup_lng','hospital_lat','hospital_lng'].some((key)=>next[key]!==draft[key]);
    if((next.hospital_lat!==draft.hospital_lat||next.hospital_lng!==draft.hospital_lng)&&next.hospital_id===draft.hospital_id)next={...next,hospital_id:''};
    if(coordinatesChanged){invalidate();setMode('live');}setDraft(next);
  }
  function updatePlaceQuery(prefix,value){changeDraft({...draft,[`${prefix}_name`]:value,[`${prefix}_source`]:'',[`${prefix}_lat`]:'',[`${prefix}_lng`]:'',...(prefix==='hospital'?{hospital_id:''}:{})});}
  function selectPlace(prefix,place){changeDraft({...draft,[`${prefix}_name`]:[place.name,place.address].filter(Boolean).join(', '),[`${prefix}_source`]:place.source||'OpenStreetMap',[`${prefix}_lat`]:String(place.lat),[`${prefix}_lng`]:String(place.lng),...(prefix==='hospital'?{hospital_id:place.hospitalId||''}:{})});}
  function selectHospital(hospital){selectPlace('hospital',{name:hospital.name,address:hospital.address,lat:hospital.latitude,lng:hospital.longitude,source:'Hospital directory',hospitalId:hospital.id});}
  function selectPoint(point){if(!target)return;changeDraft({...draft,[`${target}_lat`]:point.lat.toFixed(6),[`${target}_lng`]:point.lng.toFixed(6),[`${target}_name`]:`Map location: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`,[`${target}_source`]:'map',...(target==='hospital'?{hospital_id:''}:{})});}
  function begin(keepData=false){controllerRef.current?.abort();const controller=new AbortController();controllerRef.current=controller;busy.current=true;if(!keepData){activeKey.current='';setCalculationId(null);setTripCalculationIds(null);setSelectedId(null);}setResult((previous)=>({status:'loading',data:keepData?previous.data:null,error:null}));return controller;}
  async function runRequest(body,controller,path='/routes/calculate',updateLocations=false){
    try{const data=await routingRequest(path,{body,method:'POST',signal:controller.signal});if(controller.signal.aborted)return;
      if(data.isTrip){const ids=[data.legs.ambulanceToPatient.calculationId,data.legs.patientToHospital.calculationId];activeKey.current=ids.join('|');setCalculationId(null);setTripCalculationIds(ids);setMode('live');setDraft({...draft,start_lat:String(data.start.lat),start_lng:String(data.start.lng),pickup_lat:String(data.patient.lat),pickup_lng:String(data.patient.lng),hospital_lat:String(data.hospital.lat),hospital_lng:String(data.hospital.lng),hospital_id:data.hospitalId||''});setTarget(null);try{sessionStorage.setItem('resqroute.tripId',data.tripId);}catch{};applyTripResponse(data);return;}
      if(!Array.isArray(data.routes)||!data.routes.length)throw new Error('No route candidates were returned.');
      setTripCalculationIds(null);setCalculationId(data.calculationId);activeKey.current=data.calculationId;setResult({status:data.synchronizationError?'error':'success',data,error:data.synchronizationError||null});setSelectedId(data.recommendedRouteId||null);
      if(updateLocations){setDraft({...draft,start_lat:String(data.start.lat),start_lng:String(data.start.lng),pickup_lat:String(data.destination.lat),pickup_lng:String(data.destination.lng),hospital_id:''});setMode('demo');setTarget(null);}
    }catch(error){if(!controller.signal.aborted)setResult((previous)=>({status:'error',data:previous.data,error:error.message}));}
    finally{if(controllerRef.current===controller)busy.current=false;}
  }
  function applyTripResponse(response){
    const legs={ambulanceToPatient:response.legs.ambulanceToPatient,patientToHospital:response.legs.patientToHospital};
    const data=tripView([legs.ambulanceToPatient,legs.patientToHospital],response.tripId);data.start=response.start;data.destination=response.patient;data.hospital=response.hospital;
    data.trip={legs};data.tripId=response.tripId;data.tripNotice=response.notice;
    setResult({status:'success',data,error:null});setSelectedId(`ambulanceToPatient:${data.recommendedRouteId||''}`);
  }
  function replaceHospitalLeg(leg,hospital){
    if(ids.length===2){const next=[ids[0],leg.calculationId];activeKey.current=next.join('|');setTripCalculationIds(next);}
    setSelectedId(`patientToHospital:${leg.recommendedRouteId||''}`);
    setDraft((previous)=>({...previous,hospital_id:hospital.id||'',hospital_lat:String(hospital.latitude),hospital_lng:String(hospital.longitude),hospital_name:[hospital.name,hospital.address].filter(Boolean).join(', '),hospital_source:hospital.source|| (hospital.id?'Hospital directory':'manual')}));
    setResult((previous)=>{
      const current=previous.data?.trip?.legs?.ambulanceToPatient;
      if(!current)return previous;
      const first=current;
      const data=tripView([first,leg],previous.data.tripId);data.tripId=previous.data.tripId;
      data.start=first.start;data.destination=first.destination;data.hospital=leg.destination;
      data.trip={legs:{ambulanceToPatient:first,patientToHospital:leg}};
      data.notifications=[...(first.notifications||[]).map((event)=>({...event,legLabel:'Ambulance → patient'})),...(leg.notifications||[]).map((event)=>({...event,legLabel:'Patient → hospital'}))].sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
      return {...previous,data};
    });
  }
  async function calculate(){
    const start=pointFromDraft(draft,'start'),patient=pointFromDraft(draft,'pickup'),hospital=pointFromDraft(draft,'hospital');
    if(!start||!patient||!hospital||start.lat===patient.lat&&start.lng===patient.lng||patient.lat===hospital.lat&&patient.lng===hospital.lng){setResult({...empty,status:'error',error:'Choose three valid locations. Ambulance, patient and hospital points must form two non-zero legs.'});return;}
    await runRequest({mode:'live',start,patient,hospital,...(draft.hospital_id?{hospitalId:draft.hospital_id}:{}),...(draft.hospital_name?{hospitalName:draft.hospital_name}:{})},begin(),'/routes/trip/calculate');
  }
  async function loadDemo(){setDemoAction({busy:false,message:'',error:''});await runRequest(undefined,begin(),'/routes/demo/reset',true);}
  async function loadReroutingDemo(){await loadDemo();}
  async function clearDemoHazards(){setDemoAction({busy:true,message:'',error:''});try{const data=await routingRequest('/routes/rerouting-demo/hazards',{method:'DELETE'});setDemoAction({busy:false,message:data.message,error:data.reroutingErrors?.length?'Demo reports cleared, but route synchronization will retry.':''});}catch(error){setDemoAction({busy:false,message:'',error:error.message});}}
  function useLive(){invalidate();setMode('live');setTarget('start');}
  async function recalculate(){if(!ids.length)return;const controller=begin(true);try{const states=await Promise.all(ids.map((id)=>routingRequest('/routes/recalculate',{body:{calculationId:id},signal:controller.signal})));if(ids.length===2)applyStates(states);else setResult({status:'success',data:states[0],error:null});}catch(error){setResult((previous)=>({...previous,status:'error',error:error.message}));}finally{busy.current=false;}}
  return {...result,mode,calculationId,tripCalculationIds,journeyId:result.data?.tripId||savedTripId(),demoAction,clearDemoHazards,selectedId,setSelectedId,target,setTarget,changeDraft,updatePlaceQuery,selectPlace,selectPoint,selectHospital,replaceHospitalLeg,calculate,recalculate,loadDemo,loadReroutingDemo,useLive,routes:result.data?.trip?.legs?.ambulanceToPatient?.routes||result.data?.routes||[],trip:result.data?.trip||null};
}

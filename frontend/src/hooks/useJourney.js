import { useCallback, useEffect, useRef, useState } from 'react';
import { routingRequest } from '../services/api.js';

export function useJourney(journeyId,routing){
  const [state,setState]=useState({journey:null,status:'idle',error:null,busy:false,recommendationBusy:false});
  const generating=useRef(null);
  const recoveryAttempted=useRef(null);
  const firstCalculationId=routing.trip?.legs?.ambulanceToPatient?.calculationId||null;
  const secondCalculationId=routing.trip?.legs?.patientToHospital?.calculationId||null;
  const refresh=useCallback(async({signal}={})=>{
    if(!journeyId)return null;
    try{const journey=await routingRequest(`/journeys/${encodeURIComponent(journeyId)}`,{signal});setState((previous)=>({...previous,journey,status:'success',error:null}));return journey;}
    catch(error){
      if(error.status===404&&firstCalculationId&&secondCalculationId&&recoveryAttempted.current!==journeyId){
        recoveryAttempted.current=journeyId;
        try{const journey=await routingRequest(`/journeys/${encodeURIComponent(journeyId)}/recover`,{body:{calculationIds:[firstCalculationId,secondCalculationId]},signal});setState((previous)=>({...previous,journey,status:'success',error:null}));return journey;}
        catch(recoveryError){if(!signal?.aborted)setState((previous)=>({...previous,status:'error',error:recoveryError.message}));return null;}
      }
      if(!signal?.aborted)setState((previous)=>({...previous,status:'error',error:error.status===404?'Journey tracking is unavailable for this saved trip. Replan the trip to enable journey status updates.':error.message}));return null;
    }
  },[journeyId,firstCalculationId,secondCalculationId]);
  const refreshRecommendations=useCallback(async()=>{
    if(!journeyId)return;
    setState((previous)=>({...previous,recommendationBusy:true,error:null}));
    try{const journey=await routingRequest(`/journeys/${encodeURIComponent(journeyId)}/hospital-recommendations`,{method:'POST',body:{}});setState((previous)=>({...previous,journey,status:'success',recommendationBusy:false,error:null}));}
    catch(error){setState((previous)=>({...previous,recommendationBusy:false,error:error.message}));}
  },[journeyId]);
  useEffect(()=>{
    setState({journey:null,status:journeyId?'loading':'idle',error:null,busy:false,recommendationBusy:false});generating.current=null;recoveryAttempted.current=null;
    if(!journeyId)return;
    const controller=new AbortController();refresh({signal:controller.signal});
    const timer=setInterval(()=>refresh({signal:controller.signal}),4000);
    return()=>{controller.abort();clearInterval(timer);};
  },[journeyId,refresh]);
  useEffect(()=>{
    if(state.journey?.id!==journeyId||state.journey.status!=='patient_picked_up'||state.journey.recommendationsGeneratedAt||generating.current===journeyId)return;
    generating.current=journeyId;refreshRecommendations();
  },[journeyId,state.journey,refreshRecommendations]);
  async function advance(status){
    if(!journeyId)return;setState((previous)=>({...previous,busy:true,error:null}));
    try{const journey=await routingRequest(`/journeys/${encodeURIComponent(journeyId)}/status`,{body:{status},method:'PATCH'});setState((previous)=>({...previous,journey,busy:false,status:'success',error:null}));return journey;}
    catch(error){setState((previous)=>({...previous,busy:false,error:error.message}));return null;}
  }
  async function selectHospital(hospitalId){
    if(!journeyId)return;setState((previous)=>({...previous,busy:true,error:null}));
    try{const result=await routingRequest(`/journeys/${encodeURIComponent(journeyId)}/hospital`,{body:{hospitalId}});routing.replaceHospitalLeg(result.leg,result.journey.hospital);setState((previous)=>({...previous,journey:result.journey,busy:false,status:'success',error:null}));return result.journey;}
    catch(error){setState((previous)=>({...previous,busy:false,error:error.message}));return null;}
  }
  async function confirmCurrentDestination(){
    if(!journeyId)return;setState((previous)=>({...previous,busy:true,error:null}));
    try{const result=await routingRequest(`/journeys/${encodeURIComponent(journeyId)}/hospital`,{body:{keepCurrent:true}});routing.replaceHospitalLeg(result.leg,result.journey.hospital);setState((previous)=>({...previous,journey:result.journey,busy:false,status:'success',error:null}));return result.journey;}
    catch(error){setState((previous)=>({...previous,busy:false,error:error.message}));return null;}
  }
  return {...state,refresh,advance,selectHospital,confirmCurrentDestination,refreshRecommendations};
}

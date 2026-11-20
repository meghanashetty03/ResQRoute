import { useCallback, useEffect, useState } from 'react';
import { routingRequest } from '../services/api.js';

export function useHospitals(){
  const [state,setState]=useState({status:'loading',hospitals:[],error:null,feedConfigured:false,staleAfterMinutes:30});
  const [busy,setBusy]=useState(false);
  const refresh=useCallback(async({silent=false}={})=>{
    if(!silent)setState((previous)=>({...previous,status:'loading',error:null}));
    try{const data=await routingRequest('/hospitals?includeInactive=1');setState({status:'success',hospitals:data.hospitals,error:null,feedConfigured:data.feedConfigured,staleAfterMinutes:data.staleAfterMinutes});return data;}
    catch(error){setState((previous)=>({...previous,status:'error',error:error.message}));throw error;}
  },[]);
  useEffect(()=>{refresh().catch(()=>{});const timer=setInterval(()=>refresh({silent:true}).catch(()=>{}),15000);const wake=()=>{if(document.visibilityState==='visible')refresh({silent:true}).catch(()=>{});};document.addEventListener('visibilitychange',wake);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',wake);};},[refresh]);
  const perform=useCallback(async(action)=>{setBusy(true);try{const result=await action();await refresh({silent:true});return result;}finally{setBusy(false);}},[refresh]);
  return {...state,busy,refresh,
    create:(body)=>perform(()=>routingRequest('/hospitals',{body})),
    update:(id,body)=>perform(()=>routingRequest(`/hospitals/${encodeURIComponent(id)}`,{method:'PATCH',body})),
    deactivate:(id)=>perform(()=>routingRequest(`/hospitals/${encodeURIComponent(id)}`,{method:'DELETE'})),
    updateAvailability:(id,body)=>perform(()=>routingRequest(`/hospitals/${encodeURIComponent(id)}/availability`,{body})),
    refreshFeed:(id)=>perform(()=>routingRequest(`/hospitals/${encodeURIComponent(id)}/availability/refresh`,{body:{}})),
  };
}

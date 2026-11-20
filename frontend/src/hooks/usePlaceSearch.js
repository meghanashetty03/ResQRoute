import { useEffect, useRef, useState } from 'react';
import { routingRequest } from '../services/api.js';

export function usePlaceSearch(query,{enabled=true,debounceMs=350}={}){
  const sequence=useRef(0);
  const [state,setState]=useState({status:'idle',results:[],error:null,provider:null,query:''});
  useEffect(()=>{
    const requestId=++sequence.current;const term=String(query||'').trim();
    if(!enabled||term.length<3){setState({status:'idle',results:[],error:null,provider:null,query:term});return;}
    const controller=new AbortController();
    setState({status:'waiting',results:[],error:null,provider:null,query:term});
    const timer=setTimeout(async()=>{
      if(sequence.current!==requestId||controller.signal.aborted)return;
      setState({status:'loading',results:[],error:null,provider:null,query:term});
      const params=new URLSearchParams({q:term});
      try{
        const data=await routingRequest(`/geocode/search?${params}`,{signal:controller.signal});
        if(sequence.current!==requestId)return;
        setState({status:data.results.length?'success':'empty',results:data.results,error:null,provider:data.provider,query:term});
      }catch(error){if(!controller.signal.aborted&&sequence.current===requestId)setState({status:'error',results:[],error:error.message,provider:null,query:term});}
    },debounceMs);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,enabled,debounceMs]);
  const current=String(query||'').trim();
  return state.query===current?state:{status:enabled&&current.length>=3?'waiting':'idle',results:[],error:null,provider:null,query:current};
}

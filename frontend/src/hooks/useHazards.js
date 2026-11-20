import { useCallback, useEffect, useRef, useState } from 'react';
import { routingRequest } from '../services/api.js';

export function useHazards() {
  const [state, setState] = useState({ reports: [], segments: [], revision: null, status: 'loading', error: null });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const request = useRef(null);
  const inFlight = useRef(false);
  const mutationBusy = useRef(false);
  const refresh = useCallback(async ({silent=false}={}) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    inFlight.current=true;
    if(!silent)setState((previous) => ({ ...previous, status: 'loading', error: null }));
    try {
      const data = await routingRequest('/hazards', { signal: controller.signal });
      if (!controller.signal.aborted) setState((previous) => previous.revision!==null && data.revision<previous.revision
        ? {...previous,status:'success',error:null}
        : { reports: data.hazards, segments: data.segments, revision: data.revision, status: 'success', error: null });
    } catch (error) { if (!controller.signal.aborted) setState((previous) => ({ ...previous, status: 'error', error: error.message })); }
    finally {if(request.current===controller)inFlight.current=false;}
  }, []);
  useEffect(() => { refresh(); return () => request.current?.abort(); }, [refresh]);
  useEffect(()=>{const timer=setInterval(()=>{if(!inFlight.current&&!mutationBusy.current)refresh({silent:true});},2000);return()=>clearInterval(timer);},[refresh]);
  async function mutate(method, id, body) {
    setBusy(true); setNotice(''); setActionError('');
    mutationBusy.current=true;
    request.current?.abort(); // A late list response must not overwrite a confirmed mutation.
    setState((previous)=>({...previous,status:previous.revision===null?'error':'success'}));
    try {
      const data = await routingRequest(`/hazards${id ? `/${encodeURIComponent(id)}` : ''}`, { method, body });
      setState((previous) => ({ ...previous, status: 'success', error: null, revision: data.revision,
        reports: method === 'DELETE' ? previous.reports.filter((report) => report.id !== id)
          : [data.hazard, ...previous.reports.filter((report) => report.id !== data.hazard.id)] }));
      setNotice(method === 'POST' ? 'Hazard report saved. Awaiting verification.' : method === 'DELETE' ? 'Hazard report deleted.' : 'Hazard report updated.');
      if(data.reroutingErrors?.length)setActionError('Hazard saved, but some route evaluations could not synchronize. Automatic retry is pending.');
      return data.hazard || true;
    } catch (error) { setActionError(error.message); return null; }
    finally { setBusy(false);mutationBusy.current=false; }
  }
  return { ...state, busy, notice, actionError, refresh,
    create: (body) => mutate('POST', null, body), update: (id, body) => mutate('PATCH', id, body), remove: (id) => mutate('DELETE', id) };
}

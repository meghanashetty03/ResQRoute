const KEY='resqroute.workspace.v1';
export const emptyDraft=()=>({type:'',priority:'',start_lat:'',start_lng:'',start_name:'',start_source:'',pickup_lat:'',pickup_lng:'',pickup_name:'',pickup_source:'',hospital_lat:'',hospital_lng:'',hospital_name:'',hospital_source:'',hospital_id:''});
export function readSession(storage) {
  try {
    if(storage===undefined)storage=globalThis.sessionStorage;
    const value=JSON.parse(storage?.getItem(KEY)||'null');
    if(![1,2].includes(value?.version))return {draft:emptyDraft(),mode:'live',calculationId:null,tripCalculationIds:null};
    const draft=emptyDraft();
    for(const key of Object.keys(draft)){const limit=key.endsWith('_name')?400:100;if(typeof value.draft?.[key]==='string'&&value.draft[key].length<=limit)draft[key]=value.draft[key];}
    const validId=(id)=>typeof id==='string'&&/^[0-9a-f-]{36}$/i.test(id);
    const tripCalculationIds=Array.isArray(value.tripCalculationIds)&&value.tripCalculationIds.length===2&&value.tripCalculationIds.every(validId)?value.tripCalculationIds:null;
    return {draft,mode:value.mode==='demo'?'demo':'live',calculationId:validId(value.calculationId)?value.calculationId:null,tripCalculationIds};
  }catch{return {draft:emptyDraft(),mode:'live',calculationId:null,tripCalculationIds:null};}
}
export function writeSession({draft,mode,calculationId,tripCalculationIds=null},storage) {
  try{if(storage===undefined)storage=globalThis.sessionStorage;storage?.setItem(KEY,JSON.stringify({version:2,draft,mode,calculationId,tripCalculationIds}));}catch{/* Storage may be disabled; the current workspace still works. */}
}

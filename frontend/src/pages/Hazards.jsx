import { useEffect, useState } from 'react';
import { hazardLabel, isHazardActive } from '../../../shared/hazards.js';
import { HazardForm } from '../components/HazardForm.jsx';
import { HazardMap } from '../components/HazardMap.jsx';
import { useNow } from '../hooks/useNow.js';

const fresh = () => ({ type:'road_damage', latitude:'', longitude:'', severity:'Medium', description:'', verification_status:'Reported',
  is_active:true, affected_segment_id:null, expires_at:null, is_complete_closure:false, segment_confirmed:false, incident_id:null, scenario_mode:'live', expirationLocal:'' });
function localTime(iso) { if (!iso) return ''; const date=new Date(iso); return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }

export function Hazards({ hazards, routing }) {
  const [value, setValue] = useState(fresh);
  const [editing, setEditing] = useState(null);
  const [focus, setFocus] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [scope, setScope] = useState('all');
  const [formError, setFormError] = useState('');
  const now = useNow();
  useEffect(() => { hazards.refresh(); }, [hazards.refresh]);
  function reset() { setValue(fresh()); setEditing(null); setFormError(''); }
  function edit(report) { setValue({...report,latitude:String(report.latitude),longitude:String(report.longitude),expirationLocal:localTime(report.expires_at)}); setEditing(report.id); setFocus({lat:report.latitude,lng:report.longitude}); setFormError(''); document.getElementById('hazard-id')?.scrollIntoView({block:'center'}); }
  async function submit(event) {
    event.preventDefault(); setFormError('');
    const {expirationLocal, id, reported_at, updated_at, ...input} = value;
    input.latitude=Number(input.latitude); input.longitude=Number(input.longitude);
    if (expirationLocal) {
      const date = new Date(expirationLocal);
      if (!Number.isFinite(date.getTime())) { setFormError('Choose a valid expiration time.'); return; }
      input.expires_at=date.toISOString();
    } else input.expires_at=null;
    if (editing && expirationLocal === localTime(value.expires_at)) delete input.expires_at;
    const result=editing ? await hazards.update(editing,input) : await hazards.create(input);
    if(result) reset();
  }
  function pick(point) { setValue({...value,latitude:point.lat.toFixed(6),longitude:point.lng.toFixed(6),affected_segment_id:null,segment_confirmed:false}); }
  function placeSegment(segment) {
    const [a,b]=segment.geometry.coordinates;
    const lat=(a[1]+b[1])/2, lng=(a[0]+b[0])/2;
    setValue({...value,latitude:String(lat),longitude:String(lng),affected_segment_id:segment.id,segment_confirmed:false});
    setFocus({lat,lng});
  }
  const visible=hazards.reports.filter((report)=>scope==='all'||report.scenario_mode===scope);
  const point=value.latitude!=='' && value.longitude!=='' && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude)) && Math.abs(Number(value.latitude))<=90 && Math.abs(Number(value.longitude))<=180 ? {lat:Number(value.latitude),lng:Number(value.longitude)} : null;
  const segment=hazards.segments.find((item)=>item.id===value.affected_segment_id);
  return <div className="hazards-workspace">
    <div className="module-actions"><p>Route recommendations update when hazard reports change.</p><button className="secondary-button" disabled={hazards.busy||hazards.status==='loading'} onClick={hazards.refresh}>Refresh reports</button></div>
    {hazards.status==='loading' && <p className="routing-message" role="status">Loading stored hazards and road segments…</p>}
    {(hazards.error||hazards.actionError||formError) && <p className="routing-error" role="alert">{formError||hazards.actionError||hazards.error}</p>}
    {hazards.notice && <p className="save-notice" role="status">{hazards.notice}</p>}
    <div className="hazard-editor-grid"><HazardForm value={value} setValue={setValue} editing={editing} segments={hazards.segments} busy={hazards.busy||hazards.status!=='success'} onSubmit={submit} onCancel={reset} onSegment={placeSegment} /><div><HazardMap point={point} onPick={pick} focus={focus} reports={visible} onEdit={edit} segment={segment} routes={routing.mode===value.scenario_mode?routing.routes:[]} /><p className="routing-message">Map letters: damage, construction, blockage, flooding, traffic, narrow road and accident. Live and demo reports are kept separate.</p></div></div>
    <section className="panel hazard-table-panel"><div className="panel-heading"><h2>Stored hazard reports</h2><label className="table-filter">Scope<select aria-label="Filter reports by scope" value={scope} onChange={(event)=>setScope(event.target.value)}><option value="all">All reports</option><option value="live">Live routing reports</option><option value="demo">Demo only</option></select></label></div>
      {visible.length===0 ? <p className="routing-message">{hazards.status==='success'?'No reports in this scope. Choose a map location and save a hazard.':'Hazards have not loaded.'}</p> : <div className="table-scroll"><table className="hazard-table"><thead><tr><th>Report / type</th><th>Severity / status</th><th>Location / segment</th><th>Activity / time</th><th>Actions</th></tr></thead><tbody>{visible.map((report)=><tr key={report.id} className={!isHazardActive(report,now)?'muted-report':''}><td><strong>{hazardLabel(report.type)}</strong><small>{report.id}</small><span className="subtle-tag">{report.scenario_mode==='demo'?'DEMO':'LIVE REPORT'}</span><p>{report.description}</p>{report.incident_id&&<small>Incident: {report.incident_id}</small>}</td><td><span className={`severity-badge ${report.severity.toLowerCase()}`}>{report.severity}</span><p><span className={`verification-badge ${report.verification_status.toLowerCase()}`}>{report.verification_status}</span></p>{report.is_complete_closure&&<small>Complete closure {report.segment_confirmed?'· road confirmed':'· road unconfirmed'}</small>}</td><td>{report.latitude.toFixed(6)}, {report.longitude.toFixed(6)}<small>{report.affected_segment_id||'Proximity only'}</small></td><td>{isHazardActive(report,now)?'Active':report.is_active?'Expired':'Inactive'}<small>Reported {new Date(report.reported_at).toLocaleString()}</small>{report.expires_at&&<small>Expires {new Date(report.expires_at).toLocaleString()}</small>}</td><td><div className="table-actions"><button onClick={()=>edit(report)} disabled={hazards.busy}>Edit / locate</button><button onClick={()=>hazards.update(report.id,{verification_status:'Verified'})} disabled={hazards.busy||report.verification_status==='Verified'}>Verify</button><button onClick={()=>hazards.update(report.id,{verification_status:'Rejected'})} disabled={hazards.busy||report.verification_status==='Rejected'}>Reject</button><button onClick={()=>hazards.update(report.id,{is_active:!report.is_active})} disabled={hazards.busy}>{report.is_active?'Deactivate':'Activate'}</button><button className="danger-action" onClick={()=>setDeleting(report.id)} disabled={hazards.busy}>Delete</button></div>{deleting===report.id&&<div className="delete-confirm">Delete this stored report permanently?<button disabled={hazards.busy} onClick={async()=>{if(await hazards.remove(report.id)){setDeleting(null);if(editing===report.id)reset();}}}>Confirm delete</button><button onClick={()=>setDeleting(null)} disabled={hazards.busy}>Cancel</button></div>}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}

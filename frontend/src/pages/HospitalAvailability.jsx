import { useState } from 'react';
import { Building2, PhoneCall } from 'lucide-react';

const capabilityLabels={emergency:'Emergency department',trauma:'Trauma',cardiac:'Cardiac care',pediatric:'Pediatric emergency',icu:'ICU',surgery:'Surgery',burn:'Burn care'};
const statusLabels={accepting:'Accepting ambulances',limited:'Limited',diverting:'Diverting / not accepting',unknown:'Unknown / stale'};
const emptyHospital={name:'',latitude:'',longitude:'',address:'',phone:'',email:'',capabilities:[]};
function HospitalFields({value,onChange,prefix='hospital'}){
  const set=(key,next)=>onChange({...value,[key]:next});
  return <>
    <label className="field-label">Hospital name<input required maxLength="140" value={value.name} onChange={(event)=>set('name',event.target.value)} /></label>
    <label className="field-label">Address<input required maxLength="300" value={value.address} onChange={(event)=>set('address',event.target.value)} /></label>
    <div className="hospital-form-grid"><label className="field-label">Latitude<input required type="number" step="any" min="-90" max="90" value={value.latitude} onChange={(event)=>set('latitude',event.target.value)} /></label><label className="field-label">Longitude<input required type="number" step="any" min="-180" max="180" value={value.longitude} onChange={(event)=>set('longitude',event.target.value)} /></label></div>
    <div className="hospital-form-grid"><label className="field-label">Phone<input type="tel" maxLength="40" value={value.phone} onChange={(event)=>set('phone',event.target.value)} /></label><label className="field-label">Email<input type="email" maxLength="254" value={value.email} onChange={(event)=>set('email',event.target.value)} /></label></div>
    <fieldset className="hospital-capabilities"><legend>Emergency-service capabilities (directory information)</legend>{Object.entries(capabilityLabels).map(([id,label])=><label key={`${prefix}-${id}`}><input type="checkbox" checked={value.capabilities.includes(id)} onChange={(event)=>set('capabilities',event.target.checked?[...value.capabilities,id]:value.capabilities.filter((item)=>item!==id))}/>{label}</label>)}</fieldset>
  </>;
}
function AvailabilityForm({hospital,hospitals,onNotice}){
  const [status,setStatus]=useState('accepting');const [updatedBy,setUpdatedBy]=useState('');const [updaterRole,setUpdaterRole]=useState('hospital_staff');const [notes,setNotes]=useState('');
  return <form className="hospital-update-form" onSubmit={async(event)=>{event.preventDefault();try{await hospitals.updateAvailability(hospital.id,{status,updatedBy,updaterRole,notes});setNotes('');onNotice(`${hospital.name} status update saved.`);}catch(error){onNotice(error.message,true);}}}>
    <h4>Record a status update</h4><p>The updater’s name and role are self-reported.</p>
    <label className="field-label">Emergency acceptance status<select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="accepting">Accepting ambulances</option><option value="limited">Limited</option><option value="diverting">Diverting / not accepting</option></select></label>
    <div className="hospital-form-grid"><label className="field-label">Updated by<input required maxLength="100" value={updatedBy} onChange={(event)=>setUpdatedBy(event.target.value)} placeholder="Staff member name" /></label><label className="field-label">Role<select value={updaterRole} onChange={(event)=>setUpdaterRole(event.target.value)}><option value="hospital_staff">Hospital staff</option><option value="dispatcher">Dispatcher</option><option value="administrator">Administrator</option></select></label></div>
    <label className="field-label">Notes (optional)<textarea maxLength="500" value={notes} onChange={(event)=>setNotes(event.target.value)} rows="2" placeholder="Operational note; do not include patient details" /></label>
    <button className="secondary-button" disabled={hospitals.busy||!hospital.isActive}>{hospitals.busy?'Saving…':'Save status update'}</button>
  </form>;
}
function DirectoryCard({hospital,hospitals,onNotice}){
  const [editing,setEditing]=useState(false);const [value,setValue]=useState(()=>({...hospital,latitude:String(hospital.latitude),longitude:String(hospital.longitude)}));
  async function save(event){event.preventDefault();try{await hospitals.update(hospital.id,{name:value.name,latitude:Number(value.latitude),longitude:Number(value.longitude),address:value.address,phone:value.phone,email:value.email,capabilities:value.capabilities});setEditing(false);onNotice(`${value.name} directory record updated.`);}catch(error){onNotice(error.message,true);}}
  const availability=hospital.availability;
  return <article className={`panel hospital-card ${!hospital.isActive?'inactive':''}`}>
    <header className="hospital-card-heading"><div><span className="eyebrow">{hospital.isActive?'ACTIVE DIRECTORY ENTRY':'INACTIVE DIRECTORY ENTRY'}</span><h3>{hospital.name}</h3><p>{hospital.address}</p></div><span className={`hospital-status-badge ${availability.status}`}>{statusLabels[availability.status]}</span></header>
    <div className="hospital-contact-row"><span>{hospital.phone?<a href={`tel:${hospital.phone}`}><PhoneCall size={14}/>{hospital.phone}</a>:<span>No phone recorded</span>}</span>{hospital.email&&<span>{hospital.email}</span>}</div>
    <p className="hospital-capability-list">{hospital.capabilities.length?hospital.capabilities.map((capability)=>capabilityLabels[capability]||capability).join(' · '):'No emergency capabilities recorded'}</p>
    <section className={`hospital-current-status ${availability.status}`}><strong>{statusLabels[availability.status]}</strong><p>{availability.sourceLabel}{availability.lastUpdatedAt?` · ${new Date(availability.lastUpdatedAt).toLocaleString()}`:' · no status update recorded'}</p>{availability.lastKnownStatus&&<p>Last reported: {statusLabels[availability.lastKnownStatus]}; update is stale.</p>}{availability.updatedBy&&<p>Recorded by {availability.updatedBy} ({availability.updaterRole.replaceAll('_',' ')}). {availability.notes}</p>}
      {(availability.status==='unknown'||availability.status==='diverting'||availability.status==='limited')&&<p className="hospital-contact-warning">Contact this hospital to confirm ambulance acceptance. Do not rely on unknown, stale or limited information.</p>}
    </section>
    <div className="hospital-card-actions"><button className="text-button" onClick={()=>setEditing(!editing)} disabled={!hospital.isActive}>{editing?'Cancel edit':'Edit directory record'}</button>{hospital.isActive&&<button className="text-button danger-action" disabled={hospitals.busy} onClick={async()=>{if(!window.confirm(`Deactivate ${hospital.name}? Its availability history will be retained.`))return;try{await hospitals.deactivate(hospital.id);onNotice(`${hospital.name} deactivated.`);}catch(error){onNotice(error.message,true);}}}>Deactivate</button>}<button className="text-button" disabled={!hospitals.feedConfigured||!hospital.isActive||hospitals.busy} title={!hospitals.feedConfigured?'No authorized hospital feed is configured.':''} onClick={async()=>{try{await hospitals.refreshFeed(hospital.id);onNotice('Authorized feed status refreshed.');}catch(error){onNotice(error.message,true);}}}>Refresh authorized feed</button></div>
    {editing&&<form className="hospital-edit-form" onSubmit={save}><HospitalFields value={value} onChange={setValue} prefix={hospital.id}/><button className="secondary-button" disabled={hospitals.busy}>{hospitals.busy?'Saving…':'Save directory changes'}</button></form>}
    {hospital.isActive&&<AvailabilityForm hospital={hospital} hospitals={hospitals} onNotice={onNotice}/>}
    <details className="hospital-history"><summary>Availability audit history ({availability.history.length}{availability.history.length===20?' latest':''})</summary>{availability.history.length?<ol>{availability.history.map((event)=><li key={event.id}><strong>{statusLabels[event.status]}</strong> · {event.sourceLabel} · {new Date(event.updatedAt).toLocaleString()} · {event.updatedBy} ({event.updaterRole.replaceAll('_',' ')}){event.notes&&<p>{event.notes}</p>}</li>)}</ol>:<p>No status updates have been recorded.</p>}</details>
  </article>;
}

export function HospitalAvailability({hospitals}){
  const [value,setValue]=useState(emptyHospital);const [notice,setNotice]=useState(null);const [formError,setFormError]=useState('');
  return <div className="hospitals-workspace">
    <section className="panel hospital-source-note"><Building2 size={18}/><div><strong>Availability updates</strong><p>Status comes from staff or an authorized hospital feed. It becomes Unknown after {hospitals.staleAfterMinutes} minutes without an update. Contact the hospital to confirm.</p></div></section>
    {notice&&<p className={notice.error?'routing-error':'save-notice'} role={notice.error?'alert':'status'}>{notice.text}<button className="text-button" onClick={()=>setNotice(null)}>Dismiss</button></p>}
    {hospitals.error&&<p className="routing-error" role="alert">Hospital directory request failed. Retry when the local API is available. {hospitals.error}<button className="text-button" onClick={()=>hospitals.refresh().catch(()=>{})}>Retry</button></p>}
    <details className="panel hospital-create-panel"><summary>Add a hospital to the local directory</summary><form onSubmit={async(event)=>{event.preventDefault();setFormError('');try{await hospitals.create({...value,latitude:Number(value.latitude),longitude:Number(value.longitude)});setValue(emptyHospital);setNotice({text:'Hospital added. Its availability remains Unknown until a real update is recorded.'});}catch(error){setFormError(error.message);}}}>
      <HospitalFields value={value} onChange={setValue} prefix="new"/>{formError&&<p className="routing-error" role="alert">{formError}</p>}<button className="primary-button" disabled={hospitals.busy}>{hospitals.busy?'Saving…':'Add hospital'}</button><p className="hospital-form-note">Adding a hospital does not confirm ambulance acceptance.</p>
    </form></details>
    {hospitals.status==='loading'&&!hospitals.hospitals.length&&<p className="routing-message" role="status">Loading local hospital directory…</p>}
    {hospitals.status==='success'&&!hospitals.hospitals.length&&<section className="panel hospital-empty"><Building2 size={24}/><h3>No hospitals in the directory</h3><p>Add a facility to record its location, contact details and ambulance-acceptance updates.</p></section>}
    <div className="hospital-directory-list">{hospitals.hospitals.map((hospital)=><DirectoryCard key={hospital.id} hospital={hospital} hospitals={hospitals} onNotice={(text,error=false)=>setNotice({text,error})}/>)}</div>
  </div>;
}

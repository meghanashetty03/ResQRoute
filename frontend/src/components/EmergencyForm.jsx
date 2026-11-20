import { useMemo, useState } from 'react';
import { ArrowRight, CircleHelp, ClipboardPlus, MapPin, Search } from 'lucide-react';
import { usePlaceSearch } from '../hooks/usePlaceSearch.js';
import { pointFromDraft } from '../utils/coordinates.js';

const statusLabel={accepting:'Accepting ambulances',limited:'Limited',diverting:'Diverting / not accepting',unknown:'Unknown / stale'};

function LocationSearch({prefix,label,draft,routing,hospitals,disabled}){
  const [focused,setFocused]=useState(false);const [activeIndex,setActiveIndex]=useState(0);
  const query=draft[`${prefix}_name`]||'';const selected=Boolean(draft[`${prefix}_source`]);
  const search=usePlaceSearch(query,{enabled:focused&&!selected&&!disabled});
  const localMatches=useMemo(()=>prefix==='hospital'&&query.trim().length>=2?hospitals.hospitals.filter((hospital)=>hospital.isActive&&`${hospital.name} ${hospital.address}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).slice(0,4).map((hospital)=>({id:hospital.id,name:hospital.name,address:hospital.address,lat:hospital.latitude,lng:hospital.longitude,category:`Hospital directory · ${statusLabel[hospital.availability.status]}`,source:'Hospital directory',hospitalId:hospital.id})):[],[prefix,query,hospitals.hospitals]);
  const providerOptions=search.results.map((place)=>({...place,category:`${place.category} · OpenStreetMap`}));
  const suggestions=[...localMatches,...providerOptions];const listOpen=focused&&!disabled&&!selected&&query.trim().length>0;
  function choose(place){routing.selectPlace(prefix,place);setFocused(false);setActiveIndex(0);}
  function setQuery(value){routing.updatePlaceQuery(prefix,value);setActiveIndex(0);}
  function keyDown(event){
    if(event.key==='Escape'){setFocused(false);return;}
    if(!listOpen||!suggestions.length)return;
    if(event.key==='ArrowDown'){event.preventDefault();setActiveIndex((index)=>Math.min(index+1,suggestions.length-1));}
    if(event.key==='ArrowUp'){event.preventDefault();setActiveIndex((index)=>Math.max(index-1,0));}
    if(event.key==='Enter'&&suggestions[activeIndex]){event.preventDefault();choose(suggestions[activeIndex]);}
  }
  return <fieldset className="coordinate-fieldset location-search-fieldset">
    <legend><MapPin size={13}/>{label}</legend>
    <label className="field-label" htmlFor={`${prefix}-place-search`}>Search a place or address</label>
    <div className="place-search-wrap">
      <Search size={15} aria-hidden="true"/>
      <input id={`${prefix}-place-search`} className="place-search-input" type="search" autoComplete="off" disabled={disabled} value={query} placeholder={`Type ${prefix==='hospital'?'a hospital or destination':'a place or street address'}…`} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)} onKeyDown={keyDown} onChange={(event)=>setQuery(event.target.value)} role="combobox" aria-autocomplete="list" aria-expanded={listOpen&&suggestions.length>0} aria-controls={`${prefix}-place-suggestions`} aria-activedescendant={listOpen&&suggestions[activeIndex]?`${prefix}-place-option-${activeIndex}`:undefined}/>
      {listOpen&&<div className="place-suggestions" id={`${prefix}-place-suggestions`} role="listbox" aria-label={`${label} search results`}>
        {localMatches.map((place,index)=><button id={`${prefix}-place-option-${index}`} type="button" role="option" aria-selected={activeIndex===index} key={`directory-${place.id}`} onMouseDown={(event)=>event.preventDefault()} onClick={()=>choose(place)}><strong>{place.name}</strong><span>{place.address}</span><small>{place.category}</small></button>)}
        {providerOptions.map((place,index)=>{const optionIndex=localMatches.length+index;return <button id={`${prefix}-place-option-${optionIndex}`} type="button" role="option" aria-selected={activeIndex===optionIndex} key={place.id} onMouseDown={(event)=>event.preventDefault()} onClick={()=>choose(place)}><strong>{place.name}</strong><span>{place.address||'Address details unavailable'}</span><small>{place.areaScope==='target'?`Dakshina Kannada / Udupi · ${place.district}`:place.areaScope==='outside'?`Outside focus · ${place.areaLabel}`:'District unconfirmed'}</small></button>;})}
        {search.status==='waiting'&&<p role="status">Searching shortly…</p>}{search.status==='loading'&&<p role="status">Searching places…</p>}
        {search.status==='empty'&&!localMatches.length&&<p role="status">No matching places found. Search focuses on Dakshina Kannada and Udupi. Try another spelling, choose a map point or enter coordinates.</p>}
        {query.trim().length<3&&!localMatches.length&&<p role="status">Type at least 3 characters to search. You can also choose a point on the map.</p>}
        {search.status==='error'&&<p className="place-search-error" role="alert">{search.error} Search focuses on Dakshina Kannada and Udupi. Use the map or coordinates instead.</p>}
        <small className="place-search-attribution">Search focus: Dakshina Kannada + Udupi · OpenStreetMap data</small>
      </div>}
    </div>
    <div className="coordinate-inputs">
      {[['Lat','lat',-90,90],['Lng','lng',-180,180]].map(([text,key,min,max])=><label key={key}><span>{text}</span><input type="number" disabled={disabled} step="any" min={min} max={max} required value={draft[`${prefix}_${key}`]} onChange={(event)=>routing.changeDraft({...draft,[`${prefix}_${key}`]:event.target.value,[`${prefix}_name`]:'Manual coordinates',[`${prefix}_source`]:'manual',...(prefix==='hospital'?{hospital_id:''}:{})})} aria-label={`${label} ${key==='lat'?'latitude':'longitude'}`} placeholder={key==='lat'?'−90 to 90':'−180 to 180'}/></label>)}
    </div>
    {draft[`${prefix}_source`]&&<p className="selected-place-source">Selected from {draft[`${prefix}_source`]}{draft[`${prefix}_source`]==='map'?' · change with map or coordinates':''}</p>}
  </fieldset>;
}

export function EmergencyForm({draft,routing,hospitals}){
  const selectedHospital=hospitals.hospitals.find((hospital)=>hospital.id===draft.hospital_id);
  const hasHospitalPoint=Boolean(pointFromDraft(draft,'hospital'));
  return <section className="panel request-panel" aria-labelledby="request-heading">
    <div className="panel-heading"><span className="section-icon"><ClipboardPlus size={18}/></span><h2 id="request-heading">Emergency request</h2><span className="subtle-tag">Draft</span></div>
    <p className="panel-description">Enter ambulance, patient and hospital locations.</p>
    <form onSubmit={(event)=>{event.preventDefault();routing.calculate();}}>
      <div className="form-row">
        <div><label className="field-label" htmlFor="emergency-type">Emergency type</label><select id="emergency-type" value={draft.type} onChange={(event)=>routing.changeDraft({...draft,type:event.target.value})}><option value="">Select type</option><option>Road accident</option><option>Medical emergency</option><option>Cardiac emergency</option><option>Other emergency</option></select></div>
        <div><label className="field-label" htmlFor="priority">Priority</label><select id="priority" value={draft.priority} onChange={(event)=>routing.changeDraft({...draft,priority:event.target.value})}><option value="">Select priority</option><option>Low</option><option>Medium</option><option>High</option></select></div>
      </div>
      <LocationSearch prefix="start" label="Ambulance starting location" draft={draft} routing={routing} hospitals={hospitals} disabled={routing.mode==='demo'}/>
      <LocationSearch prefix="pickup" label="Patient pickup location" draft={draft} routing={routing} hospitals={hospitals} disabled={routing.mode==='demo'}/>
      <fieldset className="hospital-destination-fieldset"><legend>Patient → hospital destination</legend>
        <LocationSearch prefix="hospital" label="Hospital or destination location" draft={draft} routing={routing} hospitals={hospitals} disabled={routing.mode==='demo'}/>
        {draft.hospital_id&&!selectedHospital&&<p className="hospital-status-warning" role="alert">This directory hospital is unavailable. Search for another place or select a map point.</p>}
        {selectedHospital&&<div className={`hospital-status-summary ${selectedHospital.availability.status}`}><strong>{statusLabel[selectedHospital.availability.status]}</strong><p>{selectedHospital.availability.sourceLabel}{selectedHospital.availability.lastUpdatedAt?` · ${new Date(selectedHospital.availability.lastUpdatedAt).toLocaleString()}`:' · no update recorded'}</p>{selectedHospital.availability.lastKnownStatus&&<p>Last reported: {statusLabel[selectedHospital.availability.lastKnownStatus]} (now stale).</p>}{(selectedHospital.availability.status==='unknown'||selectedHospital.availability.status==='diverting'||selectedHospital.availability.status==='limited')&&<p className="hospital-status-warning">Contact the hospital to confirm current ambulance acceptance before relying on this status.</p>}<p>{selectedHospital.phone||selectedHospital.email||'No contact details recorded'}{selectedHospital.phone&&selectedHospital.email?` · ${selectedHospital.email}`:''}</p></div>}
        {!draft.hospital_id&&hasHospitalPoint&&<div className="hospital-status-summary unknown"><strong>Unknown / no status recorded</strong><p>Contact the hospital to confirm ambulance acceptance.</p></div>}
      </fieldset>
      <div className="form-scope-note" id="form-scope-note"><CircleHelp size={15}/><p>Select a search result, choose a map point or enter coordinates.</p></div>
      {hospitals.error&&<p className="hospital-inline-note" role="status">Hospital status could not be refreshed. Confirm with the hospital before dispatch. {hospitals.error}</p>}
      <button type="submit" className="primary-button" disabled={routing.status==='loading'||routing.mode==='demo'} aria-describedby="form-scope-note">{routing.status==='loading'?'Planning both legs…':routing.mode==='demo'?'Switch to live routing to plan both legs':'Plan full trip'}<ArrowRight size={16}/></button>
    </form>
  </section>;
}

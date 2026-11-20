import { RoutingError } from '../utils/routingValidation.js';
import { config } from '../config.js';

const CACHE_TTL_MS=10*60*1000;
const MAX_CACHE_ENTRIES=300;
const MAX_RESULTS=6;
const PROVIDER_RESULT_LIMIT=18;
// A fixed Photon focus keeps every location field centered on the two target districts.
const REGIONAL_FOCUS=Object.freeze({lat:13.1,lng:74.9,zoom:8,biasScale:0.05});
function clean(value){return typeof value==='string'?value.trim():'';}
function normalized(value){return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
const TARGET_DISTRICTS=new Set(['dakshina kannada','dakshin kannada','south canara','udupi']);
function placeLabel(properties){
  const name=clean(properties.name)||clean(properties.street)||clean(properties.city)||clean(properties.county);
  const parts=[name,clean(properties.housenumber)&&clean(properties.street)?`${clean(properties.housenumber)} ${clean(properties.street)}`:clean(properties.street),clean(properties.district),clean(properties.city),clean(properties.county),clean(properties.state),clean(properties.postcode),clean(properties.country)];
  return {name:name||'Unnamed place',address:[...new Set(parts.filter(Boolean))].filter((part)=>part!==(name||'Unnamed place')).join(', ')};
}
function areaDetails(properties){
  const candidates=[properties.state_district,properties.county,properties.district].map(clean).filter(Boolean);
  const matched=candidates.find((value)=>TARGET_DISTRICTS.has(normalized(value)));
  if(matched)return {areaScope:'target',district:matched,areaLabel:matched};
  const state=clean(properties.state),country=clean(properties.country),explicit=candidates[0]||'';
  const outside=Boolean(explicit)||(Boolean(state)&&normalized(state)!=='karnataka')||(Boolean(country)&&normalized(country)!=='india');
  if(outside)return {areaScope:'outside',district:explicit||null,areaLabel:explicit||[state,country].filter(Boolean).join(', ')||'Outside target area'};
  return {areaScope:'unconfirmed',district:null,areaLabel:'District not confirmed by place data'};
}
function normalizeFeature(feature){
  const coordinates=feature?.geometry?.coordinates;
  const lng=coordinates?.[0],lat=coordinates?.[1];
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return null;
  const properties=feature.properties||{};const label=placeLabel(properties);
  return {id:`${properties.osm_type||'place'}-${properties.osm_id||`${lat.toFixed(6)}-${lng.toFixed(6)}`}`,
    name:label.name,address:label.address,lat,lng,category:[clean(properties.osm_key),clean(properties.osm_value)].filter(Boolean).join(' · ')||'Place',
    ...areaDetails(properties),source:'OpenStreetMap'};
}
export function createGeocodingService({fetchImpl=fetch,baseUrl=config.geocoderBaseUrl,clock=Date.now,cacheTtlMs=CACHE_TTL_MS}={}){
  const cache=new Map();
  return {async search({query}){
    const normalized=clean(query).replace(/\s+/g,' ');
    if(normalized.length<3)throw new RoutingError('Enter at least 3 characters to search for a place.');
    if(normalized.length>120)throw new RoutingError('Place search must be 120 characters or fewer.');
    const key=normalized.toLocaleLowerCase();
    const cached=cache.get(key);
    if(cached&&cached.expiresAt>clock())return {provider:'Photon · OpenStreetMap',results:structuredClone(cached.results),cached:true};
    let url;
    try { url=new URL('/api/',baseUrl); if(!['https:','http:'].includes(url.protocol)||!url.hostname)throw new Error('invalid URL'); }
    catch { throw new RoutingError('Place search is not configured correctly. Use the map or enter coordinates manually.',503); }
    url.searchParams.set('q',normalized);url.searchParams.set('limit',String(PROVIDER_RESULT_LIMIT));url.searchParams.set('lang','en');
    url.searchParams.set('lat',String(REGIONAL_FOCUS.lat));url.searchParams.set('lon',String(REGIONAL_FOCUS.lng));url.searchParams.set('zoom',String(REGIONAL_FOCUS.zoom));url.searchParams.set('location_bias_scale',String(REGIONAL_FOCUS.biasScale));
    let payload;
    try{
      const response=await fetchImpl(url,{signal:AbortSignal.timeout(7000),headers:{'User-Agent':'ResQRoute-Local-Prototype/0.1 (place search)'}});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      payload=await response.json();
    }catch{throw new RoutingError('Place search is temporarily unavailable. Use the map or enter coordinates manually.',502);}
    if(!Array.isArray(payload?.features))throw new RoutingError('The place search provider returned an invalid response. Use the map or enter coordinates manually.',502);
    const results=[];const seen=new Set();
    for(const feature of payload.features){const place=normalizeFeature(feature);if(!place||seen.has(place.id))continue;seen.add(place.id);results.push(place);}
    const rank={target:0,unconfirmed:1,outside:2};results.sort((a,b)=>rank[a.areaScope]-rank[b.areaScope]);results.splice(MAX_RESULTS);
    cache.set(key,{results:structuredClone(results),expiresAt:clock()+cacheTtlMs});
    if(cache.size>MAX_CACHE_ENTRIES){const oldest=cache.keys().next().value;if(oldest)cache.delete(oldest);}
    return {provider:'Photon · OpenStreetMap',results,cached:false};
  }};
}

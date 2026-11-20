import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { openDatabase } from '../database/index.js';
import { createGeocodingService } from '../services/geocodingService.js';

const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
const feature=(name,coordinates=[74.856,12.873],extra={})=>({type:'Feature',geometry:{type:'Point',coordinates},properties:{name,street:'Market Road',city:'Mangaluru',country:'India',osm_type:'N',osm_id:42,osm_key:'place',osm_value:'locality',...extra}});
async function api(t,{fetchImpl=async()=>response({features:[feature('City Hospital')] }),geocodingService}={}){
  const database=openDatabase(':memory:');const server=createApp(database,{fetchImpl,geocodingService,logger:{error(){}}}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{await new Promise((resolve)=>server.close(resolve));database.close();});
  return `http://127.0.0.1:${server.address().port}/api`;
}

test('geocoder returns provider coordinates and applies the fixed two-district Photon focus',async()=>{
  let requestUrl;const service=createGeocodingService({baseUrl:'https://photon.example/',fetchImpl:async(url,options)=>{requestUrl=url;assert.ok(options.signal);assert.match(options.headers['User-Agent'],/ResQRoute/);return response({features:[feature('City Hospital')]});}});
  const result=await service.search({query:'City Hospital'});
  assert.equal(requestUrl.pathname,'/api/');assert.equal(requestUrl.searchParams.get('q'),'City Hospital');assert.equal(requestUrl.searchParams.get('limit'),'18');assert.equal(requestUrl.searchParams.get('lat'),'13.1');assert.equal(requestUrl.searchParams.get('lon'),'74.9');assert.equal(requestUrl.searchParams.get('zoom'),'8');assert.equal(requestUrl.searchParams.get('location_bias_scale'),'0.05');
  assert.equal(result.results[0].name,'City Hospital');assert.match(result.results[0].address,/Market Road.*Mangaluru/);assert.equal(result.results[0].lat,12.873);assert.equal(result.results[0].lng,74.856);assert.equal(result.results[0].source,'OpenStreetMap');
});

test('local district results rank first and other or unconfirmed districts are clearly classified',async()=>{
  const result=createGeocodingService({fetchImpl:async()=>response({features:[
    feature('Outside first',[76.1,13.0],{osm_id:43,county:'Hassan',state_district:'Hassan',state:'Karnataka',countrycode:'IN'}),
    feature('Udupi town',[74.75,13.34],{osm_id:44,county:'Udupi',state_district:'Udupi',state:'Karnataka',countrycode:'IN'}),
    feature('Dakshina Kannada road',[74.9,12.9],{osm_id:45,county:'Dakshina Kannada',state_district:'Dakshina Kannada',state:'Karnataka',countrycode:'IN'}),
    feature('Missing admin data',[74.8,13.1],{osm_id:46,state:'Karnataka',countrycode:'IN'}),
  ]})}).search({query:'Main Road'});
  const places=(await result).results;
  assert.deepEqual(places.map((place)=>place.name),['Udupi town','Dakshina Kannada road','Missing admin data','Outside first']);
  assert.equal(places[0].areaScope,'target');assert.equal(places[0].district,'Udupi');
  assert.equal(places[2].areaScope,'unconfirmed');assert.equal(places[3].areaScope,'outside');assert.equal(places[3].areaLabel,'Hassan');
});

test('geocoder caches results, drops malformed coordinates, and returns honest empty results',async()=>{
  let calls=0;const service=createGeocodingService({baseUrl:'https://photon.example',clock:()=>100,fetchImpl:async()=>{calls++;return response({features:[feature('Valid'),feature('Invalid',[181,90])]});}});
  const first=await service.search({query:'Mangaluru'});const again=await service.search({query:'Mangaluru'});
  assert.equal(calls,1);assert.equal(first.results.length,1);assert.equal(again.cached,true);
  const empty=createGeocodingService({fetchImpl:async()=>response({features:[]})});assert.deepEqual((await empty.search({query:'Nowhere Place'})).results,[]);
});

test('geocoder validates query and filters coordinates outside latitude and longitude ranges',async()=>{
  let calls=0;const service=createGeocodingService({fetchImpl:async()=>{calls++;throw new Error('should not call');}});
  for(const input of [{query:'ab'},{query:'a'.repeat(121)}])await assert.rejects(service.search(input),/at least 3|120 characters/);
  assert.equal(calls,0);
  const filtered=createGeocodingService({fetchImpl:async()=>response({features:[feature('Valid',[74.8,13.2]),feature('Bad latitude',[74.8,91]),feature('Bad longitude',[181,13.2]),feature('Bad type',['74.8',13.2])]})});
  const results=await filtered.search({query:'Valid locations'});assert.equal(results.results.length,1);assert.deepEqual([results.results[0].lat,results.results[0].lng],[13.2,74.8]);
});

test('provider and configuration failures are surfaced as errors, not empty success',async()=>{
  const offline=createGeocodingService({fetchImpl:async()=>{throw new Error('offline');}});
  await assert.rejects(offline.search({query:'Mangaluru'}),/temporarily unavailable/);
  const malformed=createGeocodingService({fetchImpl:async()=>response({unexpected:[]})});
  await assert.rejects(malformed.search({query:'Mangaluru'}),/invalid response/);
  const badConfig=createGeocodingService({baseUrl:'%%%'});await assert.rejects(badConfig.search({query:'Mangaluru'}),/not configured correctly/);
});

test('geocode API returns suggestions and validates no-result and provider-error cases',async(t)=>{
  const base=await api(t,{fetchImpl:async()=>response({features:[]})});
  const empty=await fetch(`${base}/geocode/search?q=Unknown+Place`);assert.equal(empty.status,200);assert.deepEqual((await empty.json()).results,[]);
  const invalid=await fetch(`${base}/geocode/search?q=ab`);assert.equal(invalid.status,400);assert.match((await invalid.json()).error,/3 characters/);
  const failedBase=await api(t,{fetchImpl:async()=>{throw new Error('provider down');}});
  const failed=await fetch(`${failedBase}/geocode/search?q=Unknown+Place`);assert.equal(failed.status,502);assert.match((await failed.json()).error,/temporarily unavailable/);
  const successBase=await api(t,{fetchImpl:async()=>response({features:[feature('Selected Clinic',[74.86,12.88])]})});
  const success=await fetch(`${successBase}/geocode/search?q=Selected+Clinic`);const data=await success.json();assert.equal(success.status,200);assert.equal(data.results[0].lat,12.88);assert.equal(data.results[0].lng,74.86);
});

test('selected local search coordinates remain valid inputs for both trip legs',async(t)=>{
  const seen=[];const localLocations={Ambulance:feature('Ambulance',[74.856,12.873],{county:'Dakshina Kannada',state:'Karnataka',countrycode:'IN'}),Patient:feature('Patient',[74.742,13.281],{osm_id:50,county:'Udupi',state:'Karnataka',countrycode:'IN'}),Hospital:feature('Hospital',[74.746,13.338],{osm_id:51,county:'Udupi',state:'Karnataka',countrycode:'IN'})};
  const routesBase=await api(t,{fetchImpl:async(url)=>{
    if(url.hostname==='photon.komoot.io')return response({features:[localLocations[url.searchParams.get('q')]||feature('Unknown')]});
    const endpoint=url.pathname.split('/').at(-1);const points=endpoint.split(';').map((pair)=>pair.split(',').map(Number));seen.push(points);
    return response({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[points[0],points[1]]},distance:2500,duration:300}]});
  }});
  async function selected(name){const response_=await fetch(`${routesBase}/geocode/search?q=${name}`);assert.equal(response_.status,200);const place=(await response_.json()).results[0];assert.equal(place.areaScope,'target');return {lat:place.lat,lng:place.lng};}
  const start=await selected('Ambulance'),patient=await selected('Patient'),hospital=await selected('Hospital');
  const result=await fetch(`${routesBase}/routes/trip/calculate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'live',start,patient,hospital})});
  assert.equal(result.status,200);const data=await result.json();assert.equal(data.legs.ambulanceToPatient.start.lat,start.lat);assert.equal(data.legs.ambulanceToPatient.destination.lng,patient.lng);assert.equal(data.legs.patientToHospital.start.lat,patient.lat);assert.equal(data.legs.patientToHospital.destination.lng,hospital.lng);
  assert.deepEqual(seen,[[[start.lng,start.lat],[patient.lng,patient.lat]],[[patient.lng,patient.lat],[hospital.lng,hospital.lat]]]);
});

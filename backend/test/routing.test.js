import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { openDatabase } from '../database/index.js';
import { getDemoScenario, calculateRoutes } from '../services/routingService.js';
import { validGeometry } from '../utils/routingValidation.js';
import { pointFromDraft } from '../../frontend/src/utils/coordinates.js';

const demo = getDemoScenario();
const body = { start: demo.start, destination: demo.destination, mode: 'live' };
const providerRoute = (index = 0) => ({ geometry: demo.routes[index].geometry, distance: 3500 + index * 1000, duration: 360 + index * 60 });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
async function fixture(t, fetchImpl) {
  const database = openDatabase(':memory:');
  const server = createApp(database, { fetchImpl, logger: { error() {} } }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); database.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (data) => fetch(`${url}/api/routes/calculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const postTrip = (data) => fetch(`${url}/api/routes/trip/calculate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { url, post, postTrip };
}

test('trip API routes both legs independently and hazards on one leg do not score the other', async (t) => {
  const demo=getDemoScenario();
  const trip={mode:'live',start:{lat:12.8709,lng:74.8429},patient:{lat:12.8621,lng:74.8685},hospital:{lat:12.879,lng:74.858}};
  let calls=0;
  const {url,postTrip}=await fixture(t,async(url)=>{
    calls++;
    const [from,to]=url.pathname.split('/').at(-1).split(';').map((pair)=>pair.split(',').map(Number));
    const mid=[(from[0]+to[0])/2,(from[1]+to[1])/2];
    const detour=[mid[0]+0.002,mid[1]+0.003];
    return response({code:'Ok',routes:[{geometry:{type:'LineString',coordinates:[from,mid,to]},distance:3200,duration:420},{geometry:{type:'LineString',coordinates:[from,detour,to]},distance:3800,duration:1000}]});
  });
  const responseTrip=await postTrip(trip);assert.equal(responseTrip.status,200);const result=await responseTrip.json();
  assert.equal(calls,2);assert.equal(result.isTrip,true);assert.ok(result.tripId);
  assert.equal(result.legs.ambulanceToPatient.start.lat,trip.start.lat);
  assert.equal(result.legs.ambulanceToPatient.destination.lat,trip.patient.lat);
  assert.equal(result.legs.patientToHospital.start.lat,trip.patient.lat);
  assert.equal(result.legs.patientToHospital.destination.lat,trip.hospital.lat);
  assert.equal(result.legs.ambulanceToPatient.routes.length,2);assert.equal(result.legs.patientToHospital.routes.length,2);
  const hazardList=await (await fetch(`${url}/api/hazards`)).json();
  const firstGeometry=result.legs.ambulanceToPatient.routes[0].geometry.coordinates;
  const [lng,lat]=[(firstGeometry[0][0]+firstGeometry[1][0])/2,(firstGeometry[0][1]+firstGeometry[1][1])/2];
  const affectedSegment=hazardList.segments.find((segment)=>segment.mode==='live'&&segment.label==='Route A · road edge 1'&&segment.geometry.coordinates.some((point)=>point[0]===firstGeometry[0][0]&&point[1]===firstGeometry[0][1]));
  assert.ok(affectedSegment);
  const hazardResponse=await fetch(`${url}/api/hazards`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'road_blockage',latitude:lat,longitude:lng,severity:'High',description:'Leg one only closure integration test',is_complete_closure:true,segment_confirmed:true,affected_segment_id:affectedSegment.id})});
  assert.equal(hazardResponse.status,201);const created=(await hazardResponse.json()).hazard;
  const first=await (await fetch(`${url}/api/routes/${result.legs.ambulanceToPatient.calculationId}/state`)).json();
  const second=await (await fetch(`${url}/api/routes/${result.legs.patientToHospital.calculationId}/state`)).json();
  assert.ok(first.routes[0].riskScore>0);assert.equal(first.routes[0].isEligible,true);assert.equal(second.routes[0].riskScore,0);
  await fetch(`${url}/api/hazards/${created.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({verification_status:'Verified'})});
  const closed=await (await fetch(`${url}/api/routes/${result.legs.ambulanceToPatient.calculationId}/state`)).json();
  const unaffected=await (await fetch(`${url}/api/routes/${result.legs.patientToHospital.calculationId}/state`)).json();
  assert.equal(closed.routes[0].isEligible,false);assert.equal(closed.recommendedRouteId,closed.routes[1].id);
  assert.equal(closed.notifications.at(-1).newRouteId,closed.routes[1].id);assert.match(closed.notifications.at(-1).message,/verified complete road closure/i);
  assert.equal(unaffected.routes[0].isEligible,true);assert.equal(unaffected.routes[0].riskScore,0);
  assert.ok(demo.routes.length>1);
});

test('trip endpoint rejects missing/invalid locations and never returns a partial success', async (t) => {
  let calls=0;const {postTrip}=await fixture(t,async()=>{calls++;return response({code:'Ok',routes:[providerRoute()]});});
  for(const body of [null,{}, {mode:'demo',start:{lat:12,lng:74},patient:{lat:12.1,lng:74.1},hospital:{lat:12.2,lng:74.2}}, {mode:'live',start:{lat:12,lng:74},patient:{lat:12,lng:74},hospital:{lat:12.2,lng:74.2}}, {mode:'live',start:{lat:12,lng:74},patient:{lat:12.1,lng:74.1},hospital:{lat:91,lng:74}}]){
    const response_=await postTrip(body);assert.equal(response_.status,400);assert.equal(typeof (await response_.json()).error,'string');
  }
  assert.equal(calls,0);
  let providerCalls=0;const failureFixture=await fixture(t,async()=>{providerCalls++;return providerCalls===1?response({code:'Ok',routes:[providerRoute()]}):response({code:'NoRoute'},200);});
  const partial=await failureFixture.postTrip({mode:'live',start:{lat:12.8709,lng:74.8429},patient:{lat:12.8621,lng:74.8685},hospital:{lat:12.879,lng:74.858}});
  assert.equal(partial.status,422);assert.equal((await partial.json()).isTrip,undefined);assert.equal(providerCalls,2);
});

test('routing API requests genuine OSRM alternatives and converts metres/seconds', async (t) => {
  let calls = 0;
  const { post } = await fixture(t, async (url, options) => {
    calls++;
    assert.equal(url.hostname, 'router.project-osrm.org');
    assert.ok(url.pathname.endsWith(`${body.start.lng},${body.start.lat};${body.destination.lng},${body.destination.lat}`));
    assert.equal(url.searchParams.get('alternatives'), 'true');
    assert.equal(url.searchParams.get('geometries'), 'geojson');
    assert.equal(url.searchParams.get('radiuses'), '200;200');
    assert.ok(options.signal);
    return response({ code: 'Ok', routes: [providerRoute(), providerRoute(1)] });
  });
  const result = await post(body);
  assert.equal(result.status, 200);
  const data = await result.json();
  assert.equal(calls, 1);
  assert.equal(data.mode, 'live');
  assert.equal(data.routes.length, 2);
  assert.equal(data.routes[0].distanceKm, 3.5);
  assert.equal(data.routes[0].durationMinutes, 6);
  assert.deepEqual(data.routes[0].geometry, demo.routes[0].geometry);
  assert.equal(data.routes[0].riskScore, 0);
  assert.equal(data.routes[0].isEligible, true);
  assert.ok(data.calculationId);
});

test('single route remains single, and duplicated geometries are not invented alternatives', async () => {
  const result = await calculateRoutes(body, { fetchImpl: async () => response({ code: 'Ok', routes: [providerRoute(), providerRoute()] }) });
  assert.equal(result.routes.length, 1);
  assert.match(result.notice, /only one route/);
});

test('invalid, missing, out-of-range, same-point coordinates and modes fail before provider access', async (t) => {
  const { post } = await fixture(t, async () => { throw new Error('Provider should not be called'); });
  for (const input of [null, {}, { ...body, start: null }, { ...body, start: {lat: 91, lng: 74} }, { ...body, start: {lat: 12, lng: 181} }, { ...body, start: {lat: '12', lng: 74} }, { ...body, destination: body.start }, { ...body, mode: 'unknown' }]) {
    const result = await post(input);
    assert.equal(result.status, 400);
    assert.equal(typeof (await result.json()).error, 'string');
  }
});

test('provider errors, malformed geometry, empty responses, and network failures are meaningful', async (t) => {
  for (const [fetchImpl, expected] of [
    [async () => response({code:'NoRoute'}, 200), 422],
    [async () => response({code:'NoSegment'}, 400), 422],
    [async () => response({code:'Error'}, 503), 502],
    [async () => response({code:'Ok',routes:[]}), 502],
    [async () => response(null), 502],
    [async () => response({code:'Ok',routes:[{...providerRoute(), geometry:{type:'LineString',coordinates:[[200,91],[74,12]]}}]}), 502],
    [async () => { throw new Error('offline'); }, 502],
    [async () => { throw new DOMException('timeout', 'TimeoutError'); }, 502],
  ]) {
    const { post } = await fixture(t, fetchImpl);
    const result = await post(body);
    assert.equal(result.status, expected);
    assert.match((await result.json()).error, /demo/i);
  }
});

test('local demo works offline, supports only its own endpoints, and is deterministic', async (t) => {
  const { url, post } = await fixture(t, async () => { throw new Error('offline'); });
  const scenario = await (await fetch(`${url}/api/routes/demo`)).json();
  assert.equal(scenario.id, demo.id);
  const first = await (await post({...body, mode:'demo'})).json();
  const second = await (await post({...body, mode:'demo'})).json();
  assert.deepEqual(first.routes, second.routes);
  assert.equal(first.recommendedRouteId, second.recommendedRouteId);
  assert.equal(first.routes.length, 3);
  assert.equal(first.mode, 'demo');
  const mismatch = await post({...body, mode:'demo', start:{lat:13,lng:75}});
  assert.equal(mismatch.status, 400);
});

test('demo geometries are distinct, locally consistent and share endpoints near selected markers', () => {
  const signatures = new Set();
  for (const route of demo.routes) {
    assert.ok(validGeometry(route.geometry));
    assert.ok(route.distanceKm > 0 && route.durationMinutes > 0);
    const coordinates = route.geometry.coordinates;
    signatures.add(JSON.stringify(coordinates));
    for (const [lng,lat] of coordinates) { assert.ok(lng > 74.8 && lng < 74.9 && lat > 12.84 && lat < 12.91); }
    for (const [point, selected] of [[coordinates[0], demo.start], [coordinates.at(-1), demo.destination]]) {
      const metres = Math.hypot((point[0] - selected.lng) * 108000, (point[1] - selected.lat) * 111320);
      assert.ok(metres < 200);
    }
  }
  assert.equal(signatures.size, 3);
});

test('JSON POST preflight is allowed from the localhost frontend', async (t) => {
  const { url } = await fixture(t);
  const result = await fetch(`${url}/api/routes/calculate`, { method:'OPTIONS', headers:{Origin:'http://localhost:5173','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'} });
  assert.equal(result.status, 204);
  assert.match(result.headers.get('access-control-allow-methods'), /POST/);
});

test('frontend coordinate parsing rejects blanks and invalid numbers while accepting zero', () => {
  assert.equal(pointFromDraft({start_lat:'',start_lng:'74'},'start'), null);
  assert.equal(pointFromDraft({start_lat:'Infinity',start_lng:'74'},'start'), null);
  assert.equal(pointFromDraft({start_lat:'91',start_lng:'74'},'start'), null);
  assert.deepEqual(pointFromDraft({start_lat:'0',start_lng:'0'},'start'), {lat:0,lng:0});
});

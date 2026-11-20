import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hazardTypes } from '../../shared/hazards.js';
import { pointToSegmentMetres, distanceMetres } from '../../shared/geo.js';
import { hazardContribution, scoreRoute, riskCategory } from '../services/riskEngine.js';
import { evaluateCandidates } from '../services/recommendationService.js';
import { getDemoScenario } from '../services/routingService.js';
import { demoSegments } from '../data/segments.js';
import { riskConfig } from '../config/riskConfig.js';

const now=Date.parse('2026-11-13T12:00:00Z');
const route={id:'r1',name:'Route 1',geometry:{type:'LineString',coordinates:[[74.85,12.87],[74.86,12.87]]},distanceKm:1.08,durationMinutes:10};
const base={id:'h1',type:'road_damage',latitude:12.87,longitude:74.855,severity:'Medium',verification_status:'Reported',is_active:true,reported_at:'2026-11-13T11:00:00Z',scenario_mode:'live',affected_segment_id:null};
const score=(reports,extra={})=>scoreRoute(route,reports,{mode:'live',now,...extra});

test('all hazard base penalties, severities and confidence multipliers are applied',()=>{
  for(const type of hazardTypes) for(const [severity,multiplier] of Object.entries(riskConfig.severity)) for(const [verification_status,confidence] of Object.entries(riskConfig.confidence)) {
    assert.equal(hazardContribution({...base,type:type.value,severity,verification_status}),type.penalty*multiplier*confidence);
  }
  assert.equal(score([base]).riskScore,12);
  assert.equal(score([{...base,verification_status:'Verified'}]).riskScore,20);
});
test('inactive, expired, rejected, far-away and other-mode hazards contribute zero',()=>{
  for(const hazard of [{...base,is_active:false},{...base,expires_at:'2026-11-13T12:00:00Z'},{...base,verification_status:'Rejected'},{...base,latitude:13.5},{...base,scenario_mode:'demo'}]) assert.equal(score([hazard]).riskScore,0);
});
test('great-circle distance measures route interiors in metres, clamps ends and handles degenerate edges',()=>{
  const d=pointToSegmentMetres([74.855,12.87018],...route.geometry.coordinates);
  assert.ok(d>19&&d<21);
  assert.ok(pointToSegmentMetres([74.855,12.87036],...route.geometry.coordinates)>39);
  assert.equal(score([{...base,latitude:12.87018}]).riskScore,12);
  assert.equal(score([{...base,latitude:12.87036}]).riskScore,0);
  assert.ok(pointToSegmentMetres([74.87,12.87],...route.geometry.coordinates)>1000);
  assert.equal(pointToSegmentMetres([74.85,12.87],[74.85,12.87],[74.85,12.87]),0);
  assert.ok(distanceMetres([179.999,0],[-179.999,0])<223);
});
test('duplicate reports use the maximum contribution, not a sum; distinct incidents remain distinct',()=>{
  const duplicate={...base,id:'h2',verification_status:'Verified',longitude:74.85501};
  const result=score([base,duplicate]);
  assert.equal(result.rawRisk,20); assert.equal(result.relevantHazardCount,1); assert.equal(result.duplicatesIgnored,1);
  const mixed=score([{...base,incident_id:'event1'},{...duplicate,incident_id:'event1',type:'flooding'}]);
  assert.equal(mixed.rawRisk,45);
  assert.deepEqual(mixed.hazardTypes,['Potholes / Road Damage','Waterlogging / Flooding']);
  assert.equal(score([{...base,incident_id:'event1'},{...duplicate,incident_id:'event2'}]).rawRisk,32);
  assert.equal(score([base,{...duplicate,reported_at:'2026-11-13T09:00:00Z'}]).rawRisk,32);
});
test('risk normalization is capped consistently and categories cover fractional boundaries',()=>{
  const hazards=[0,1,2].map((index)=>({...base,id:`f${index}`,type:'flooding',severity:'High',verification_status:'Verified',incident_id:`distinct-${index}`}));
  assert.equal(score(hazards).rawRisk,202.5); assert.equal(score(hazards).riskScore,100);
  assert.equal(riskCategory(20),'Low reported risk'); assert.equal(riskCategory(20.01),'Moderate reported risk');
  assert.equal(riskCategory(50.01),'High reported risk'); assert.equal(riskCategory(75.01),'Very high reported risk');
});
test('only an active verified confirmed complete closure on the actual assigned road excludes',()=>{
  const segment={id:'edge',mode:'live',geometry:route.geometry};
  const closure={...base,verification_status:'Verified',is_complete_closure:true,segment_confirmed:true,affected_segment_id:'edge'};
  assert.equal(score([closure],{segments:[segment]}).isEligible,false);
  for(const partial of [{verification_status:'Reported'},{is_complete_closure:false},{segment_confirmed:false},{is_active:false},{affected_segment_id:null},{expires_at:'2026-11-12T00:00:00Z'}]) assert.equal(score([{...closure,...partial}],{segments:[segment]}).isEligible,true);
  const parallel={...segment,geometry:{type:'LineString',coordinates:[[74.85,12.8701],[74.86,12.8701]]}};
  assert.equal(score([closure],{segments:[parallel]}).riskScore,0);
  // A weaker verified closure must not disappear when deduplication chooses a larger penalty.
  assert.equal(score([{...closure,incident_id:'same'},{...base,id:'flood',type:'flooding',severity:'High',verification_status:'Verified',incident_id:'same'}],{segments:[segment]}).isEligible,false);
});
test('cost converts points to minutes, coefficient is adjustable and traffic is not double-counted',()=>{
  const result=score([{...base,verification_status:'Verified'}]);
  assert.equal(result.riskTimePenaltyMinutes,3); assert.equal(result.finalCost,13);
  assert.equal(score([base],{config:{...riskConfig,riskMinutesPerPoint:.5}}).finalCost,16);
  assert.equal(scoreRoute({...route,trafficDelayMinutes:5,etaIncludesTraffic:true},[],{mode:'live',now}).finalCost,10);
  assert.equal(scoreRoute({...route,trafficDelayMinutes:5,etaIncludesTraffic:false},[],{mode:'live',now}).finalCost,15);
});
test('recommendation ranks eligible routes and changes explanations using real route/hazard data',()=>{
  const demo=getDemoScenario();
  const segment=demoSegments.find((item)=>item.id==='demo-a-road');
  const [longitude,latitude]=segment.geometry.coordinates[0];
  const hazard={...base,longitude,latitude,scenario_mode:'demo',affected_segment_id:segment.id,verification_status:'Verified',type:'flooding',severity:'High'};
  const initial=evaluateCandidates({...demo,mode:'demo'},[],demoSegments,{now});
  const affected=evaluateCandidates({...demo,mode:'demo'},[hazard],demoSegments,{now});
  assert.equal(initial.recommendedRouteId,'demo-a'); assert.equal(affected.recommendedRouteId,'demo-b');
  assert.equal(affected.routes.find((item)=>item.id==='demo-a').riskScore,67.5);
  assert.equal(affected.routes.find((item)=>item.id==='demo-b').riskScore,0);
  assert.match(affected.recommendationExplanation,/Flooding/);
  const recommended=affected.routes.find((item)=>item.isRecommended);
  assert.equal(recommended.finalCost,Math.min(...affected.routes.filter((item)=>item.isEligible).map((item)=>item.finalCost)));
});
test('no eligible route returns a dispatcher warning, never an invented alternative',()=>{
  const demo=getDemoScenario(); const segment=demoSegments.find((item)=>item.id==='demo-shared-start');
  const [longitude,latitude]=segment.geometry.coordinates[0];
  const closure={...base,longitude,latitude,scenario_mode:'demo',affected_segment_id:segment.id,verification_status:'Verified',is_complete_closure:true,segment_confirmed:true};
  const result=evaluateCandidates({...demo,mode:'demo'},[closure],demoSegments,{now});
  assert.equal(result.recommendedRouteId,null); assert.equal(result.routes.length,3);
  assert.ok(result.routes.every((item)=>!item.isEligible));
  assert.match(result.recommendationExplanation,/Dispatcher review required/);
});

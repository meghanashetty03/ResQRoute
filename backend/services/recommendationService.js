import { riskConfig } from '../config/riskConfig.js';
import { scoreRoute } from './riskEngine.js';
import { isHazardActive } from '../../shared/hazards.js';

export function evaluateCandidates(candidates, hazards, segments, {now=Date.now(),config=riskConfig,revision=0}={}) {
  const routes=candidates.routes.map((route)=>scoreRoute(route,hazards,{mode:candidates.mode,scenarioId:candidates.scenarioId||null,segments,now,config}));
  const eligible=routes.filter((route)=>route.isEligible).sort((a,b)=>a.finalCost-b.finalCost||a.durationMinutes-b.durationMinutes||a.id.localeCompare(b.id));
  const best=eligible[0];
  const explanation=best ? `${best.name} is recommended with the lowest eligible time-and-risk cost of ${best.finalCost.toFixed(2)} min: ${best.durationMinutes.toFixed(2)} travel + ${best.trafficDelayMinutes.toFixed(2)} additional traffic delay + ${best.riskTimePenaltyMinutes.toFixed(2)} risk penalty. ${routes.filter((route)=>route.id!==best.id).map((route)=>!route.isEligible?`${route.name} is excluded by a verified complete closure on its confirmed road segment.`:`${route.name} costs ${route.finalCost.toFixed(2)} min with ${route.riskScore}/100 reported risk${route.hazardTypes.length?` (${route.hazardTypes.join(', ')})`:''}.`).join(' ')}`
    : 'No verified accessible alternative is currently available. Dispatcher review required.';
  const expirations=hazards.filter((hazard)=>hazard.scenario_mode===candidates.mode && (hazard.scenario_id||null)===(candidates.scenarioId||null) && hazard.verification_status!=='Rejected' && isHazardActive(hazard,now) && hazard.expires_at).map((hazard)=>Date.parse(hazard.expires_at));
  return {...candidates, routes:routes.map((route)=>({...route,isRecommended:route.id===best?.id,rank:route.isEligible?eligible.findIndex((item)=>item.id===route.id)+1:null})),
    recommendedRouteId:best?.id||null, recommendationExplanation:explanation, hazardRevision:revision,
    evaluatedAt:new Date(now).toISOString(), nextHazardExpiration:expirations.length?new Date(Math.min(...expirations)).toISOString():null,
    scoring:{proximityMetres:config.proximityMetres,riskMinutesPerPoint:config.riskMinutesPerPoint,normalization:'min(100, sum of deduplicated hazard contributions)'},
    matchingLimitation:'Proximity alone cannot identify the correct road. Only explicitly assigned, operator-confirmed road segments can cause hard closure exclusion. Low reported risk does not guarantee safety.'};
}

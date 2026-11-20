import { randomUUID } from 'node:crypto';
import { listHazards } from './hazardService.js';
import { isHazardActive } from '../../shared/hazards.js';
import { RoutingError } from '../utils/routingValidation.js';

export function recordEvaluation(database,evaluation,action,previous=null) {
  // Store compact actual scoring snapshots; do not duplicate large geographic polylines.
  const routes=evaluation.routes.map(({id,name,distanceKm,durationMinutes,riskScore,rawRisk,finalCost,isEligible,isRecommended,rank,relevantHazardCount})=>
    ({id,name,distanceKm,durationMinutes,riskScore,rawRisk,finalCost,isEligible,isRecommended,rank,relevantHazardCount}));
  database.prepare('INSERT INTO evaluation_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),evaluation.calculationId,action,evaluation.evaluatedAt,
    evaluation.mode,evaluation.scenarioId||null,evaluation.recommendedRouteId,previous?.recommendedRouteId||null,evaluation.hazardRevision,
    Number(Boolean(previous)&&previous.recommendedRouteId!==evaluation.recommendedRouteId),JSON.stringify(routes));
}

export function getAnalytics(database,{mode='all',calculationId}={},now=Date.now()) {
  if(!['all','live','demo'].includes(mode))throw new RoutingError('Analytics mode must be all, live or demo.');
  if(calculationId!==undefined&&(typeof calculationId!=='string'||!calculationId))throw new RoutingError('Provide a valid calculationId.');
  const where=mode==='all'?'':'WHERE scenario_mode = ?';
  const args=mode==='all'?[]:[mode];
  const runs=database.prepare(`SELECT COUNT(*) AS recordedEvaluations, COALESCE(SUM(json_array_length(routes_json)),0) AS totalRoutesEvaluated, COALESCE(SUM(is_reroute),0) AS reroutingEvents, MIN(evaluated_at) AS historyStartedAt FROM evaluation_runs ${where}`).get(...args);
  const reports=listHazards(database).filter((report)=>mode==='all'||report.scenario_mode===mode);
  const generatedCalculations=database.prepare('SELECT candidates_json FROM route_calculations').all()
    .filter((row)=>mode==='all'||JSON.parse(row.candidates_json).mode===mode).length;
  let current;
  if(calculationId){current=database.prepare('SELECT evaluation_json FROM route_runtime WHERE calculation_id=?').get(calculationId);if(!current)throw new RoutingError('Calculation not found for analytics.',404);}
  else current=database.prepare(`SELECT r.evaluation_json FROM route_runtime r JOIN route_calculations c ON c.id=r.calculation_id ${mode==='all'?'':"WHERE json_extract(c.candidates_json,'$.mode') = ?"} ORDER BY c.created_at DESC,c.id DESC LIMIT 1`).get(...args);
  const recentDecisions=database.prepare(`SELECT id,calculation_id,trigger_action,evaluated_at,scenario_mode,scenario_id,recommended_route_id,previous_route_id,is_reroute,routes_json FROM evaluation_runs ${where} ORDER BY evaluated_at DESC,rowid DESC LIMIT 20`).all(...args)
    .map(({routes_json,...run})=>({...run,is_reroute:Boolean(run.is_reroute),routes:JSON.parse(routes_json)}));
  return {asOf:new Date(now).toISOString(),mode,
    summary:{...runs,generatedCalculations,storedHazards:reports.length,activeHazards:reports.filter((report)=>isHazardActive(report,now)&&report.verification_status!=='Rejected').length},
    currentCalculation:current?JSON.parse(current.evaluation_json):null,currentSource:calculationId?'Selected dashboard calculation':'Latest stored calculation',recentDecisions,
    historyNote:'Evaluation history records actual scoring runs from Stage 6 onward. Earlier cached calculations are counted separately; their missing history is not reconstructed.'};
}

import { randomUUID } from 'node:crypto';
import { recalculate } from './routeEvaluationService.js';
import { hazardRevision } from './hazardService.js';
import { RoutingError } from '../utils/routingValidation.js';
import { hazardLabel } from '../../shared/hazards.js';
import { recordEvaluation } from './analyticsService.js';

const LEASE_MS=60000;
const round=(value)=>Number(value.toFixed(4));

export function recommendationChange(before, after, trigger, now) {
  if(before.recommendedRouteId===after.recommendedRouteId)return null;
  const previous=before.routes.find((route)=>route.id===before.recommendedRouteId);
  const next=after.routes.find((route)=>route.id===after.recommendedRouteId);
  const previousNow=after.routes.find((route)=>route.id===previous?.id);
  let reason;
  if(!next)reason='No verified accessible alternative is currently available. Dispatcher review required.';
  else if(previousNow && !previousNow.isEligible) {
    const closures=previousNow.matchedHazards.filter((hazard)=>hazard.confirmedClosure);
    reason=`${previousNow.name} is unavailable because of a verified complete road closure on its confirmed segment (${closures.flatMap((hazard)=>hazard.reportIds).join(', ')}). ${next.name} has the lowest eligible cost of ${next.finalCost.toFixed(2)} min.`;
  } else reason=`${next.name} now has the lowest eligible cost of ${next.finalCost.toFixed(2)} min${previousNow?`, compared with ${previousNow.finalCost.toFixed(2)} min for ${previousNow.name}`:''}. ${after.recommendationExplanation}`;
  const event={id:randomUUID(),occurredAt:new Date(now).toISOString(),trigger,
    previousRouteId:previous?.id||null,previousRouteName:previous?.name||null,
    newRouteId:next?.id||null,newRouteName:next?.name||null,reason,
    previousTravelMinutes:previous?.durationMinutes??null,newTravelMinutes:next?.durationMinutes??null,
    travelEstimateChangeMinutes:previous&&next?round(next.durationMinutes-previous.durationMinutes):null,
    previousCostMinutes:previous?.finalCost??null,newCostMinutes:next?.finalCost??null,
    riskAdjustedCostChangeMinutes:previous&&next?round(next.finalCost-previous.finalCost):null,
    providerEstimatesChanged:false,
    limitation:'Selected from existing candidates. OSRM avoidance routing is not implemented; each candidate keeps its original geometry and provider travel estimate.'};
  event.message=`Route updated: ${previous?.name||'No eligible route'} → ${next?.name||'No eligible route'}. ${reason} Trigger: ${trigger.description}.`;
  return event;
}

export function hazardTrigger(action,hazard) {
  return {action,hazardId:hazard.id,description:`${hazardLabel(hazard.type)} report ${hazard.id} ${action} (${hazard.verification_status}, ${hazard.severity})`};
}

export function createReroutingService(database,{clock=Date.now}={}) {
  function record(id) { return database.prepare('SELECT * FROM route_runtime WHERE calculation_id = ?').get(id); }
  function response(row) {
    return {...JSON.parse(row.evaluation_json),evaluationVersion:row.version,notifications:JSON.parse(row.notifications_json),synchronizationError:row.error,
      reroutingLimitation:'Automatic rerouting selects existing route candidates; no new OSRM avoidance geometry is generated.'};
  }
  function track(evaluation) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const inserted=database.prepare('INSERT OR IGNORE INTO route_runtime (calculation_id,evaluation_json,version,notifications_json,active_until) VALUES (?,?,1,?,?)')
        .run(evaluation.calculationId,JSON.stringify(evaluation),'[]',clock()+LEASE_MS);
      if(inserted.changes)recordEvaluation(database,evaluation,'calculated');
      database.exec('COMMIT');
    }catch(error){database.exec('ROLLBACK');throw error;}
    return response(record(evaluation.calculationId));
  }
  function update(id,trigger) {
    const row=record(id);
    if(!row)return track(recalculate(database,{calculationId:id},clock()));
    const before=JSON.parse(row.evaluation_json);
    const after=recalculate(database,{calculationId:id},clock());
    const event=recommendationChange(before,after,trigger,clock());
    const notifications=JSON.parse(row.notifications_json);
    if(event)notifications.push(event);
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE route_runtime SET evaluation_json=?,version=version+1,notifications_json=?,error=NULL WHERE calculation_id=?')
        .run(JSON.stringify(after),JSON.stringify(notifications.slice(-20)),id);
      recordEvaluation(database,after,trigger.action,before);
      database.exec('COMMIT');
    }catch(error){database.exec('ROLLBACK');throw error;}
    return response(record(id));
  }
  function read(id) {
    let row=record(id);
    if(!row)return track(recalculate(database,{calculationId:id},clock()));
    const previous=JSON.parse(row.evaluation_json);
    const expired=previous.nextHazardExpiration && Date.parse(previous.nextHazardExpiration)<=clock();
    if(row.error || previous.hazardRevision!==hazardRevision(database) || expired) {
      update(id,{action:expired?'expired':'synchronized',description:expired?'Active hazard expiration reached':'Hazard data changed; synchronized with SQLite'});
      row=record(id);
    }
    database.prepare('UPDATE route_runtime SET active_until=? WHERE calculation_id=?').run(clock()+LEASE_MS,id);
    return response(row);
  }
  function refreshActive(trigger) {
    const failures=[];
    for(const row of database.prepare('SELECT calculation_id FROM route_runtime WHERE active_until>=?').all(clock())) {
      try { update(row.calculation_id,trigger); }
      catch(error) {
        database.prepare('UPDATE route_runtime SET error=? WHERE calculation_id=?').run('Route synchronization failed. Automatic retry is pending.',row.calculation_id);
        failures.push({calculationId:row.calculation_id,error:error.message});
      }
    }
    return failures;
  }
  function sweepExpired() {
    if(!database.isOpen)return;
    for(const row of database.prepare('SELECT calculation_id,evaluation_json FROM route_runtime WHERE active_until>=?').all(clock())) {
      const evaluation=JSON.parse(row.evaluation_json);
      if(evaluation.nextHazardExpiration && Date.parse(evaluation.nextHazardExpiration)<=clock()) {
        try{update(row.calculation_id,{action:'expired',description:'Active hazard expiration reached'});}
        catch(error){database.prepare('UPDATE route_runtime SET error=? WHERE calculation_id=?').run('Expiration evaluation failed. Automatic retry is pending.',row.calculation_id);}
      }
    }
  }
  return {track,read,refreshActive,sweepExpired,manual(id){if(typeof id!=='string'||!id)throw new RoutingError('A calculationId is required.'); return update(id,{action:'refreshed',description:'Dispatcher requested a refresh'});}};
}

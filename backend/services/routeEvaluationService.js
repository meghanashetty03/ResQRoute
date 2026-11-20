import { randomUUID } from 'node:crypto';
import { calculateRoutes } from './routingService.js';
import { evaluateCandidates } from './recommendationService.js';
import { hazardRevision, listHazards, listSegments } from './hazardService.js';
import { liveSegments } from '../data/segments.js';
import { RoutingError } from '../utils/routingValidation.js';

function evaluate(database, candidates, id, now=Date.now()) {
  const segments=listSegments(database);
  return {...evaluateCandidates(candidates,listHazards(database),segments,{revision:hazardRevision(database),now}), calculationId:id,
    ...(candidates.scenarioId==='stage5-rerouting'?{demoBlockageId:database.prepare("SELECT id FROM hazards WHERE scenario_id = ? AND incident_id = ?").get('stage5-rerouting','stage5-blockage-b')?.id||null}:{}),
    segments:segments.filter((segment)=>segment.mode===candidates.mode)};
}
export async function calculateAndEvaluate(database, request, options) {
  const candidates=await calculateRoutes(request,options);
  candidates.scenarioId=request.scenarioId||null;
  if(candidates.scenarioId==='stage5-rerouting') candidates.demoBlockageId=database.prepare("SELECT id FROM hazards WHERE scenario_id = ? AND incident_id = ?").get('stage5-rerouting','stage5-blockage-b')?.id||null;
  if(candidates.mode==='live') {
    const insert=database.prepare('INSERT OR IGNORE INTO road_segments VALUES (?, ?, ?, ?)');
    database.exec('BEGIN IMMEDIATE');
    try { for(const segment of liveSegments(candidates.routes))insert.run(segment.id,segment.label,segment.mode,JSON.stringify(segment.geometry)); database.exec('COMMIT'); }
    catch(error){database.exec('ROLLBACK');throw error;}
  }
  const id=randomUUID();
  database.prepare('INSERT INTO route_calculations VALUES (?, ?, ?)').run(id,JSON.stringify(candidates),new Date().toISOString());
  return evaluate(database,candidates,id);
}
export function recalculate(database, body, now=Date.now()) {
  if(!body || typeof body.calculationId!=='string' || !body.calculationId || Object.keys(body).some((key)=>key!=='calculationId')) throw new RoutingError('Provide only the calculationId from a previous route response.');
  const record=database.prepare('SELECT candidates_json FROM route_calculations WHERE id = ?').get(body.calculationId);
  if(!record)throw new RoutingError('Route calculation not found. Generate routes again.',404);
  // Re-evaluate actual candidates; never move their geometry or invent a provider ETA.
  return evaluate(database,JSON.parse(record.candidates_json),body.calculationId,now);
}

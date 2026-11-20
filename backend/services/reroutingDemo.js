import { createHazard, updateHazard } from './hazardService.js';
import { demoSegments } from '../data/segments.js';
import { getDemoScenario } from './routingService.js';
import { calculateAndEvaluate } from './routeEvaluationService.js';
import { hazardRevision } from './hazardService.js';

export function clearReroutingDemo(database,rerouting) {
  const deleted=database.prepare("DELETE FROM hazards WHERE scenario_id='stage5-rerouting'").run();
  const reroutingErrors=rerouting.refreshActive({action:'demo_cleared',description:'Dispatcher explicitly cleared dedicated demo hazards'});
  return {deletedCount:deleted.changes,revision:hazardRevision(database),reroutingErrors,message:`Cleared ${deleted.changes} dedicated demo hazard report(s). Reset demo routes to restore the original scenario.`};
}

export async function resetReroutingDemo(database,rerouting) {
  database.exec('BEGIN IMMEDIATE');
  try {
    // Dedicated scope: resetting this demonstration cannot delete ordinary reports.
    database.prepare("DELETE FROM hazards WHERE scenario_id='stage5-rerouting'").run();
    for(const seed of [
      {edge:'a',type:'flooding',severity:'High',verified:true,incident:'stage5-flood-a',description:'SIMULATED: severe flooding on Route A'},
      {edge:'c',type:'road_damage',severity:'Medium',verified:false,incident:'stage5-damage-c',description:'SIMULATED: road damage on Route C'},
      {edge:'b',type:'road_blockage',severity:'Low',verified:false,incident:'stage5-blockage-b',description:'SIMULATED: complete blockage on Route B, awaiting verification'},
    ]) {
      const segment=demoSegments.find((item)=>item.id===`demo-${seed.edge}-road`);
      const [longitude,latitude]=segment.geometry.coordinates[0];
      const hazard=createHazard(database,{type:seed.type,severity:seed.severity,latitude,longitude,description:seed.description,
        scenario_mode:'demo',scenario_id:'stage5-rerouting',affected_segment_id:segment.id,segment_confirmed:true,
        is_complete_closure:seed.type==='road_blockage',incident_id:seed.incident});
      if(seed.verified)updateHazard(database,hazard.id,{verification_status:'Verified'});
    }
    database.exec('COMMIT');
  } catch(error){database.exec('ROLLBACK');throw error;}
  rerouting.refreshActive({action:'demo_reset',description:'Dedicated rerouting demo reset to its original reports'});
  const scenario=getDemoScenario();
  return rerouting.track(await calculateAndEvaluate(database,{mode:'demo',scenarioId:'stage5-rerouting',start:scenario.start,destination:scenario.destination}));
}

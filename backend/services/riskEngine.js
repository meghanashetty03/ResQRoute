import { riskConfig } from '../config/riskConfig.js';
import { hazardLabel, isHazardActive } from '../../shared/hazards.js';
import { distanceMetres, pointToRouteMetres, routeContainsSegment } from '../../shared/geo.js';

const round = (value, places = 4) => Number(value.toFixed(places));
export function riskCategory(score) {
  return score <= 20 ? 'Low reported risk' : score <= 50 ? 'Moderate reported risk' : score <= 75 ? 'High reported risk' : 'Very high reported risk';
}
export function hazardContribution(hazard, config = riskConfig) {
  return (config.basePenalties[hazard.type] || 0) * (config.severity[hazard.severity] || 0) * (config.confidence[hazard.verification_status] || 0);
}
function sameIncident(a, b, config) {
  if (a.incident_id || b.incident_id) return Boolean(a.incident_id && a.incident_id === b.incident_id);
  return a.type === b.type && (a.affected_segment_id || null) === (b.affected_segment_id || null)
    && Math.abs(Date.parse(a.reported_at) - Date.parse(b.reported_at)) <= config.duplicateWindowMinutes * 60000
    && distanceMetres([a.longitude,a.latitude],[b.longitude,b.latitude]) <= config.duplicateMetres;
}
export function deduplicateReports(reports, config = riskConfig) {
  // Union matching reports so results do not depend on list order or duplicate chains.
  const parent = reports.map((_,index)=>index);
  function root(index) { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index=parent[index]; } return index; }
  for (let i=0;i<reports.length;i++) for(let j=0;j<i;j++) if(sameIncident(reports[i],reports[j],config)) parent[root(i)]=root(j);
  const groups = new Map();
  reports.forEach((report,index)=>{const id=root(index); if(!groups.has(id))groups.set(id,[]); groups.get(id).push(report);});
  return [...groups.values()];
}

export function scoreRoute(route, reports, {mode, scenarioId=null, segments=[], now=Date.now(), config=riskConfig} = {}) {
  const segmentMap = new Map(segments.map((segment)=>[segment.id,segment]));
  const matches = reports.filter((hazard)=>{
    if ((hazard.scenario_mode || 'live') !== mode || (hazard.scenario_id || null)!==scenarioId || !isHazardActive(hazard,now) || hazard.verification_status==='Rejected') return false;
    const point=[hazard.longitude,hazard.latitude];
    if (pointToRouteMetres(point,route.geometry.coordinates)>config.proximityMetres) return false;
    if (hazard.affected_segment_id) {
      const segment=segmentMap.get(hazard.affected_segment_id);
      return Boolean(segment && segment.mode===mode && pointToRouteMetres(point,segment.geometry.coordinates)<=config.proximityMetres
        && routeContainsSegment(route.geometry.coordinates,segment.geometry.coordinates));
    }
    return true;
  });
  const groups=deduplicateReports(matches,config);
  const matchedHazards=groups.map((group)=>{
    const ordered=[...group].sort((a,b)=>hazardContribution(b,config)-hazardContribution(a,config)||a.id.localeCompare(b.id));
    const representative=ordered[0];
    return { id:representative.id, type:representative.type, label:hazardLabel(representative.type), severity:representative.severity,
      verificationStatus:representative.verification_status, contribution:round(hazardContribution(representative,config)),
      reportIds:group.map((item)=>item.id).sort(), duplicateCount:group.length-1,
      confirmedClosure:group.some((hazard)=>hazard.verification_status==='Verified' && Boolean(hazard.is_complete_closure)
        && Boolean(hazard.segment_confirmed) && Boolean(hazard.affected_segment_id) && segmentMap.has(hazard.affected_segment_id)) };
  });
  const rawRisk=round(matchedHazards.reduce((sum,hazard)=>sum+hazard.contribution,0));
  // Prototype normalization: riskScore = min(100, max(0, sum of incident contributions)).
  // Absolute across routes; never divide by the current maximum candidate's risk.
  const riskScore=round(Math.min(100,Math.max(0,rawRisk)),2);
  const isEligible=!matchedHazards.some((hazard)=>hazard.confirmedClosure);
  const trafficDelayMinutes=route.etaIncludesTraffic ? 0 : route.trafficDelayMinutes || 0;
  const riskTimePenaltyMinutes=round(riskScore*config.riskMinutesPerPoint);
  const finalCost=round(route.durationMinutes+trafficDelayMinutes+riskTimePenaltyMinutes);
  const riskExplanation=matchedHazards.length
    ? `${matchedHazards.map((hazard)=>`${hazard.label}: ${hazard.contribution} points (${hazard.severity}, ${hazard.verificationStatus})`).join('; ')}. ${matches.length-groups.length} duplicate report(s) ignored. Raw risk ${rawRisk}, capped score ${riskScore}/100.`
    : 'No relevant active, non-rejected reported hazards matched this route. A zero score does not guarantee a safe road.';
  return {...route, rawRisk, riskScore, riskCategory:riskCategory(riskScore), relevantHazardCount:groups.length,
    matchedReportCount:matches.length, duplicatesIgnored:matches.length-groups.length, matchedHazards,
    hazardTypes:[...new Set(matches.map((hazard)=>hazardLabel(hazard.type)))], riskExplanation,
    isEligible, eligibilityStatus:isEligible?'Eligible':'Unavailable – Verified Road Closure',
    trafficDelayMinutes, riskTimePenaltyMinutes, finalCost };
}

import { getJourney, saveHospitalRecommendations } from './journeyService.js';
import { listHospitals } from './hospitalService.js';
import { calculateAndEvaluate } from './routeEvaluationService.js';
import { RoutingError } from '../utils/routingValidation.js';

export async function generateHospitalRecommendations(database,id,{rerouting,fetchImpl,clock=Date.now,staleMinutes=30}={}){
  const journey=getJourney(database,id,{rerouting,now:clock(),staleMinutes});
  if(journey.status!=='patient_picked_up')throw new RoutingError('Hospital recommendations are available after patient pickup.',409);
  const hospitals=listHospitals(database,{now:clock(),staleMinutes});
  const options=[];
  for(const hospital of hospitals){
    try{
      const evaluation=await calculateAndEvaluate(database,{mode:'live',start:journey.patient,destination:{lat:hospital.latitude,lng:hospital.longitude}},{fetchImpl});
      const tracked=rerouting.track(evaluation);
      options.push({hospitalId:hospital.id,calculationId:tracked.calculationId});
    }catch(error){
      options.push({hospitalId:hospital.id,error:error.expose?error.message:'Route calculation failed. Retry recommendations.'});
    }
  }
  saveHospitalRecommendations(database,id,options,{now:clock()});
  return getJourney(database,id,{rerouting,now:clock(),staleMinutes});
}

import { Router } from 'express';
import { config } from '../config.js';
import { getHospital } from '../services/hospitalService.js';
import { calculateAndEvaluate } from '../services/routeEvaluationService.js';
import { generateHospitalRecommendations } from '../services/hospitalRecommendationService.js';
import { getJourney, journeyStatuses, recoverJourney, saveJourneyHospital, transitionJourney } from '../services/journeyService.js';
import { RoutingError } from '../utils/routingValidation.js';

export function journeyRoutes({database,rerouting,fetchImpl,clock=Date.now,staleMinutes=config.hospitalStatusStaleMinutes}){
  const router=Router();
  router.get('/:id',(request,response,next)=>{
    try{response.set('Cache-Control','no-store').json(getJourney(database,request.params.id,{rerouting,now:clock(),staleMinutes}));}
    catch(error){next(error);}
  });
  router.post('/:id/recover',(request,response,next)=>{
    try{
      if(!request.body||Object.keys(request.body).length!==1||!Array.isArray(request.body.calculationIds))throw new RoutingError('Provide only the two saved route calculation IDs.');
      recoverJourney(database,request.params.id,request.body.calculationIds,{now:clock()});
      response.status(201).json(getJourney(database,request.params.id,{rerouting,now:clock(),staleMinutes}));
    }catch(error){next(error);}
  });
  router.patch('/:id/status',(request,response,next)=>{
    try{
      if(!request.body||Object.keys(request.body).length!==1||!Object.hasOwn(request.body,'status'))throw new RoutingError('Provide only the next journey status.');
      if(!journeyStatuses.includes(request.body.status))throw new RoutingError('Choose a supported journey status.');
      const journey=transitionJourney(database,request.params.id,request.body.status,{now:clock()});
      response.json(getJourney(database,journey.id,{rerouting,now:clock(),staleMinutes}));
    }catch(error){next(error);}
  });
  router.post('/:id/hospital-recommendations',async(request,response,next)=>{
    try{
      if(request.body&&Object.keys(request.body).length)throw new RoutingError('Hospital recommendations do not accept request data.');
      const journey=await generateHospitalRecommendations(database,request.params.id,{rerouting,fetchImpl,clock,staleMinutes});
      response.json(journey);
    }catch(error){next(error);}
  });
  router.post('/:id/hospital',async(request,response,next)=>{
    try{
      if(!request.body||!['hospitalId','keepCurrent'].some((key)=>Object.hasOwn(request.body,key))||Object.keys(request.body).length!==1)throw new RoutingError('Select a directory hospital or confirm the current destination.');
      const journey=getJourney(database,request.params.id,{rerouting,now:clock(),staleMinutes});
      if(journey.status!=='patient_picked_up')throw new RoutingError('Confirm a hospital after patient pickup and before starting transport.',409);
      let hospital;
      if(request.body.keepCurrent===true){
        if(journey.hospitalId)throw new RoutingError('Choose the listed hospital to confirm its directory status.',409);
        hospital={id:null,name:journey.hospital.name,address:journey.hospital.address,latitude:journey.hospital.latitude,longitude:journey.hospital.longitude,isActive:true};
      }else{
        if(typeof request.body.hospitalId!=='string'||request.body.hospitalId.length>60)throw new RoutingError('Select one active hospital from the directory.');
        hospital=getHospital(database,request.body.hospitalId,{now:clock(),staleMinutes});
        if(!hospital.isActive)throw new RoutingError('Selected hospital is inactive. Choose an active hospital.',409);
      }
      const evaluation=await calculateAndEvaluate(database,{mode:'live',start:journey.patient,destination:{lat:hospital.latitude,lng:hospital.longitude}},{fetchImpl});
      const leg=rerouting.track(evaluation);
      saveJourneyHospital(database,request.params.id,{hospital,calculationId:leg.calculationId},{now:clock()});
      response.json({journey:getJourney(database,request.params.id,{rerouting,now:clock(),staleMinutes}),leg});
    }catch(error){next(error);}
  });
  return router;
}

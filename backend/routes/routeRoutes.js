import { Router } from 'express';
import { getDemoScenario } from '../services/routingService.js';
import { calculateAndEvaluate } from '../services/routeEvaluationService.js';
import { RoutingError, validateRouteRequest, validateTripRequest } from '../utils/routingValidation.js';
import { randomUUID } from 'node:crypto';
import { resetReroutingDemo,clearReroutingDemo } from '../services/reroutingDemo.js';
import { getHospital } from '../services/hospitalService.js';
import { createJourney } from '../services/journeyService.js';

export function routeRoutes({database,rerouting,clock=Date.now,...options}) {
  const router = Router();
  router.get('/demo', (_request, response) => response.json(getDemoScenario()));
  router.post('/calculate', async (request, response, next) => {
    try { response.json(rerouting.track(await calculateAndEvaluate(database,validateRouteRequest(request.body), options))); }
    catch (error) { next(error); }
  });
  router.post('/trip/calculate', async (request, response, next) => {
    try {
      const trip=validateTripRequest(request.body);
      const selectedHospital=trip.hospitalId?getHospital(database,trip.hospitalId):null;
      if(selectedHospital&&!selectedHospital.isActive)throw new RoutingError('Selected hospital is inactive. Choose an active hospital or enter a destination manually.',409);
      const destination=selectedHospital?{lat:selectedHospital.latitude,lng:selectedHospital.longitude}:trip.hospital;
      const first=rerouting.track(await calculateAndEvaluate(database,{mode:'live',start:trip.start,destination:trip.patient},options));
      const second=rerouting.track(await calculateAndEvaluate(database,{mode:'live',start:trip.patient,destination},options));
      const tripId=randomUUID();
      createJourney(database,{id:tripId,start:trip.start,patient:trip.patient,hospital:destination,hospitalId:trip.hospitalId,hospitalName:selectedHospital?.name||trip.hospitalName,hospitalAddress:selectedHospital?.address||trip.hospitalAddress,calculationIds:[first.calculationId,second.calculationId],now:clock()});
      response.json({isTrip:true,tripId,mode:'live',start:trip.start,patient:trip.patient,hospital:destination,hospitalId:trip.hospitalId,
        legs:{ambulanceToPatient:first,patientToHospital:second},
        notice:'Both legs use provider-returned route candidates and are independently evaluated against matching hazards. No closure-avoidance geometry is generated; alternatives are limited to those returned by OSRM.'});
    } catch (error) { next(error); }
  });
  router.post('/recalculate',(request,response)=>{
    // Retain strict request validation from the existing endpoint.
    if(!request.body || Object.keys(request.body).some((key)=>key!=='calculationId')) return response.status(400).json({error:'Provide only calculationId.'});
    response.json(rerouting.manual(request.body.calculationId));
  });
  router.get('/:id/state',(request,response)=>{response.set('Cache-Control','no-store').json(rerouting.read(request.params.id));});
  router.post('/rerouting-demo/reset',async(_request,response,next)=>{try{response.json(await resetReroutingDemo(database,rerouting));}catch(error){next(error);}});
  router.post('/demo/reset',async(_request,response,next)=>{try{response.json(await resetReroutingDemo(database,rerouting));}catch(error){next(error);}});
  router.delete('/rerouting-demo/hazards',(_request,response)=>response.json(clearReroutingDemo(database,rerouting)));
  return router;
}

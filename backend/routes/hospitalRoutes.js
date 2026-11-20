import { Router } from 'express';
import { config } from '../config.js';
import { createHospital,deactivateHospital,getHospital,listHospitals,recordStaffAvailability,refreshFromAuthorizedFeed,updateHospital } from '../services/hospitalService.js';

export function hospitalRoutes(database,{adapter=null,clock=Date.now,staleMinutes=config.hospitalStatusStaleMinutes}={}){
  const router=Router();
  const options=()=>({now:clock(),staleMinutes});
  router.use((_request,response,next)=>{response.set('Cache-Control','no-store');next();});
  router.get('/',(_request,response)=>response.json({hospitals:listHospitals(database,{...options(),includeInactive:_request.query.includeInactive==='1'}),staleAfterMinutes:staleMinutes,feedConfigured:Boolean(adapter)}));
  router.post('/',(request,response)=>response.status(201).json({hospital:createHospital(database,request.body,options())}));
  router.get('/:id',(request,response)=>response.json({hospital:getHospital(database,request.params.id,options())}));
  router.patch('/:id',(request,response)=>response.json({hospital:updateHospital(database,request.params.id,request.body,options())}));
  router.delete('/:id',(request,response)=>response.json({hospital:deactivateHospital(database,request.params.id,options()),message:'Hospital deactivated; its audit history was retained.'}));
  router.post('/:id/availability', (request,response)=>response.status(201).json({hospital:recordStaffAvailability(database,request.params.id,request.body,options())}));
  router.post('/:id/availability/refresh',async(request,response,next)=>{try{response.json({hospital:await refreshFromAuthorizedFeed(database,request.params.id,adapter,options())});}catch(error){next(error);}});
  return router;
}

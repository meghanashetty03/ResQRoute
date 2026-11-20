import { Router } from 'express';
import { RoutingError } from '../utils/routingValidation.js';

export function geocodeRoutes(geocoder){
  const router=Router();
  router.get('/search',async(request,response,next)=>{
    try{
      const keys=Object.keys(request.query);
      if(keys.some((key)=>key!=='q'))throw new RoutingError('Provide only the place query. Search focus is set to Dakshina Kannada and Udupi.');
      response.set('Cache-Control','no-store').json(await geocoder.search({query:request.query.q}));
    }catch(error){next(error);}
  });
  return router;
}

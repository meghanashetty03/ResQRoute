import { Router } from 'express';
import { getAnalytics } from '../services/analyticsService.js';
export function analyticsRoutes(database){const router=Router();router.get('/',(request,response)=>response.set('Cache-Control','no-store').json(getAnalytics(database,request.query)));return router;}

import { Router } from 'express';
import { createHazard, deleteHazard, getHazard, hazardRevision, listHazards, listSegments, updateHazard } from '../services/hazardService.js';
import { hazardTrigger } from '../services/reroutingService.js';

export function hazardRoutes(database,rerouting) {
  const router = Router();
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.get('/', (_request, response) => response.json({ hazards: listHazards(database), revision: hazardRevision(database), segments: listSegments(database) }));
  router.get('/:id', (request, response) => response.json({ hazard: getHazard(database, request.params.id), revision: hazardRevision(database) }));
  router.post('/', (request, response) => {const hazard=createHazard(database,request.body);const reroutingErrors=rerouting.refreshActive(hazardTrigger('created',hazard)); response.status(201).json({hazard,revision:hazardRevision(database),reroutingErrors});});
  router.patch('/:id', (request, response) => {
    const before=getHazard(database,request.params.id);
    const hazard=updateHazard(database,request.params.id,request.body);
    const action=before.verification_status!==hazard.verification_status?hazard.verification_status.toLowerCase()
      : before.is_active!==hazard.is_active?(hazard.is_active?'activated':'deactivated'):'edited';
    const reroutingErrors=rerouting.refreshActive(hazardTrigger(action,hazard));
    response.json({hazard,revision:hazardRevision(database),reroutingErrors});
  });
  router.delete('/:id', (request, response) => {const hazard=getHazard(database,request.params.id);deleteHazard(database, request.params.id);const reroutingErrors=rerouting.refreshActive(hazardTrigger('deleted',hazard)); response.json({ deletedId: request.params.id, revision: hazardRevision(database),reroutingErrors }); });
  return router;
}

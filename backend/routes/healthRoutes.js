import { Router } from 'express';
import { createHealthController } from '../controllers/healthController.js';

export function healthRoutes(database) {
  const router = Router();
  router.get('/health', createHealthController(database));
  return router;
}

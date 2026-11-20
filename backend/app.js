import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { routeRoutes } from './routes/routeRoutes.js';
import { hazardRoutes } from './routes/hazardRoutes.js';
import { createReroutingService } from './services/reroutingService.js';
import { analyticsRoutes } from './routes/analyticsRoutes.js';
import { hospitalRoutes } from './routes/hospitalRoutes.js';
import { geocodeRoutes } from './routes/geocodeRoutes.js';
import { createGeocodingService } from './services/geocodingService.js';
import { journeyRoutes } from './routes/journeyRoutes.js';

export function createApp(database, { logger = console, fetchImpl, clock, hospitalAvailabilityAdapter=null, geocodingService=null } = {}) {
  const app = express();
  const rerouting=createReroutingService(database,{clock:clock||Date.now});
  // Tie the local expiration worker to each HTTP server's lifecycle, including tests.
  const listen=app.listen.bind(app);
  app.listen=(...arguments_)=>{
    const server=listen(...arguments_);
    let expirationTimer;
    server.once('listening',()=>{
      expirationTimer=setInterval(()=>{try{rerouting.sweepExpired();}catch(error){logger.error('Expiration synchronization failed:',error.message);}},1000);
      expirationTimer.unref();
    });
    server.once('close',()=>clearInterval(expirationTimer));
    return server;
  };
  app.disable('x-powered-by');
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.frontendOrigins.includes(origin)) return callback(null, true);
      const error = new Error('Origin is not permitted.');
      error.status = 403;
      callback(error);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  }));
  app.use(express.json({ limit: '16kb' }));
  app.use('/api', healthRoutes(database));
  app.use('/api/routes', routeRoutes({ database, fetchImpl,rerouting,clock:clock||Date.now }));
  app.use('/api/journeys',journeyRoutes({database,rerouting,fetchImpl,clock:clock||Date.now,staleMinutes:config.hospitalStatusStaleMinutes}));
  app.use('/api/hazards', hazardRoutes(database,rerouting));
  app.use('/api/analytics', analyticsRoutes(database));
  app.use('/api/hospitals', hospitalRoutes(database,{adapter:hospitalAvailabilityAdapter,clock:clock||Date.now}));
  app.use('/api/geocode',geocodeRoutes(geocodingService||createGeocodingService({fetchImpl})));
  app.use((_request, response) => response.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, _request, response, _next) => {
    const status = error.status || 500;
    if (status >= 500) logger.error('API request failed:', error.message);
    const message = error.expose ? error.message : status === 503 ? 'Database is unavailable. Restart the local backend and retry.'
      : status >= 500 ? 'The local API encountered an unexpected error.'
        : status === 400 ? 'Invalid JSON request body.' : error.message;
    response.status(status).json({ error: message });
  });
  return app;
}

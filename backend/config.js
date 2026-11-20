import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendDirectory = fileURLToPath(new URL('.', import.meta.url));
const configuredHospitalStaleMinutes=Number(process.env.HOSPITAL_STATUS_STALE_MINUTES||30);
const hospitalStatusStaleMinutes=Number.isInteger(configuredHospitalStaleMinutes)&&configuredHospitalStaleMinutes>=1&&configuredHospitalStaleMinutes<=1440?configuredHospitalStaleMinutes:30;

export const config = Object.freeze({
  host: '127.0.0.1',
  port: 5000,
  databasePath: path.resolve(backendDirectory, process.env.DATABASE_PATH || './database/resqroute.sqlite'),
  frontendOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  hospitalStatusStaleMinutes,
  geocoderBaseUrl: process.env.GEOCODER_BASE_URL || 'https://photon.komoot.io',
});

import { hazardTypes } from '../../shared/hazards.js';
function setting(name, fallback, min, max) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}
export const riskConfig = Object.freeze({
  proximityMetres: setting('HAZARD_PROXIMITY_METRES', 30, 1, 200),
  riskMinutesPerPoint: setting('RISK_MINUTES_PER_POINT', 0.15, 0, 10),
  basePenalties: Object.fromEntries(hazardTypes.map((type) => [type.value,type.penalty])),
  severity: { Low:0.5, Medium:1, High:1.5 },
  confidence: { Reported:0.6, Verified:1, Rejected:0 },
  duplicateMetres: 10,
  duplicateWindowMinutes: 30,
});

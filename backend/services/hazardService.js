import { randomUUID } from 'node:crypto';
import { hazardTypes, severities, verificationStatuses } from '../../shared/hazards.js';
import { pointToRouteMetres } from '../../shared/geo.js';
import { RoutingError, validatePoint } from '../utils/routingValidation.js';

const fields = ['type', 'latitude', 'longitude', 'severity', 'description', 'verification_status', 'is_active', 'affected_segment_id', 'expires_at', 'is_complete_closure', 'segment_confirmed', 'incident_id', 'scenario_mode', 'scenario_id'];
const booleanFields = ['is_active', 'is_complete_closure', 'segment_confirmed'];
export function hazardRevision(database) { return database.prepare("SELECT value FROM application_state WHERE key = 'hazard_revision'").get().value; }
export function listSegments(database) {
  return database.prepare('SELECT * FROM road_segments ORDER BY mode, label, id').all().map(({ geometry_json, ...record }) => ({ ...record, geometry: JSON.parse(geometry_json) }));
}
function serialize(record) {
  if (!record) throw new RoutingError('Hazard report not found.', 404);
  return { ...record, ...Object.fromEntries(booleanFields.map((field) => [field, Boolean(record[field])])) };
}
export function getHazard(database, id) { return serialize(database.prepare('SELECT * FROM hazards WHERE id = ?').get(id)); }
export function listHazards(database) { return database.prepare('SELECT * FROM hazards ORDER BY reported_at DESC, id').all().map(serialize); }

function validate(database, input, existing) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RoutingError('Provide a hazard JSON object.');
  if (!Object.keys(input).length || Object.keys(input).some((key) => !fields.includes(key))) throw new RoutingError('Provide supported hazard fields only; ID and report time are assigned by the backend.');
  if (!existing && input.verification_status && input.verification_status !== 'Reported') throw new RoutingError('New reports must start as Reported. Verify them after saving.');
  const value = { verification_status: 'Reported', is_active: true, affected_segment_id: null, expires_at: null,
    is_complete_closure: false, segment_confirmed: false, incident_id: null, scenario_mode: 'live', scenario_id: null, ...existing, ...input };
  validatePoint({ lat: value.latitude, lng: value.longitude }, 'Hazard location');
  if (!hazardTypes.some((item) => item.value === value.type)) throw new RoutingError('Select a supported hazard type.');
  if (!severities.includes(value.severity)) throw new RoutingError('Severity must be Low, Medium or High.');
  if (!verificationStatuses.includes(value.verification_status)) throw new RoutingError('Verification status must be Reported, Verified or Rejected.');
  if (!['demo', 'live'].includes(value.scenario_mode)) throw new RoutingError('Scenario mode must be demo or live.');
  if (value.scenario_id !== null && (value.scenario_id !== 'stage5-rerouting' || value.scenario_mode !== 'demo')) throw new RoutingError('The dedicated rerouting scenario is available only in demo mode.');
  if (typeof value.description !== 'string' || !value.description.trim() || value.description.length > 1000) throw new RoutingError('Description is required (1–1000 characters).');
  value.description = value.description.trim();
  for (const field of booleanFields) if (typeof value[field] !== 'boolean') throw new RoutingError(`${field} must be true or false.`);
  if (value.incident_id !== null && (typeof value.incident_id !== 'string' || !value.incident_id.trim() || value.incident_id.length > 80)) throw new RoutingError('Incident ID must be null or a nonempty string of up to 80 characters.');
  if (value.incident_id) value.incident_id = value.incident_id.trim();
  if (value.expires_at !== null) {
    if (typeof value.expires_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.expires_at) || !Number.isFinite(Date.parse(value.expires_at))) throw new RoutingError('Expiration must be null or a valid ISO timestamp with timezone.');
    if (Object.hasOwn(input, 'expires_at') && Date.parse(value.expires_at) <= Date.now()) throw new RoutingError('A new expiration must be in the future; deactivate an old report instead.');
    value.expires_at = new Date(value.expires_at).toISOString();
  }
  if (value.affected_segment_id !== null) {
    if (typeof value.affected_segment_id !== 'string') throw new RoutingError('Affected segment must be a saved road segment or null.');
    const segment = database.prepare('SELECT * FROM road_segments WHERE id = ?').get(value.affected_segment_id);
    if (!segment || segment.mode !== value.scenario_mode) throw new RoutingError('Select a saved road segment in the same scenario mode.');
    if (pointToRouteMetres([value.longitude, value.latitude], JSON.parse(segment.geometry_json).coordinates) > 30) throw new RoutingError('Hazard must be within 30 metres of its assigned road segment.');
  }
  if (value.segment_confirmed && !value.affected_segment_id) throw new RoutingError('Same-road confirmation requires an explicit saved road segment.');
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

export function createHazard(database, input) {
  const value = validate(database, input);
  const id = `HAZ-${randomUUID()}`;
  const now = new Date().toISOString();
  const names = ['id', ...fields, 'reported_at', 'updated_at'];
  database.prepare(`INSERT INTO hazards (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
    .run(id, ...fields.map((field) => booleanFields.includes(field) ? Number(value[field]) : value[field]), now, now);
  return getHazard(database, id);
}
export function updateHazard(database, id, input) {
  const value = validate(database, input, getHazard(database, id));
  database.prepare(`UPDATE hazards SET ${fields.map((field) => `${field} = ?`).join(',')}, updated_at = ? WHERE id = ?`)
    .run(...fields.map((field) => booleanFields.includes(field) ? Number(value[field]) : value[field]), new Date().toISOString(), id);
  return getHazard(database, id);
}
export function deleteHazard(database, id) { getHazard(database, id); database.prepare('DELETE FROM hazards WHERE id = ?').run(id); }

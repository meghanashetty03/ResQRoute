export class RoutingError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.expose = true; }
}

export function validatePoint(point, name) {
  if (!point || typeof point.lat !== 'number' || typeof point.lng !== 'number'
    || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
    || Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) {
    throw new RoutingError(`${name} must contain numeric lat (-90…90) and lng (-180…180).`);
  }
}

export function validateRouteRequest(body) {
  if (!body || typeof body !== 'object') throw new RoutingError('A routing request body is required.');
  if (!['live', 'demo'].includes(body.mode)) throw new RoutingError('Mode must be live or demo.');
  validatePoint(body.start, 'Starting location');
  validatePoint(body.destination, 'Patient location');
  if (body.start.lat === body.destination.lat && body.start.lng === body.destination.lng) {
    throw new RoutingError('Starting and patient locations must be different.');
  }
  if (body.scenarioId != null && (body.mode!=='demo' || body.scenarioId!=='stage5-rerouting')) throw new RoutingError('Unsupported routing scenario.');
  return { mode: body.mode, start: body.start, destination: body.destination, scenarioId:body.scenarioId||null };
}

export function validateTripRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RoutingError('A trip planning request body is required.');
  if(Object.keys(body).some((key)=>!['mode','start','patient','hospital','hospitalId','hospitalName','hospitalAddress'].includes(key)))throw new RoutingError('Provide only mode, start, patient, hospital and optional hospital details.');
  if (body.mode !== 'live') throw new RoutingError('Full trip planning requires live routing so both legs use provider-calculated geometry.');
  validatePoint(body.start, 'Ambulance starting location');
  validatePoint(body.patient, 'Patient pickup location');
  validatePoint(body.hospital, 'Hospital destination');
  if (body.start.lat === body.patient.lat && body.start.lng === body.patient.lng) throw new RoutingError('Ambulance and patient locations must be different.');
  if (body.patient.lat === body.hospital.lat && body.patient.lng === body.hospital.lng) throw new RoutingError('Patient and hospital locations must be different.');
  if(body.hospitalId!=null&&(typeof body.hospitalId!=='string'||body.hospitalId.length>60))throw new RoutingError('Hospital selection is invalid. Select a hospital from the directory again.');
  for(const [key,label,max] of [['hospitalName','Hospital name',200],['hospitalAddress','Hospital address',300]])if(body[key]!=null&&(typeof body[key]!=='string'||body[key].length>max))throw new RoutingError(`${label} must be text of at most ${max} characters.`);
  return {mode:'live',start:body.start,patient:body.patient,hospital:body.hospital,hospitalId:body.hospitalId||null,hospitalName:body.hospitalName?.trim()||'',hospitalAddress:body.hospitalAddress?.trim()||''};
}

export function validGeometry(geometry) {
  return geometry?.type === 'LineString' && Array.isArray(geometry.coordinates)
    && geometry.coordinates.length >= 2 && geometry.coordinates.every((point) =>
      Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])
      && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
}

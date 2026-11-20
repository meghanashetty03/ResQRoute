import { readFileSync } from 'node:fs';
import { RoutingError, validGeometry } from '../utils/routingValidation.js';

const scenario = JSON.parse(readFileSync(new URL('../data/demoScenario.json', import.meta.url), 'utf8'));
export function getDemoScenario() { return structuredClone(scenario); }

export async function calculateRoutes({ mode, start, destination }, { fetchImpl = fetch } = {}) {
  if (mode === 'demo') {
    for (const [actual, expected] of [[start, scenario.start], [destination, scenario.destination]]) {
      if (Math.abs(actual.lat - expected.lat) > 0.000001 || Math.abs(actual.lng - expected.lng) > 0.000001) {
        throw new RoutingError('Demo routes only support the fixed Mangalore scenario endpoints. Load the demo or switch to live routing.');
      }
    }
    return { mode, provider: 'Local OSRM snapshot', start, destination, routes: getDemoScenario().routes,
      notice: 'Predefined demonstration routes, captured from OSRM with different via points. Estimates are stored sample data, not live traffic.',
      capturedAt: scenario.capturedAt };
  }
  // OSRM requires longitude before latitude. Never append invented alternatives.
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${destination.lng},${destination.lat}`);
  url.search = new URLSearchParams({ alternatives: 'true', overview: 'full', geometries: 'geojson', steps: 'false', radiuses: '200;200' });
  let data;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'ResQRoute-Local-Prototype/0.2' } });
    data = await response.json();
    if (!response.ok && !['NoRoute', 'NoSegment'].includes(data?.code)) throw new RoutingError(`OSRM is unavailable (HTTP ${response.status}). Retry or load the local demo.`, 502);
  } catch (error) {
    if (error instanceof RoutingError) throw error;
    throw new RoutingError('The routing service could not be reached or returned an invalid response. Retry or load the local demo.', 502);
  }
  if (['NoRoute', 'NoSegment'].includes(data?.code)) throw new RoutingError('No drivable route was found within 200 metres of these locations. Choose points near roads or load the demo.', 422);
  if (data?.code !== 'Ok' || !Array.isArray(data.routes) || data.routes.length === 0) {
    throw new RoutingError('OSRM returned no usable routes. Retry or load the local demo.', 502);
  }
  const routes = [];
  const seen = new Set();
  for (const route of data.routes) {
    if (!validGeometry(route.geometry) || !Number.isFinite(route.distance) || route.distance <= 0
      || !Number.isFinite(route.duration) || route.duration <= 0) {
      throw new RoutingError('OSRM returned malformed route data. Try again or load the local demo.', 502);
    }
    const signature = JSON.stringify(route.geometry.coordinates);
    if (seen.has(signature)) continue;
    seen.add(signature);
    routes.push({ id: `live-${routes.length + 1}`, name: `Route ${String.fromCharCode(65 + routes.length)}`,
      geometry: route.geometry, distanceKm: route.distance / 1000, durationMinutes: route.duration / 60 });
  }
  return { mode, provider: 'OSRM', start, destination, routes,
    notice: `${routes.length === 1 ? 'OSRM returned only one route; no alternatives have been invented. ' : ''}Driving estimates do not include live traffic or ambulance-specific access validation.` };
}

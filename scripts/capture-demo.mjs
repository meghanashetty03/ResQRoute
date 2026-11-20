// Maintenance tool: refresh the checked-in demonstration using real OSRM road geometry.
// Not used during application startup or when loading the local demo.
import { mkdir, writeFile } from 'node:fs/promises';

const start = { lat: 12.8709, lng: 74.8429 };
const destination = { lat: 12.8621, lng: 74.8685 };
const paths = [
  { id: 'demo-a', name: 'Route A', via: [] },
  { id: 'demo-b', name: 'Route B', via: [{ lat: 12.879, lng: 74.858 }] },
  { id: 'demo-c', name: 'Route C', via: [{ lat: 12.858, lng: 74.853 }] },
];
const routes = [];
for (const path of paths) {
  const points = [start, ...path.via, destination];
  const url = `https://router.project-osrm.org/route/v1/driving/${points.map((p) => `${p.lng},${p.lat}`).join(';')}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'ResQRoute-Local-Prototype/0.2' } });
  if (!response.ok) throw new Error(`OSRM returned ${response.status}`);
  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(`No route for ${path.id}`);
  const route = data.routes[0];
  routes.push({ id: path.id, name: path.name, geometry: route.geometry, distanceKm: route.distance / 1000,
    durationMinutes: route.duration / 60, via: path.via, sourceUrl: url });
}
const scenario = { id: 'mangalore-kankanady', name: 'Mangalore → Kankanady demo', start, destination,
  capturedAt: new Date().toISOString(), source: 'OSRM road-network snapshot; via points create demonstration candidates, not live alternatives.',
  attribution: 'Road data © OpenStreetMap contributors, ODbL. Routing by OSRM.', routes };
await mkdir(new URL('../backend/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../backend/data/demoScenario.json', import.meta.url), JSON.stringify(scenario, null, 2) + '\n');
console.log(JSON.stringify(routes.map(({ id, geometry, distanceKm, durationMinutes }) => ({ id, points: geometry.coordinates.length, distanceKm, durationMinutes }))));

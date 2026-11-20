import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pointToRouteMetres } from '../../shared/geo.js';

const demo = JSON.parse(readFileSync(new URL('./demoScenario.json', import.meta.url), 'utf8'));
// Select an actual edge well away from other candidates, not an entire route ID.
export const demoSegments = demo.routes.map((route) => {
  const coordinates = route.geometry.coordinates;
  let bestIndex = 1, bestDistance = -1;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1], b = coordinates[i];
    const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const distance = Math.min(...demo.routes.filter((other) => other.id !== route.id).map((other) => pointToRouteMetres(midpoint, other.geometry.coordinates)));
    if (distance > bestDistance) { bestDistance = distance; bestIndex = i; }
  }
  const geometry = { type: 'LineString', coordinates: coordinates.slice(bestIndex - 1, bestIndex + 1) };
  return { id: `demo-${route.id.at(-1)}-road`, label: `${route.name} · confirmed demo road segment`, mode: 'demo', geometry };
});
demoSegments.push({ id: 'demo-shared-start', label: 'Shared starting road · all demo routes', mode: 'demo', geometry: { type: 'LineString', coordinates: demo.routes[0].geometry.coordinates.slice(0, 2) } });

export function liveSegments(routes) {
  const records = new Map();
  for (const route of routes) {
    const points = route.geometry.coordinates;
    for (let i = 1; i < points.length; i++) {
      const coordinates = [points[i - 1], points[i]];
      if (JSON.stringify(coordinates[0]) === JSON.stringify(coordinates[1])) continue;
      const signature = coordinates.map((p) => p.map((n) => n.toFixed(6)).join(',')).sort().join(';');
      const id = `road-${createHash('sha256').update(signature).digest('hex').slice(0, 24)}`;
      records.set(id, { id, label: `${route.name} · road edge ${i}`, mode: 'live', geometry: { type: 'LineString', coordinates } });
    }
  }
  return [...records.values()];
}

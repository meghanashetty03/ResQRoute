// Spherical great-circle point-to-segment distance, in metres. Angles are radians.
// The along-track test clamps the nearest point to the finite segment endpoints.
const R = 6371008.8;
const rad = (degrees) => degrees * Math.PI / 180;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
function angular(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(clamp(h, 0, 1)), Math.sqrt(clamp(1 - h, 0, 1)));
}
function bearing(a, b) {
  const dLng = rad(b[0] - a[0]);
  return Math.atan2(Math.sin(dLng) * Math.cos(rad(b[1])), Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(dLng));
}
export const distanceMetres = (a, b) => angular(a, b) * R;
export function segmentMidpoint(a, b) {
  const x=Math.cos(rad(a[1]))*Math.cos(rad(a[0]))+Math.cos(rad(b[1]))*Math.cos(rad(b[0]));
  const y=Math.cos(rad(a[1]))*Math.sin(rad(a[0]))+Math.cos(rad(b[1]))*Math.sin(rad(b[0]));
  const z=Math.sin(rad(a[1]))+Math.sin(rad(b[1]));
  return [Math.atan2(y,x)*180/Math.PI,Math.atan2(z,Math.hypot(x,y))*180/Math.PI];
}
export function pointToSegmentMetres(point, a, b) {
  const length = angular(a, b);
  if (length < 1e-12) return distanceMetres(point, a);
  const fromStart = angular(a, point);
  const difference = bearing(a, point) - bearing(a, b);
  const along = Math.atan2(Math.sin(fromStart) * Math.cos(difference), Math.cos(fromStart));
  if (along < 0 || along > length) return Math.min(distanceMetres(point, a), distanceMetres(point, b));
  return Math.abs(Math.asin(clamp(Math.sin(fromStart) * Math.sin(difference), -1, 1))) * R;
}
export function pointToRouteMetres(point, coordinates) {
  let distance = Infinity;
  for (let i = 1; i < coordinates.length; i++) distance = Math.min(distance, pointToSegmentMetres(point, coordinates[i - 1], coordinates[i]));
  return distance;
}
export function routeContainsSegment(route, segment, tolerance = 2) {
  // Endpoint and midpoint checks avoid treating an intersection alone as a shared road.
  for (let i = 1; i < segment.length; i++) {
    const a = segment[i - 1], b = segment[i];
    for (const p of [a, b, segmentMidpoint(a,b)]) {
      if (pointToRouteMetres(p, route) > tolerance) return false;
    }
  }
  return true;
}

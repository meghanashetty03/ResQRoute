export function pointFromDraft(draft, prefix) {
  const lat = draft[`${prefix}_lat`];
  const lng = draft[`${prefix}_lng`];
  if (String(lat).trim() === '' || String(lng).trim() === '') return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 ? point : null;
}

export const locationPresets = [
  { id: 'central', name: 'Central Mangalore', lat: 12.8709, lng: 74.8429 },
  { id: 'kankanady', name: 'Kankanady pickup area', lat: 12.8621, lng: 74.8685 },
  { id: 'north', name: 'Northern Mangalore', lat: 12.879, lng: 74.858 },
];

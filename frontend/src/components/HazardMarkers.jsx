import L from 'leaflet';
import { Marker, Popup } from 'react-leaflet';
import { hazardTypes, hazardLabel, isHazardActive } from '../../../shared/hazards.js';
import { useNow } from '../hooks/useNow.js';

const icons = new Map();
function icon(type, severity, inactive) {
  const color = inactive ? 'inactive' : severity.toLowerCase();
  const symbol = hazardTypes.find((item) => item.value === type)?.symbol || '!';
  const key = `${color}-${symbol}`;
  if (!icons.has(key)) icons.set(key, L.divIcon({ className: `hazard-pin hazard-${color}`, html: `<span>${symbol}</span>`, iconSize:[27,27], iconAnchor:[13,13] }));
  return icons.get(key);
}
export function HazardMarkers({ reports, onEdit }) {
  const now = useNow();
  return reports.map((hazard) => <Marker key={`${hazard.id}-${hazard.type}-${hazard.severity}`} position={[hazard.latitude, hazard.longitude]} icon={icon(hazard.type, hazard.severity, !isHazardActive(hazard, now) || hazard.verification_status === 'Rejected')} title={`${hazardLabel(hazard.type)} · ${hazard.severity}`}>
    <Popup><strong>{hazardLabel(hazard.type)}</strong><br />{hazard.severity} · {hazard.verification_status} · {isHazardActive(hazard, now) ? 'Active' : 'Inactive / expired'}<br />{hazard.description}<br /><small>{hazard.scenario_id ? 'Rerouting demo report · ' : hazard.scenario_mode === 'demo' ? 'Classic demo report · ' : ''}{hazard.id}<br />Reported: {new Date(hazard.reported_at).toLocaleString()}<br />{hazard.affected_segment_id ? `Segment: ${hazard.affected_segment_id}` : 'Proximity matching only'}<br />{hazard.is_complete_closure ? 'Complete closure reported. ' : ''}{hazard.segment_confirmed ? 'Same road confirmed.' : 'Same road not confirmed.'}</small>{onEdit && <><br /><button className="text-button" onClick={() => onEdit(hazard)}>Edit report</button></>}</Popup>
  </Marker>);
}
export function HazardLegend() {
  return <div className="hazard-legend" aria-label="Hazard severity legend"><span><i className="hazard-dot high" />High</span><span><i className="hazard-dot medium" />Medium</span><span><i className="hazard-dot low" />Low</span><span><i className="hazard-dot inactive" />Inactive / expired / rejected</span><span>Letters identify hazard types; click for details.</span></div>;
}

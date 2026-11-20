import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { MapContainer as LeafletMap, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { pointFromDraft } from '../utils/coordinates.js';
import 'leaflet/dist/leaflet.css';
import { HazardLegend, HazardMarkers } from './HazardMarkers.jsx';

const startIcon = L.divIcon({ className: 'location-pin ambulance-pin', html: '<span>A</span>', iconSize: [30, 36], iconAnchor: [15, 36] });
const patientIcon = L.divIcon({ className: 'location-pin patient-pin', html: '<span>P</span>', iconSize: [30, 36], iconAnchor: [15, 36] });
const hospitalIcon = L.divIcon({ className: 'location-pin hospital-pin', html: '<span>H</span>', iconSize: [30, 36], iconAnchor: [15, 36] });
const alternativeColors = ['#397fc5', '#8753b8', '#267c9a'];
const noRoutes = [];

function RouteLine({ route, selected, color, onSelect, mode, stale }) {
  const line = useRef(null);
  useEffect(() => { if (selected) line.current?.bringToFront(); }, [selected]);
  return <Polyline ref={line} positions={route.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
    pathOptions={{ color: !route.isEligible ? '#b8373e' : route.isRecommended ? (stale ? '#768b95' : route.legId==='patientToHospital'?'#8753b8':'#11866a') : route.riskScore > 50 ? '#c67d20' : color, weight: selected ? 8 : route.isRecommended ? 6 : 4, dashArray: !route.isEligible ? '9 6' : route.legId==='patientToHospital' ? '3 7' : undefined, opacity: 0.85, bubblingMouseEvents: false }}
    eventHandlers={{ click: onSelect }}>
    <Popup>{route.legLabel&&<><strong>{route.legLabel}</strong><br /></>}{route.name} · {route.distanceKm.toFixed(2)} km · {route.durationMinutes.toFixed(1)} min<br />{route.eligibilityStatus}<br />Risk {route.riskScore}/100 · cost {route.finalCost?.toFixed(2)} equivalent min<br />{route.isRecommended ? 'Recommended. ' : ''}{mode === 'demo' ? 'Demo estimate' : 'Live driving estimate'}</Popup>
  </Polyline>;
}

function MapEvents({ start, pickup, hospital, routes, onPick, enabled, fitVersion }) {
  const map = useMap();
  useMapEvents({ click(event) { if (enabled) onPick(event.latlng.wrap()); } });
  useEffect(() => {
    const points = routes.length ? routes.flatMap((route) => route.geometry.coordinates.map(([lng, lat]) => [lat, lng])) : [];
    if (start) points.push([start.lat, start.lng]);
    if (pickup) points.push([pickup.lat, pickup.lng]);
    if (hospital) points.push([hospital.lat, hospital.lng]);
    if (points.length > 1) map.fitBounds(points, { padding: [35, 35], maxZoom: 16, animate: false });
    else if (points.length === 1) map.setView(points[0], 15);
  }, [map, start?.lat, start?.lng, pickup?.lat, pickup?.lng, hospital?.lat, hospital?.lng, routes, fitVersion]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

export function MapContainer({ draft, routing, hazards }) {
  const start = pointFromDraft(draft, 'start');
  const pickup = pointFromDraft(draft, 'pickup');
  const hospital = pointFromDraft(draft, 'hospital');
  const [tileError, setTileError] = useState(false);
  const [tileLoading, setTileLoading] = useState(true);
  const [tileVersion, setTileVersion] = useState(0);
  const [fitVersion, setFitVersion] = useState(0);
  const tileEvents = useMemo(() => ({ loading: () => setTileLoading(true), load: () => setTileLoading(false), tileerror: () => setTileError(true) }), []);
  const legEntries = routing.trip ? Object.entries(routing.trip.legs).flatMap(([legId,leg])=>leg.routes.map((route)=>({...route,legId,legLabel:legId==='ambulanceToPatient'?'Ambulance → patient':'Patient → hospital',key:`${legId}:${route.id}`}))) : routing.routes.map((route)=>({...route,key:route.id}));
  const routes = [...legEntries].sort((a, b) => Number(a.key === routing.selectedId) - Number(b.key === routing.selectedId));
  // Candidate geometry is immutable within a calculation. Score polling must
  // not refit the viewport and undo the dispatcher's pan/zoom every second.
  const fitRoutes = useMemo(() => routing.data?.trip ? Object.values(routing.data.trip.legs).flatMap((leg)=>leg.routes) : routing.data?.routes || noRoutes, [routing.data?.tripId,routing.data?.calculationId]);
  return <section className="panel map-panel" aria-labelledby="map-heading">
    <div className="map-toolbar"><div><span className="eyebrow">{routing.mode === 'demo' ? 'DEMO · SIMULATED ROUTES' : 'LIVE ROUTING · NO LIVE TRAFFIC'}</span><h2 id="map-heading">Route map</h2></div><button className="text-button" onClick={() => setFitVersion((value) => value + 1)}>Fit map</button></div>
    <div className="map-selection-controls" aria-label="Map location selection">
      <button className={routing.target === 'start' ? 'selected' : ''} aria-pressed={routing.target === 'start'} disabled={routing.mode === 'demo'} onClick={() => routing.setTarget(routing.target === 'start' ? null : 'start')}>Set ambulance start</button>
      <button className={routing.target === 'pickup' ? 'selected' : ''} aria-pressed={routing.target === 'pickup'} disabled={routing.mode === 'demo'} onClick={() => routing.setTarget(routing.target === 'pickup' ? null : 'pickup')}>Set patient pickup</button>
      <button className={routing.target === 'hospital' ? 'selected' : ''} aria-pressed={routing.target === 'hospital'} disabled={routing.mode === 'demo'} onClick={() => routing.setTarget(routing.target === 'hospital' ? null : 'hospital')}>Set hospital</button>
      <span>{routing.mode === 'demo' ? 'Demo locations cannot be edited.' : routing.target ? 'Click the map to set this location.' : 'Map selection paused.'}</span>
    </div>
    <LeafletMap center={[12.87, 74.853]} zoom={14} className={`interactive-map ${routing.target && routing.mode === 'live' ? 'picking' : ''}`} aria-label="Ambulance and patient routing map" worldCopyJump>
      <TileLayer key={tileVersion} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' eventHandlers={tileEvents} maxZoom={19} />
      <MapEvents start={start} pickup={pickup} hospital={hospital} routes={fitRoutes} onPick={routing.selectPoint} enabled={routing.mode === 'live' && Boolean(routing.target)} fitVersion={fitVersion} />
      {start && <Marker position={[start.lat, start.lng]} icon={startIcon} title="Ambulance starting location"><Popup>Ambulance start<br />{start.lat.toFixed(6)}, {start.lng.toFixed(6)}</Popup></Marker>}
      {pickup && <Marker position={[pickup.lat, pickup.lng]} icon={patientIcon} title="Patient pickup location"><Popup>Patient pickup<br />{pickup.lat.toFixed(6)}, {pickup.lng.toFixed(6)}</Popup></Marker>}
      {hospital && <Marker position={[hospital.lat, hospital.lng]} icon={hospitalIcon} title="Hospital destination"><Popup>Hospital destination<br />{hospital.lat.toFixed(6)}, {hospital.lng.toFixed(6)}</Popup></Marker>}
      {routes.map((route,index) => <RouteLine key={`${routing.mode}-${route.key}`} route={route} selected={route.key === routing.selectedId} color={route.legId==='patientToHospital'?'#ad89cb':alternativeColors[index % alternativeColors.length]} onSelect={() => routing.setSelectedId(route.key)} mode={routing.mode} stale={routing.stale} />)}
      <HazardMarkers reports={hazards.reports.filter((report)=>report.scenario_mode===routing.mode && (report.scenario_id||null)===(routing.data?.scenarioId||null))} />
    </LeafletMap>
    {tileError ? <div className="map-feedback" role="status">Some map tiles could not load. Route geometry and markers remain available.<button className="text-button" onClick={() => { setTileError(false); setTileLoading(true); setTileVersion((value) => value + 1); }}>Retry map tiles</button></div> : tileLoading && <p className="map-feedback" role="status">Loading OpenStreetMap tiles…</p>}
    <div className="map-legend" aria-label="Route colour legend"><span className="legend-title">ROUTE LEGEND</span><span>Solid · Ambulance → patient</span><span><i className="legend-line" style={{background:'#8753b8'}} /> Dashed · Patient → hospital</span><span><i className="legend-line green" /> Recommended within each leg</span><span><i className="legend-line blue" /> Eligible alternatives</span><span><i className="legend-line orange" /> Higher reported risk</span><span><i className="legend-line red" /> Ineligible closure</span><span>Thicker line · selected for review</span><span>A · Ambulance · P · Patient · H · Hospital</span></div>
    <HazardLegend />
  </section>;
}

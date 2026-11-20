import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { HazardMarkers, HazardLegend } from './HazardMarkers.jsx';
import 'leaflet/dist/leaflet.css';

function Events({ point, onPick, focus }) {
  const map = useMap();
  useMapEvents({ click: (event) => onPick(event.latlng.wrap()) });
  useEffect(() => { if (focus) map.setView([focus.lat, focus.lng], 17); }, [map, focus]);
  useEffect(() => { const observer = new ResizeObserver(() => map.invalidateSize()); observer.observe(map.getContainer()); return () => observer.disconnect(); }, [map]);
  return point ? <CircleMarker center={[point.lat, point.lng]} radius={8} pathOptions={{color:'#123e68',fillOpacity:.5}} interactive={false} /> : null;
}
export function HazardMap({ point, onPick, focus, reports, onEdit, segment, routes = [] }) {
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const events = useMemo(() => ({tileerror:()=>setFailed(true)}), []);
  return <section className="panel hazard-map-panel"><div className="map-toolbar"><div><span className="eyebrow">ROAD HAZARD LOCATION</span><h2>Click a road to place the report</h2></div></div><MapContainer center={[12.87,74.853]} zoom={14} className="interactive-map picking" worldCopyJump>
    <TileLayer key={version} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' eventHandlers={events} />
    <Events point={point} onPick={onPick} focus={focus} />
    {routes.map((route) => <Polyline key={route.id} positions={route.geometry.coordinates.map(([lng,lat])=>[lat,lng])} pathOptions={{color:'#7b99ac',weight:3,opacity:.5}} interactive={false} />)}
    {segment && <Polyline positions={segment.geometry.coordinates.map(([lng,lat])=>[lat,lng])} pathOptions={{color:'#192eab',weight:9}} interactive={false} />}
    <HazardMarkers reports={reports} onEdit={onEdit} />
  </MapContainer>{failed && <p className="map-feedback">Map tiles are unavailable. Markers and saved geometry still work.<button className="text-button" onClick={()=>{setFailed(false);setVersion(version+1);}}>Retry map tiles</button></p>}<HazardLegend /></section>;
}

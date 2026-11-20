import { Activity, Building2, ChartNoAxesCombined, LayoutDashboard, Route, ShieldAlert, X } from 'lucide-react';

const items = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'routing', label: 'Emergency Routing', icon: Route },
  { id: 'hazards', label: 'Road Hazard Reports', icon: ShieldAlert },
  { id: 'analytics', label: 'Route Analytics', icon: ChartNoAxesCombined },
  { id: 'hospitals', label: 'Hospital Availability', icon: Building2 },
];

export function Sidebar({ page, open, onClose }) {
  return <>
    {open && <button className="nav-overlay" aria-label="Close navigation" onClick={onClose} />}
    <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Workspace sidebar">
      <a className="brand" href="#dashboard" onClick={onClose} aria-label="ResQRoute dashboard">
        <span className="brand-symbol"><Activity size={23} strokeWidth={2.5} /></span>
        <span>ResQ<span className="brand-accent">Route</span><small>DISPATCH WORKSPACE</small></span>
      </a>
      <button className="mobile-close icon-button" aria-label="Close navigation" onClick={onClose}><X size={20} /></button>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav aria-label="Main navigation">
        {items.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} onClick={onClose} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined}>
          <Icon size={19} /><span>{label}</span>{page === id && <span className="nav-active-dot" />}
        </a>)}
      </nav>
    </aside>
  </>;
}


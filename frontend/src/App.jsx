import { useEffect, useState } from 'react';
import { ArrowUpRight, Menu, ShieldAlert } from 'lucide-react';
import { Sidebar } from './components/Sidebar.jsx';
import { ConnectionStatus } from './components/ConnectionStatus.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { Hazards } from './pages/Hazards.jsx';
import { Analytics } from './pages/Analytics.jsx';
import { useHealth } from './hooks/useHealth.js';
import { useRouting } from './hooks/useRouting.js';
import { useHazards } from './hooks/useHazards.js';
import { RouteUpdates } from './components/RouteUpdates.jsx';
import { readSession } from './services/session.js';
import { useHospitals } from './hooks/useHospitals.js';
import { HospitalAvailability } from './pages/HospitalAvailability.jsx';

const pages = {
  dashboard: { title: 'Dispatch overview', description: 'Plan ambulance routes and review road conditions.' },
  routing: { title: 'Emergency routing', description: 'Enter ambulance, patient and hospital locations to plan both legs.' },
  hazards: { title: 'Road hazard reports', description: 'Report and verify road conditions affecting routes.' },
  analytics: { title: 'Route analytics', description: 'Review route estimates and recommendation changes.' },
  hospitals: { title: 'Hospital availability', description: 'Manage the hospital directory and ambulance-acceptance updates.' },
};
const getPage = () => window.location.hash.slice(1) || 'dashboard';

// Keep route results and hazard state mounted across sidebar navigation.
export default function App() {
  const [page, setPage] = useState(getPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(()=>readSession().draft);
  const health = useHealth();
  const routing = useRouting(draft, setDraft);
  const hazards = useHazards();
  const hospitals = useHospitals();
  useEffect(()=>{if(routing.data?.calculationId)hazards.refresh({silent:true});},[routing.data?.calculationId,hazards.refresh]);
  useEffect(() => {
    function navigate() { setPage(getPage()); setMenuOpen(false); }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  useEffect(() => {
    document.title = `ResQRoute | ${pages[page]?.title || 'Page not found'}`;
    if (window.location.hash) document.getElementById('page-title')?.focus();
  }, [page]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);
  const current = pages[page];
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content').focus(); }}>Skip to content</a>
    <Sidebar page={page} open={menuOpen} onClose={() => setMenuOpen(false)} />
    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="menu-button icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation" aria-expanded={menuOpen}><Menu size={21} /></button><span className="topbar-product">Emergency dispatch</span></div><span className={`mode-indicator ${routing.mode}`}>{routing.mode === 'demo' ? 'Demo · simulated routes' : 'Route estimates · no live traffic'}</span></header>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <div className="page-intro"><div><h1 id="page-title" tabIndex={-1}>{current?.title || 'Page not found'}</h1><p>{current?.description || 'This workspace address does not exist.'}</p></div></div>
        <ConnectionStatus health={health} />
        <RouteUpdates routing={routing} />
        {page === 'dashboard' || page === 'routing' ? <Dashboard draft={draft} routing={routing} hazards={hazards} hospitals={hospitals} /> : page === 'hazards' ? <Hazards hazards={hazards} routing={routing} /> : page === 'analytics' ? <Analytics routing={routing} hazards={hazards} /> : page === 'hospitals' ? <HospitalAvailability hospitals={hospitals} /> : <section className="panel module-page"><p>Choose a workspace from the navigation.</p><a href="#dashboard" className="text-button">Return to dashboard <ArrowUpRight size={15} /></a></section>}
        <footer className="workspace-footer"><p><ShieldAlert size={15} /> For demonstration and training only. Do not use for live emergency dispatch. Travel estimates exclude live traffic and do not guarantee road access.</p></footer>
      </main>
    </div>
  </div>;
}



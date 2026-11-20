import { RefreshCw, TriangleAlert } from 'lucide-react';

export function ConnectionStatus({ health }) {
  if (health.status !== 'error') return null;
  return <section className="connection-warning" role="alert" aria-label="Connection unavailable">
    <TriangleAlert size={17} />
    <p><strong>Connection unavailable.</strong> Route information cannot be updated.</p>
    <button type="button" className="text-button" disabled={health.checking} onClick={health.retry}><RefreshCw size={14} />{health.checking ? 'Retrying…' : 'Retry connection'}</button>
  </section>;
}

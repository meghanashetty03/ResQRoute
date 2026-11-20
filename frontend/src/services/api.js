const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

export async function routingRequest(path, { body, signal, method = body ? 'POST' : 'GET' } = {}) {
  const url = new URL(API_BASE_URL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5000') throw new Error('The API must use a localhost address on port 5000.');
  let response;
  try {
    response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}${path}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(18000)]),
      cache: 'no-store',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Connection unavailable or request timed out. Route information cannot be updated. Please retry.');
  }
  const data = await response.json().catch(() => { throw new Error('The routing API returned an unreadable response.'); });
  if (!response.ok) {
    const message = data.error === 'Database is unavailable. Restart the local backend and retry.' ? 'Road information is temporarily unavailable. Please retry.'
      : data.error === 'The local API encountered an unexpected error.' ? 'Route information could not be updated. Please retry.'
        : data.error || 'The request could not be completed. Please retry.';
    const error=new Error(message);error.status=response.status;throw error;
  }
  return data;
}

export async function getHealth(signal) {
  const url = new URL(API_BASE_URL);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '5000') {
    throw new Error('The API must use http://localhost:5000/api or http://127.0.0.1:5000/api.');
  }
  const timeout = AbortSignal.timeout(6000);
  let response;
  try {
    response = await fetch(`${API_BASE_URL.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.any([signal, timeout]), cache: 'no-store',
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error(timeout.aborted
      ? 'The local backend did not respond within 6 seconds. Check that it is running, then retry.'
      : 'Cannot reach the local backend. Start it on localhost:5000, then retry.');
  }
  const data = await response.json().catch(() => { throw new Error('The local API returned an unreadable response.'); });
  if (!response.ok) throw new Error(data.error || `Health check failed (HTTP ${response.status}).`);
  if (data.status !== 'ok' || data.database?.status !== 'connected' || data.database?.engine !== 'SQLite') {
    throw new Error('The API did not confirm a healthy SQLite connection.');
  }
  return data;
}

import { useEffect, useRef, useState } from 'react';
import { getHealth } from '../services/api.js';

export function useHealth() {
  const [health, setHealth] = useState({ status: 'loading', data: null, error: null, checkedAt: null });
  const [attempt, setAttempt] = useState(0);
  const currentRequest = useRef(null);
  useEffect(() => {
    let stopped = false, inFlight = false;
    async function check() {
      if (inFlight || stopped) return;
      inFlight = true;
      const controller = new AbortController();
      currentRequest.current = controller;
      setHealth((previous) => ({ ...previous, checking: true }));
      try {
        const data = await getHealth(controller.signal);
        if (!stopped && !controller.signal.aborted) setHealth({ status: 'success', data, error: null, checkedAt: new Date(), checking: false });
      } catch (error) {
        if (!stopped && !controller.signal.aborted) setHealth({ status: 'error', data: null, error: error.message, checkedAt: new Date(), checking: false });
      } finally { inFlight = false; }
    }
    check();
    const timer = setInterval(check, 15000);
    const wake = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', wake);
    return () => { stopped = true; currentRequest.current?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', wake); };
  }, [attempt]);
  function retry() {
    currentRequest.current?.abort();
    setAttempt((value) => value + 1);
  }
  return { ...health, retry };
}

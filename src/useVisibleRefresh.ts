import { useEffect, useRef } from 'react';

export const ADMIN_REFRESH_INTERVAL_MS = 10_000;

export function useVisibleRefresh(refresh: () => Promise<void>, enabled: boolean) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; });
  useEffect(() => {
    if (!enabled) return;
    let running = false, cancelled = false;
    async function check() {
      if (cancelled || running || document.visibilityState === 'hidden' || !navigator.onLine) return;
      running = true;
      try { await latest.current(); } finally { running = false; }
    }
    const resume = () => { void check(); }, timer = window.setInterval(resume, ADMIN_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', resume); window.addEventListener('pageshow', resume); window.addEventListener('online', resume); document.addEventListener('visibilitychange', resume);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', resume); window.removeEventListener('pageshow', resume); window.removeEventListener('online', resume); document.removeEventListener('visibilitychange', resume); };
  }, [enabled]);
}

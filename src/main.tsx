import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import Admin from './Admin.tsx';
import Tracking from './Tracking.tsx';
import { publicAssetUrl } from './pwa.ts';
import { applyPageMetadata } from './page-metadata.ts';
import './styles.css';
import './brand.css';
import './profile.css';
import './admin.css';

function currentPage() {
  if (window.location.hash === '#/rastreio' || /^\/rastreio\/?$/.test(window.location.pathname)) return 'tracking';
  if (window.location.hash === '#/admin' || (/\/admin\/?$/.test(window.location.pathname) && !window.location.hash)) return 'admin';
  return 'portal';
}

function Router() {
  const [page, setPage] = React.useState(currentPage);
  const admin = page === 'admin';
  const tracking = page === 'tracking';
  React.useEffect(() => {
    // Update an already-installed worker without asking permission or replacing its subscription.
    if (tracking || !('serviceWorker' in navigator)) return;
    let running = false;
    async function refreshWorker() {
      if (running || document.visibilityState === 'hidden' || !navigator.onLine) return;
      running = true;
      try { const registration = await navigator.serviceWorker.getRegistration(publicAssetUrl('notifications-worker.js')); await registration?.update(); }
      catch { /* Keep the installed worker usable when offline or during an update failure. */ }
      finally { running = false; }
    }
    void refreshWorker();
    const interval = window.setInterval(refreshWorker, 60 * 60 * 1000);
    window.addEventListener('pageshow', refreshWorker); window.addEventListener('online', refreshWorker); document.addEventListener('visibilitychange', refreshWorker);
    return () => { window.clearInterval(interval); window.removeEventListener('pageshow', refreshWorker); window.removeEventListener('online', refreshWorker); document.removeEventListener('visibilitychange', refreshWorker); };
  }, [tracking]);
  React.useEffect(() => { const change = () => setPage(currentPage()); window.addEventListener('hashchange', change); window.addEventListener('popstate', change); return () => { window.removeEventListener('hashchange', change); window.removeEventListener('popstate', change); }; }, []);
  React.useEffect(() => {
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme) theme.content = tracking ? '#f1f4f8' : '#070907';
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) manifest.href = publicAssetUrl(admin ? 'admin.webmanifest' : 'manifest.webmanifest');
    const appleName = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleName) appleName.content = admin ? 'GESTÃO' : 'Lucro Certo';
    const appName = document.querySelector<HTMLMetaElement>('meta[name="application-name"]');
    if (appName) appName.content = admin ? 'GESTÃO' : 'Lucro Certo';
    const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (appleIcon) appleIcon.href = publicAssetUrl('firebot-apple-touch-icon.png');
    // The authenticated portal owns its title; the router must not overwrite it.
    if (admin || tracking) applyPageMetadata(tracking ? 'tracking' : 'admin');
  }, [admin, tracking]);
  return tracking ? <Tracking /> : admin ? <Admin /> : <App />;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Router /></React.StrictMode>,
);

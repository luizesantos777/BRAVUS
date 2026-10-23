import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import Admin from './Admin.tsx';
import { publicAssetUrl } from './pwa.ts';
import './styles.css';
import './brand.css';
import './profile.css';
import './admin.css';

function Router() {
  React.useEffect(() => {
    // Update an already-installed worker without asking permission or replacing its subscription.
    if (!('serviceWorker' in navigator)) return;
    let running = false;
    async function refreshWorker() {
      if (running || document.visibilityState === 'hidden' || !navigator.onLine) return;
      running = true;
      try { const registration = await navigator.serviceWorker.getRegistration(publicAssetUrl('notifications-worker.js')); await registration?.update(); }
      catch { /* Keep the installed worker usable when offline or during an update failure. */ }
      finally { running = false; }
    }
    void refreshWorker();
    window.addEventListener('pageshow', refreshWorker); document.addEventListener('visibilitychange', refreshWorker);
    return () => { window.removeEventListener('pageshow', refreshWorker); document.removeEventListener('visibilitychange', refreshWorker); };
  }, []);
  const [admin, setAdmin] = React.useState(() => window.location.hash === '#/admin' || /\/admin\/?$/.test(window.location.pathname));
  React.useEffect(() => { const change = () => setAdmin(window.location.hash === '#/admin' || (/\/admin\/?$/.test(window.location.pathname) && !window.location.hash)); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  React.useEffect(() => {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) manifest.href = publicAssetUrl(admin ? 'admin.webmanifest' : 'manifest.webmanifest');
    const appleName = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleName) appleName.content = 'FireBot';
    const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (appleIcon) appleIcon.href = publicAssetUrl('firebot-apple-touch-icon.png');
    document.title = admin ? 'FireBot — Administração BRAVUS' : 'FireBot — Portal do Atendente BRAVUS';
  }, [admin]);
  return admin ? <Admin /> : <App />;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Router /></React.StrictMode>,
);

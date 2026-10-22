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
  const [admin, setAdmin] = React.useState(() => window.location.hash === '#/admin' || /\/admin\/?$/.test(window.location.pathname));
  React.useEffect(() => { const change = () => setAdmin(window.location.hash === '#/admin' || (/\/admin\/?$/.test(window.location.pathname) && !window.location.hash)); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  React.useEffect(() => {
    const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifest) manifest.href = publicAssetUrl(admin ? 'admin.webmanifest' : 'manifest.webmanifest');
  }, [admin]);
  return admin ? <Admin /> : <App />;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Router /></React.StrictMode>,
);

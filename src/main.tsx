import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import Admin from './Admin.tsx';
import './styles.css';
import './brand.css';
import './profile.css';

function Router() {
  const [admin, setAdmin] = React.useState(() => window.location.hash === '#/admin' || /\/admin\/?$/.test(window.location.pathname));
  React.useEffect(() => { const change = () => setAdmin(window.location.hash === '#/admin' || (/\/admin\/?$/.test(window.location.pathname) && !window.location.hash)); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  return admin ? <Admin /> : <App />;
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Router /></React.StrictMode>,
);

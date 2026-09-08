import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isDesktop } from './api/client.js';
import { App } from './App.js';
import './i18n/index.js';
import { AppProvider } from './state.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element missing');

createRoot(container).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);

// Registers the service worker that makes the interface installable on a phone.
// Only over https or on localhost, and never inside the desktop app, which is
// already an application.
if ('serviceWorker' in navigator && window.isSecureContext && !isDesktop) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(new URL('sw.js', window.location.href));
  });
}

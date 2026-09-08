/*
 * Service worker for the installable web app.
 *
 * It deliberately caches nothing: the interface talks to an authenticated API,
 * and a stale cached answer would be worse than a loading spinner. Its only
 * job is to exist, which is what makes the browser offer "install".
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // No respondWith: every request goes to the network as usual.
});

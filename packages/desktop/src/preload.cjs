/**
 * The small bridge the interface is allowed to use.
 *
 * CommonJS on purpose: a sandboxed Electron preload is not loaded as a module.
 * It exposes only what a browser genuinely cannot do itself - catching an OAuth
 * redirect on a loopback address. Everything else goes through the HTTP API,
 * exactly as it does in a browser.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mailArchiver', {
  /** Opens the sign-in page and resolves with the address it redirects to. */
  oauthLoopback: (url, port) => ipcRenderer.invoke('oauth:loopback', url, port),
  /** A free loopback port to register with the provider. */
  suggestPort: () => ipcRenderer.invoke('oauth:port'),
});

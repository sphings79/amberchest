import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const apiTarget = process.env.AMBERCHEST_DEV_API ?? 'http://127.0.0.1:8484';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths keep the build working behind a reverse proxy
  // sub-path as well as inside the packaged desktop app.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
});

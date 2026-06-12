import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.CODEDELTA_PORT ?? 3847);
const uiProxied = Boolean(process.env.CODEDELTA_DEV_UI_URL?.trim());

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // When the API server proxies this port on :3847, HMR must connect through the proxy.
    hmr: uiProxied ? { clientPort: apiPort } : undefined,
    proxy: {
      '/api': {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});

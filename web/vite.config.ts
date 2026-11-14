import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource = 'node_modules/cesium/Build/Cesium';
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'ThirdParty', 'Assets', 'Widgets'].map((d) => ({
        src: `${cesiumSource}/${d}`,
        dest: 'cesium',
        rename: { stripBase: 4 },
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/'), __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: { headers: isolationHeaders, port: 5173 },
  preview: { headers: isolationHeaders, port: 4173 },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 6000, target: 'es2022' },
  optimizeDeps: { exclude: ['./src/engine/pkg/lunar_engine.js'] },
});

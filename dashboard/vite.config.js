import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Serves the evidence checker's output and the raw SHA256SUMS files.
 *
 * The viewer must read the TOOL'S OUTPUT, never the docs/evidence/ directory
 * directly. A panel that walked the directory itself would be re-deriving
 * status in the display layer — the defect recorded in
 * docs/incidents/2026-09-fake-proof-endpoint.md. So the only thing exposed
 * here is the JSON the tool wrote, plus the raw sums for inspection.
 */
function evidenceFiles() {
  const base = resolve(fileURLToPath(new URL('.', import.meta.url)), '../docs/evidence');
  return {
    name: 'nexa-evidence-files',
    configureServer(server) {
      server.middlewares.use('/evidence-check.json', (req, res) => {
        const file = resolve(base, 'evidence-check.json');
        if (!existsSync(file)) {
          // Not "no data" — the distinction between "never run" and "nothing
          // to report" must survive to the UI.
          res.statusCode = 404;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'not-run' }));
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(readFileSync(file));
      });
      server.middlewares.use('/evidence-raw', (req, res) => {
        const rel = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]);
        const file = resolve(base, rel);
        if (!file.startsWith(base) || !existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), evidenceFiles()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    cors: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    cors: true
  }
});

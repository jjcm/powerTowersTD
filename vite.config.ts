import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/** Dev-only: lets the page POST canvas snapshots to disk (automated visual checks). */
function snapshots(): Plugin {
  return {
    name: 'pt-snapshots',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? 'shot').replace(/[^a-z0-9_-]/gi, '');
        const dir = process.env.PT_SHOT_DIR ?? path.resolve('tools/assets/raw/shots');
        fs.mkdirSync(dir, { recursive: true });
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const b64 = Buffer.concat(chunks).toString().replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(path.join(dir, `${name}.jpg`), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [snapshots()],
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});

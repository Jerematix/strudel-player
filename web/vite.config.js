import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKS_DIR = path.resolve(__dirname, '../tracks');

// Serves the track files fresh from disk on every request — this is what
// makes hot reload work: the frontend polls these endpoints and re-evaluates
// when the content changes. No caching anywhere.
const tracksApi = () => ({
  name: 'tracks-api',
  configureServer(server) {
    // push file events over Vite's own HMR websocket — the client reloads the
    // track instantly instead of waiting out the poll interval
    server.watcher.add(TRACKS_DIR);
    const onFs = (file) => {
      if (!file.startsWith(TRACKS_DIR) || !file.endsWith('.strudel')) return;
      server.ws.send({
        type: 'custom',
        event: 'tracks-changed',
        data: { file: path.relative(TRACKS_DIR, file).split(path.sep).join('/') },
      });
    };
    server.watcher.on('change', onFs);
    server.watcher.on('add', onFs);
    server.watcher.on('unlink', onFs);

    server.middlewares.use((req, res, next) => {
      const url = (req.url || '').split('?')[0];
      if (url === '/tracks') {
        const walk = (dir, base = '') =>
          fs
            .readdirSync(dir, { withFileTypes: true })
            .flatMap((d) =>
              d.isDirectory()
                ? walk(path.join(dir, d.name), `${base}${d.name}/`)
                : d.name.endsWith('.strudel')
                  ? [`${base}${d.name}`]
                  : [],
            );
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(walk(TRACKS_DIR).sort()));
        return;
      }
      if (url.startsWith('/tracks/')) {
        const name = decodeURIComponent(url.slice('/tracks/'.length));
        const file = path.join(TRACKS_DIR, name);
        if (!file.startsWith(TRACKS_DIR + path.sep) || !name.endsWith('.strudel')) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        if (req.method === 'DELETE') {
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            res.end('not found');
            return;
          }
          fs.unlinkSync(file);
          res.statusCode = 200;
          res.end('ok');
          return;
        }
        if (req.method === 'PUT') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              fs.mkdirSync(path.dirname(file), { recursive: true });
              fs.writeFileSync(file, body, 'utf8');
              res.statusCode = 200;
              res.end('ok');
            } catch (e) {
              res.statusCode = 500;
              res.end(String(e));
            }
          });
          return;
        }
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(fs.readFileSync(file, 'utf8'));
        return;
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [tracksApi()],
  server: {
    host: true,
    port: 5273,
    strictPort: true,
    // reliable file watching for the web/ source inside Docker volume mounts
    watch: { usePolling: true, interval: 300 },
  },
});

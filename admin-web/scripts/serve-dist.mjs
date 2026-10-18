// Serveur statique minimal pour tester le build production (dist/).
// Usage : node scripts/serve-dist.mjs [port]
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = parseInt(process.argv[2] || '4174', 10);
const ROOT = fileURLToPath(new URL('../dist', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(ROOT, safePath);

  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // Fallback SPA (history API fallback) → index.html
    try {
      const data = await readFile(join(ROOT, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('dist/index.html introuvable — lancez d\'abord npm run build');
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serveur de test sur http://localhost:${PORT}`);
});

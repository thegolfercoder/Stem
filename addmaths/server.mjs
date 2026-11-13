// A tiny static server for auditing the exported site locally.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = join(process.cwd(), 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
createServer((req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = join(root, path);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(root, path.replace(/\/$/, '') + '.html');
  if (!existsSync(file)) { res.writeHead(404, { 'content-type': 'text/html' }); res.end(readFileSync(join(root, '404.html'), 'utf8')); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(4173, () => console.log('serving out/ on http://localhost:4173'));
